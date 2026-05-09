import WhisperWorker from './whisper-worker?worker';

type TranscriberState = 'idle' | 'loading' | 'ready' | 'error';

export class WhisperTranscriber {
  private worker: Worker | null = null;
  private state: TranscriberState = 'idle';
  private loadPromise: Promise<void> | null = null;

  private loadResolve: (() => void) | null = null;
  private loadReject: ((error: string) => void) | null = null;

  private transcribeResolve: ((text: string) => void) | null = null;
  private transcribeReject: ((error: string) => void) | null = null;

  getState(): TranscriberState {
    return this.state;
  }

  async loadModel(
    onProgress?: (progress: { status: string; progress: number }) => void,
  ): Promise<void> {
    // If already loading or ready, return the existing promise or resolve
    if (this.state === 'ready') {
      return;
    }
    if (this.state === 'loading' && this.loadPromise) {
      return this.loadPromise;
    }

    this.state = 'loading';

    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.loadResolve = resolve;
      this.loadReject = reject;
    });

    const worker = new WhisperWorker();
    this.worker = worker;

    worker.onmessage = (event: MessageEvent) => {
      const { type } = event.data;

      switch (type) {
        case 'progress': {
          onProgress?.({
            status: event.data.status,
            progress: event.data.progress,
          });
          break;
        }

        case 'loaded': {
          this.state = 'ready';
          this.loadResolve?.();
          this.loadResolve = null;
          this.loadReject = null;
          break;
        }

        case 'error': {
          const errorMsg = event.data.error;
          if (this.state === 'loading') {
            this.state = 'error';
            this.loadReject?.(errorMsg);
            this.loadResolve = null;
            this.loadReject = null;
          } else {
            // Error during transcription
            this.transcribeReject?.(errorMsg);
            this.transcribeResolve = null;
            this.transcribeReject = null;
          }
          break;
        }

        case 'result': {
          this.transcribeResolve?.(event.data.text);
          this.transcribeResolve = null;
          this.transcribeReject = null;
          break;
        }
      }
    };

    worker.onerror = (error) => {
      const errorMsg = error.message ?? String(error);
      if (this.state === 'loading') {
        this.state = 'error';
        this.loadReject?.(errorMsg);
        this.loadResolve = null;
        this.loadReject = null;
      } else {
        this.transcribeReject?.(errorMsg);
        this.transcribeResolve = null;
        this.transcribeReject = null;
      }
    };

    worker.postMessage({ type: 'load' });

    return this.loadPromise;
  }

  async transcribe(audio: Float32Array, language?: string): Promise<string> {
    if (this.state !== 'ready' || !this.worker) {
      throw new Error('Whisper model is not loaded. Call loadModel() first.');
    }

    const worker = this.worker;

    return new Promise<string>((resolve, reject) => {
      this.transcribeResolve = resolve;
      this.transcribeReject = reject;
      worker.postMessage({ type: 'transcribe', audio, language });
    });
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.state = 'idle';
    this.loadPromise = null;
    this.loadResolve = null;
    this.loadReject = null;
    this.transcribeResolve = null;
    this.transcribeReject = null;
  }
}
