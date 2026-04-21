import '@testing-library/jest-dom';
// jsdom does not implement EventSource. Stub it so components that open SSE
// streams (Progress) can mount without blowing up.
class StubEventSource {
    url;
    readyState = 1;
    onopen = null;
    onerror = null;
    onmessage = null;
    constructor(url) {
        this.url = url;
    }
    addEventListener() { }
    removeEventListener() { }
    close() { }
}
globalThis.EventSource = StubEventSource;
//# sourceMappingURL=setupTests.js.map