/**
 * Progress bus: a tiny typed event bus so long-running operations (e.g. install)
 * can publish phase transitions while multiple consumers (CLI, SSE endpoint, tests)
 * subscribe independently.
 *
 * Internally built on Node's EventEmitter, but the public API hides it so we can
 * evolve the implementation (replay buffer, async iterable, etc.) without breaking
 * callers.
 *
 * Usage:
 *   const bus = createProgressBus();
 *   const off = bus.on((e) => console.log(e.phase, e.message));
 *   bus.emit('clone', 'cloning repo');
 *   await bus.once('done');
 *   off();
 */

import { EventEmitter } from 'node:events';

export type ProgressPhase =
  | 'resolve'
  | 'clone'
  | 'npm-install'
  | 'npm-build'
  | 'register'
  | 'inject-clients'
  | 'validate'
  | 'done'
  | 'error';

export interface ProgressEvent {
  phase: ProgressPhase;
  message?: string;
  data?: unknown;
  timestamp: number;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface ProgressBus {
  /** Subscribe to every progress event. Returns an unsubscribe function. */
  on(listener: ProgressListener): () => void;
  /** Emit a progress event. Optional message and arbitrary data payload. */
  emit(phase: ProgressPhase, message?: string, data?: unknown): void;
  /**
   * Resolve the next event with the given phase.
   *
   * Semantics:
   *   - If the awaited phase is emitted, resolves with the event.
   *   - If the awaited phase is NOT 'error' and an 'error' event arrives first,
   *     the promise rejects with an Error built from the error event's message
   *     (or data.error.message). This avoids hangs when the flow fails.
   *   - If the awaited phase IS 'error', error events resolve normally.
   */
  once(phase: ProgressPhase): Promise<ProgressEvent>;
}

const EVENT_NAME = 'progress';
const MAX_LISTENERS = 20;

export function createProgressBus(): ProgressBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(MAX_LISTENERS);

  const on = (listener: ProgressListener): (() => void) => {
    emitter.on(EVENT_NAME, listener);
    return () => {
      emitter.off(EVENT_NAME, listener);
    };
  };

  const emit = (phase: ProgressPhase, message?: string, data?: unknown): void => {
    const event: ProgressEvent = {
      phase,
      timestamp: Date.now(),
      ...(message !== undefined ? { message } : {}),
      ...(data !== undefined ? { data } : {}),
    };
    emitter.emit(EVENT_NAME, event);
  };

  const once = (phase: ProgressPhase): Promise<ProgressEvent> => {
    return new Promise<ProgressEvent>((resolve, reject) => {
      const listener = (event: ProgressEvent): void => {
        if (event.phase === phase) {
          emitter.off(EVENT_NAME, listener);
          resolve(event);
          return;
        }
        if (event.phase === 'error' && phase !== 'error') {
          emitter.off(EVENT_NAME, listener);
          const msg =
            (event.message ??
            (event.data &&
            typeof event.data === 'object' &&
            event.data !== null &&
            'error' in event.data &&
            (event.data as { error?: { message?: string } }).error?.message)) ||
            'progress bus error';
          reject(new Error(String(msg)));
          return;
        }
      };
      emitter.on(EVENT_NAME, listener);
    });
  };

  return { on, emit, once };
}
