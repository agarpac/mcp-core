import { createProgressBus, type ProgressBus } from './progress';

/**
 * Shared progress bus used by the CLI and the UI API so that a single install
 * flow publishes events to every subscriber (CLI console output + SSE stream).
 */
let instance: ProgressBus | null = null;

export function getProgressBus(): ProgressBus {
  if (instance === null) {
    instance = createProgressBus();
  }
  return instance;
}

/** For tests: reset the singleton so listeners from prior tests don't leak. */
export function resetProgressBus(): void {
  instance = null;
}
