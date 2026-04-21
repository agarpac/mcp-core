"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const progress_1 = require("../../src/utils/progress");
(0, vitest_1.describe)('createProgressBus', () => {
    (0, vitest_1.it)('delivers emitted events to a subscribed listener', () => {
        const bus = (0, progress_1.createProgressBus)();
        const received = [];
        bus.on((e) => received.push(e));
        bus.emit('clone', 'cloning repo');
        (0, vitest_1.expect)(received).toHaveLength(1);
        (0, vitest_1.expect)(received[0].phase).toBe('clone');
        (0, vitest_1.expect)(received[0].message).toBe('cloning repo');
        (0, vitest_1.expect)(typeof received[0].timestamp).toBe('number');
    });
    (0, vitest_1.it)('supports data payload on emit', () => {
        const bus = (0, progress_1.createProgressBus)();
        const received = [];
        bus.on((e) => received.push(e));
        bus.emit('validate', 'checking', { step: 2 });
        (0, vitest_1.expect)(received[0].data).toEqual({ step: 2 });
    });
    (0, vitest_1.it)('delivers the same event to multiple listeners', () => {
        const bus = (0, progress_1.createProgressBus)();
        const a = [];
        const b = [];
        bus.on((e) => a.push(e));
        bus.on((e) => b.push(e));
        bus.emit('npm-install', 'installing');
        (0, vitest_1.expect)(a).toHaveLength(1);
        (0, vitest_1.expect)(b).toHaveLength(1);
        (0, vitest_1.expect)(a[0].phase).toBe('npm-install');
        (0, vitest_1.expect)(b[0].phase).toBe('npm-install');
    });
    (0, vitest_1.it)('on returns an unsubscribe function that stops delivery', () => {
        const bus = (0, progress_1.createProgressBus)();
        const listener = vitest_1.vi.fn();
        const off = bus.on(listener);
        bus.emit('resolve');
        (0, vitest_1.expect)(listener).toHaveBeenCalledTimes(1);
        off();
        bus.emit('resolve');
        (0, vitest_1.expect)(listener).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('once(phase) resolves when the phase is emitted', async () => {
        const bus = (0, progress_1.createProgressBus)();
        const pending = bus.once('done');
        bus.emit('done', 'all good');
        const ev = await pending;
        (0, vitest_1.expect)(ev.phase).toBe('done');
        (0, vitest_1.expect)(ev.message).toBe('all good');
    });
    (0, vitest_1.it)('once(phase) ignores other phases and resolves on the target phase', async () => {
        const bus = (0, progress_1.createProgressBus)();
        const pending = bus.once('done');
        bus.emit('clone');
        bus.emit('npm-install');
        bus.emit('done', 'finished');
        const ev = await pending;
        (0, vitest_1.expect)(ev.phase).toBe('done');
        (0, vitest_1.expect)(ev.message).toBe('finished');
    });
    (0, vitest_1.it)("once('done') rejects when 'error' is emitted first", async () => {
        const bus = (0, progress_1.createProgressBus)();
        const pending = bus.once('done');
        bus.emit('error', 'boom');
        await (0, vitest_1.expect)(pending).rejects.toThrow(/boom|error/i);
    });
    (0, vitest_1.it)("once('error') resolves normally when 'error' is the awaited phase", async () => {
        const bus = (0, progress_1.createProgressBus)();
        const pending = bus.once('error');
        bus.emit('error', 'oops');
        const ev = await pending;
        (0, vitest_1.expect)(ev.phase).toBe('error');
        (0, vitest_1.expect)(ev.message).toBe('oops');
    });
    (0, vitest_1.it)('allows many listeners without warnings (>10)', () => {
        const bus = (0, progress_1.createProgressBus)();
        const warn = vitest_1.vi.spyOn(console, 'warn').mockImplementation(() => { });
        const offs = [];
        for (let i = 0; i < 15; i++) {
            offs.push(bus.on(() => { }));
        }
        bus.emit('clone');
        (0, vitest_1.expect)(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        offs.forEach((off) => off());
    });
    (0, vitest_1.it)('events carry a numeric timestamp close to now', () => {
        const bus = (0, progress_1.createProgressBus)();
        const received = [];
        bus.on((e) => received.push(e));
        const before = Date.now();
        bus.emit('register');
        const after = Date.now();
        (0, vitest_1.expect)(received[0].timestamp).toBeGreaterThanOrEqual(before);
        (0, vitest_1.expect)(received[0].timestamp).toBeLessThanOrEqual(after);
    });
});
//# sourceMappingURL=progress.test.js.map