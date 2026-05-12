// AudioWorkletProcessor for capturing raw PCM audio
// Loaded by AudioContext.audioWorklet.addModule()
// This file lives in public/ so Vite copies it as-is to the build output root,
// ensuring the browser can fetch it directly without COEP/CORS issues.

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._totalLength = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this._sendBuffer();
      } else if (event.data.type === 'peek') {
        // Send a copy of the buffer WITHOUT clearing — used for interim transcriptions.
        this._sendBuffer(true);
      } else if (event.data.type === 'clear') {
        this._clearBuffer();
      }
    };
  }

  /**
   * Called by the audio engine for every render quantum (typically 128 samples).
   * We read the first input channel, buffer the chunk, and return true to keep
   * the processor alive.  The output is left silent (capture-only).
   */
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Grab the first (mono) channel — if stereo, we only take channel 0.
      const channelData = input[0];
      if (channelData && channelData.length > 0) {
        const chunk = new Float32Array(channelData);
        this._buffer.push(chunk);
        this._totalLength += chunk.length;
      }
    }
    // Keep processor alive even with no output (silent capture).
    return true;
  }

  _sendBuffer(readonly = false) {
    if (this._totalLength === 0) {
      this.port.postMessage({ type: 'data', audio: new Float32Array(0) });
      return;
    }

    const merged = new Float32Array(this._totalLength);
    let offset = 0;
    for (const chunk of this._buffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.port.postMessage({ type: 'data', audio: merged });
    if (!readonly) {
      this._clearBuffer();
    }
  }

  _clearBuffer() {
    this._buffer = [];
    this._totalLength = 0;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
