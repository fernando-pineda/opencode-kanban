import { pipeline, env } from '@huggingface/transformers';

env.localModelPath = '/models/';
env.allowLocalModels = true;
env.allowRemoteModels = false;

class PipelineSingleton {
  static instance: any = null;

  static async getInstance(
    progressCallback?: (progress: any) => void,
  ): Promise<any> {
    if (PipelineSingleton.instance !== null) {
      return PipelineSingleton.instance;
    }

    const pipelineOptions: any = {
      dtype: 'fp32',
      progress_callback: progressCallback,
    };

    // WebGPU is not available in Worker scope in most browsers — use WASM.
    // If WebGPU support is added to workers in the future, this can be updated.

    PipelineSingleton.instance = await pipeline(
      'automatic-speech-recognition',
      'whisper-tiny',
      pipelineOptions,
    );

    return PipelineSingleton.instance;
  }
}

// Web Worker message handler
self.onmessage = async (event: MessageEvent) => {
  const { type } = event.data;

  switch (type) {
    case 'load': {
      try {
        await PipelineSingleton.getInstance((progress: any) => {
          (self as unknown as Worker).postMessage({
            type: 'progress',
            status: progress.status ?? '',
            file: progress.file ?? '',
            loaded: progress.loaded ?? 0,
            total: progress.total ?? 0,
            progress: progress.progress ?? 0,
          });
        });
        (self as unknown as Worker).postMessage({ type: 'loaded' });
      } catch (error: any) {
        (self as unknown as Worker).postMessage({
          type: 'error',
          error: error?.message ?? String(error),
        });
      }
      break;
    }

    case 'transcribe': {
      const { audio, language } = event.data;

      try {
        const transcriber = await PipelineSingleton.getInstance();

        const opts: Record<string, any> = {
          chunk_length_s: 30,
          stride_length_s: 5,
          task: 'transcribe',
        };
        // Only pass language if explicitly set — omitting it enables auto-detection.
        // 'any' is NOT a valid Whisper language; it means "auto-detect" in our UI.
        if (language && language !== 'any') {
          opts.language = language;
        }

        const result = await transcriber(audio, opts);

        (self as unknown as Worker).postMessage({ type: 'result', text: result.text });
      } catch (error: any) {
        (self as unknown as Worker).postMessage({
          type: 'error',
          error: error?.message ?? String(error),
        });
      }
      break;
    }
  }
};
