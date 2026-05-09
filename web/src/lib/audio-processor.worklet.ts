// AudioWorkletProcessor for capturing raw PCM audio
// Loaded by AudioContext.audioWorklet.addModule()

// The global AudioWorkletProcessor and registerProcessor are available in
// the AudioWorklet thread scope but not always declared in TypeScript libs.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array[] = [];
  private totalLength = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'stop') {
        this.sendBuffer();
      } else if (event.data.type === 'peek') {
        // Send a copy of the buffer WITHOUT clearing — used for interim transcriptions.
        this.sendBuffer(true);
      } else if (event.data.type === 'clear') {
        this.clearBuffer();
      }
    };
  }

  /**
   * Called by the audio engine for every render quantum (typically 128 samples).
   * We read the first input channel, buffer the chunk, and return true to keep
   * the processor alive.  The output is left silent (capture-only).
   */
  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Grab the first (mono) channel — if stereo, we only take channel 0.
      const channelData = input[0];
      if (channelData && channelData.length > 0) {
        const chunk = new Float32Array(channelData);
        this.buffer.push(chunk);
        this.totalLength += chunk.length;
      }
    }
    // Keep processor alive even with no output (silent capture).
    return true;
  }

  private sendBuffer(readonly = false): void {
    if (this.totalLength === 0) {
      this.port.postMessage({ type: 'data', audio: new Float32Array(0) });
      return;
    }

    const merged = new Float32Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.buffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.port.postMessage({ type: 'data', audio: merged });
    if (!readonly) {
      this.clearBuffer();
    }
  }

  private clearBuffer(): void {
    this.buffer = [];
    this.totalLength = 0;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
