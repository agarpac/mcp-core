import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// jsdom doesn't implement EventSource. Stub it so dashboard components that
// open SSE streams can mount in tests without blowing up.
class StubEventSource {
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
if (typeof (globalThis as any).EventSource === 'undefined') {
  (globalThis as any).EventSource = StubEventSource;
}
