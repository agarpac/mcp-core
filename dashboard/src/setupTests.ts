import '@testing-library/jest-dom';

// jsdom does not implement EventSource. Stub it so components that open SSE
// streams (Progress) can mount without blowing up.
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
(globalThis as any).EventSource = StubEventSource;
