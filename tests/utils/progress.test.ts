import { describe, it, expect, vi } from 'vitest';
import { createProgressBus, type ProgressEvent } from '../../src/utils/progress';

describe('createProgressBus', () => {
  it('delivers emitted events to a subscribed listener', () => {
    const bus = createProgressBus();
    const received: ProgressEvent[] = [];
    bus.on((e) => received.push(e));

    bus.emit('clone', 'cloning repo');

    expect(received).toHaveLength(1);
    expect(received[0]!.phase).toBe('clone');
    expect(received[0]!.message).toBe('cloning repo');
    expect(typeof received[0]!.timestamp).toBe('number');
  });

  it('supports data payload on emit', () => {
    const bus = createProgressBus();
    const received: ProgressEvent[] = [];
    bus.on((e) => received.push(e));

    bus.emit('validate', 'checking', { step: 2 });

    expect(received[0]!.data).toEqual({ step: 2 });
  });

  it('delivers the same event to multiple listeners', () => {
    const bus = createProgressBus();
    const a: ProgressEvent[] = [];
    const b: ProgressEvent[] = [];
    bus.on((e) => a.push(e));
    bus.on((e) => b.push(e));

    bus.emit('npm-install', 'installing');

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.phase).toBe('npm-install');
    expect(b[0]!.phase).toBe('npm-install');
  });

  it('on returns an unsubscribe function that stops delivery', () => {
    const bus = createProgressBus();
    const listener = vi.fn();
    const off = bus.on(listener);

    bus.emit('resolve');
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    bus.emit('resolve');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('once(phase) resolves when the phase is emitted', async () => {
    const bus = createProgressBus();
    const pending = bus.once('done');

    bus.emit('done', 'all good');

    const ev = await pending;
    expect(ev.phase).toBe('done');
    expect(ev.message).toBe('all good');
  });

  it('once(phase) ignores other phases and resolves on the target phase', async () => {
    const bus = createProgressBus();
    const pending = bus.once('done');

    bus.emit('clone');
    bus.emit('npm-install');
    bus.emit('done', 'finished');

    const ev = await pending;
    expect(ev.phase).toBe('done');
    expect(ev.message).toBe('finished');
  });

  it("once('done') rejects when 'error' is emitted first", async () => {
    const bus = createProgressBus();
    const pending = bus.once('done');

    bus.emit('error', 'boom');

    await expect(pending).rejects.toThrow(/boom|error/i);
  });

  it("once('error') resolves normally when 'error' is the awaited phase", async () => {
    const bus = createProgressBus();
    const pending = bus.once('error');

    bus.emit('error', 'oops');

    const ev = await pending;
    expect(ev.phase).toBe('error');
    expect(ev.message).toBe('oops');
  });

  it('allows many listeners without warnings (>10)', () => {
    const bus = createProgressBus();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const offs: Array<() => void> = [];
    for (let i = 0; i < 15; i++) {
      offs.push(bus.on(() => {}));
    }
    bus.emit('clone');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    offs.forEach((off) => off());
  });

  it('events carry a numeric timestamp close to now', () => {
    const bus = createProgressBus();
    const received: ProgressEvent[] = [];
    bus.on((e) => received.push(e));

    const before = Date.now();
    bus.emit('register');
    const after = Date.now();

    expect(received[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(received[0]!.timestamp).toBeLessThanOrEqual(after);
  });
});
