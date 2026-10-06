import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/eventBus.js';
import { createStore } from '../src/core/store.js';
import { formatT } from '../src/core/clock.js';

describe('eventBus', () => {
  it('delivers payloads and unsubscribes', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    const off = bus.on('gesture', fn);
    bus.emit('gesture', { id: 1 });
    off();
    bus.emit('gesture', { id: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ id: 1 });
  });

  it('keeps delivering when one handler throws', () => {
    const bus = createEventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    bus.on('x', () => {
      throw new Error('boom');
    });
    bus.on('x', after);
    bus.emit('x');
    expect(after).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('once fires a single time', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.once('x', fn);
    bus.emit('x');
    bus.emit('x');
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('store', () => {
  it('watch fires immediately, then only when the slice changes', () => {
    const store = createStore({ ui: { left: true }, perf: { fps: 0 } });
    const seen = [];
    store.watch((s) => s.ui, (ui) => seen.push(ui.left));
    store.set({ perf: { fps: 60 } }); // different slice: no call
    store.update((s) => ({ ...s, ui: { left: false } }));
    expect(seen).toEqual([true, false]);
  });

  it('set merges shallowly', () => {
    const store = createStore({ a: 1, b: 2 });
    store.set({ b: 3 });
    expect(store.get()).toEqual({ a: 1, b: 3 });
  });
});

describe('formatT', () => {
  it('pads to four digits like the HUD microcopy', () => {
    expect(formatT(412)).toBe('T+0412ms');
    expect(formatT(12345.6)).toBe('T+12346ms');
  });
});
