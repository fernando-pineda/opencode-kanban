/**
 * AudioCapture — high-level helper for recording microphone audio in the browser
 * and producing 16 kHz mono Float32Array PCM suitable for Transformers.js Whisper.
 *
 * Usage:
 *   const capture = new AudioCapture();
 *   await capture.start();
 *   // … user speaks …
 *   const raw = await capture.stop();            // native sample-rate mono
 *   const pcm16k = capture.resampleTo16kHz(raw); // 16 kHz mono for Whisper
 *   capture.destroy();
 */

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private resolveStop: ((audio: Float32Array) => void) | null = null;
  private rejectStop: ((reason: unknown) => void) | null = null;

  /**
   * Start capturing audio from the microphone.
   *
   * Creates an AudioContext at the browser's native sample rate (typically 48 kHz),
   * registers the AudioWorklet, and begins buffering PCM chunks.
   */
  async start(): Promise<void> {
    // Request microphone access.
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Use the native sample rate so we can later resample precisely to 16 kHz.
    this.audioContext = new AudioContext();

    // Load the worklet processor module from the public directory.
    // The file lives in web/public/ so it's served at the root path in both
    // dev and production, avoiding COEP/CORS issues with Vite chunk loading.
    await this.audioContext.audioWorklet.addModule('/audio-processor.worklet.js');

    // Create the worklet node and wire up the message port.
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'audio-capture-processor',
    );

    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'data' && this.resolveStop) {
        this.resolveStop(event.data.audio as Float32Array);
        this.resolveStop = null;
        this.rejectStop = null;
      }
    };

    // Connect microphone → worklet (worklet output stays disconnected — silent).
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    source.connect(this.workletNode);
  }

  /**
   * Get the accumulated audio so far WITHOUT stopping the capture.
   * Used for interim (real-time) transcriptions while recording.
   */
  async peekAudio(): Promise<Float32Array> {
    if (!this.workletNode) {
      throw new Error('AudioCapture is not started');
    }

    this.workletNode.port.postMessage({ type: 'peek' });

    return new Promise<Float32Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for audio peek'));
      }, 2_000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'data') {
          clearTimeout(timeout);
          this.workletNode?.port.removeEventListener('message', handler);
          resolve(event.data.audio as Float32Array);
        }
      };
      this.workletNode!.port.addEventListener('message', handler);
    });
  }

  /**
   * Stop capturing and return the accumulated audio at the native sample rate.
   *
   * The returned Float32Array is mono (single channel) PCM data.
   */
  async stop(): Promise<Float32Array> {
    if (!this.workletNode || !this.audioContext) {
      throw new Error('AudioCapture is not started');
    }

    // Signal the worklet to send its buffered data.
    this.workletNode.port.postMessage({ type: 'stop' });

    // Wait for the worklet to respond with the audio buffer.
    const audio = await new Promise<Float32Array>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;

      // Safety timeout — if the worklet never responds, reject after 5 s.
      setTimeout(() => {
        if (this.rejectStop) {
          this.rejectStop(new Error('Timed out waiting for audio worklet'));
          this.resolveStop = null;
          this.rejectStop = null;
        }
      }, 5_000);
    });

    // Tear down audio graph.
    try {
      this.workletNode.disconnect();
    } catch {
      // Already disconnected — ignore.
    }
    this.workletNode = null;

    try {
      await this.audioContext.close();
    } catch {
      // Context may already be closed — ignore.
    }
    this.audioContext = null;

    // Stop all microphone tracks.
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;

    return audio;
  }

  /**
   * Resample audio from any sample rate to 16 kHz mono Float32Array.
   *
   * This uses OfflineAudioContext to perform sample-rate conversion, which is the
   * same approach the Web Audio API uses internally and produces high-quality results.
   *
   * @param audioData   Mono PCM samples at `originalSampleRate`.
   * @param originalSampleRate  The sample rate of `audioData` (e.g. 48 000).
   * @returns Mono PCM samples at 16 000 Hz.
   */
  async resampleTo16kHz(
    audioData: Float32Array,
    originalSampleRate: number,
  ): Promise<Float32Array> {
    if (originalSampleRate === 16_000) {
      return audioData;
    }

    const targetSampleRate = 16_000;
    const ratio = originalSampleRate / targetSampleRate;
    const outputLength = Math.ceil(audioData.length / ratio);

    // Create a source buffer at the original sample rate.
    const offlineCtx = new OfflineAudioContext(1, outputLength, targetSampleRate);
    const sourceBuffer = offlineCtx.createBuffer(
      1,
      audioData.length,
      originalSampleRate,
    );
    sourceBuffer.copyToChannel(new Float32Array(audioData) as Float32Array<ArrayBuffer>, 0);

    // Render through a BufferSourceNode so the OfflineAudioContext resamples.
    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();

    return rendered.getChannelData(0);
  }

  /**
   * Release all resources. Call this when the component unmounts to avoid leaks.
   */
  destroy(): void {
    try {
      this.workletNode?.disconnect();
    } catch {
      // ignore
    }
    this.workletNode = null;

    if (this.audioContext?.state !== 'closed') {
      this.audioContext?.close().catch(() => {});
    }
    this.audioContext = null;

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;

    this.resolveStop = null;
    this.rejectStop = null;
  }
}
