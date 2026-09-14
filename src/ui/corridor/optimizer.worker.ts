/** Runs offset optimization off the UI thread. */
import { optimizeOffsets, type OptimizeOptions, type OptimizeResult, type Prepared } from '../../engine';

export type OptimizerRequest = { prepared: Extract<Prepared, { ok: true }>; options: Omit<OptimizeOptions, 'onProgress'> };
export type OptimizerMessage = { type: 'progress'; fraction: number } | { type: 'done'; result: OptimizeResult } | { type: 'failed'; message: string };

self.onmessage = (event: MessageEvent<OptimizerRequest>) => {
  const post = (message: OptimizerMessage) => (self as unknown as Worker).postMessage(message);
  try {
    let last = -1;
    const result = optimizeOffsets(event.data.prepared, {
      ...event.data.options,
      onProgress: (fraction) => {
        const rounded = Math.floor(fraction * 100);
        if (rounded !== last) {
          last = rounded;
          post({ type: 'progress', fraction });
        }
      },
    });
    post({ type: 'done', result });
  } catch (cause) {
    post({ type: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
