/** Runs a signal simulation off the UI thread. */
import { NemaController, simulate, type ControllerModel, type SimulationResult, type SimulationSettings } from '../../../engine';
import type { Intersection } from '../../../model';

export type ControllerBehaviour = 'nema' | 'csm';

export type SimulationRequest = { intersection: Intersection; settings: SimulationSettings; behaviour: ControllerBehaviour };
export type SimulationMessage = { type: 'done'; result: SimulationResult } | { type: 'failed'; message: string };

function controllerFor(request: SimulationRequest): ControllerModel {
  return new NemaController(request.intersection, { patternId: request.settings.patternId });
}

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const post = (message: SimulationMessage) => (self as unknown as Worker).postMessage(message);
  try {
    post({ type: 'done', result: simulate(event.data.intersection, event.data.settings, controllerFor(event.data)) });
  } catch (cause) {
    post({ type: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
