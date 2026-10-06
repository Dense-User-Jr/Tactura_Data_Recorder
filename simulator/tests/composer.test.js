import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/eventBus.js';
import { createStore } from '../src/core/store.js';
import { GESTURES } from '../src/config/gestures.js';
import { Composer, emptyCompose } from '../src/pipeline/Composer.js';
import { Pipeline, stagesWith } from '../src/pipeline/Pipeline.js';
import { excludeText, gestureBins, lexiconData } from './fixtures.js';

async function setup(breakName = null) {
  const bus = createEventBus();
  const store = createStore({ compose: emptyCompose() });
  const statuses = {};
  const pipeline = new Pipeline({
    stages: stagesWith(breakName),
    notify: () => {},
    onStatus: (name, status) => (statuses[name] = status),
  });
  pipeline.loadBins(gestureBins);
  pipeline.loadLexicon(lexiconData, { excludeText });
  await pipeline.loadStage('classifier');
  await pipeline.loadStage('decoder');
  const composer = new Composer({ pipeline, store, bus, sinceStart: (t) => t });
  /** Fire gesture keys like the keyboard does. @param {string} keys */
  const type = (keys) =>
    Promise.all([...keys].map((k, i) => composer.push({ source: 'keyboard', t: i, label: GESTURES[Number(k) - 1].id })));
  const events = [];
  for (const name of ['compose:commit', 'compose:noword', 'compose:uncommit', 'compose:clearall']) bus.on(name, (p) => events.push([name, p]));
  return { composer, store, type, events, statuses };
}

const compose = (store) => store.get().compose;

describe('Composer (spec §6.4 core flow, §14 Phase 3 acceptance)', () => {
  it('6 3 5 Space commits cheese', async () => {
    const { composer, store, type, events } = await setup();
    await type('635');
    expect(compose(store).result.exact[0].word).toBe('cheese');
    await composer.commit();
    expect(compose(store).transcript).toEqual(['cheese']);
    expect(compose(store).buffer).toEqual([]);
    expect(events).toEqual([['compose:commit', expect.objectContaining({ word: 'cheese' })]]);
  });

  it('6 4 5 shows choose and juice as a collision, and Tab cycles them', async () => {
    const { composer, store, type } = await setup();
    await type('645');
    expect(compose(store).result.exact.map((c) => c.word)).toEqual(['choose', 'jews', 'juice']);
    expect(composer.canCycle).toBe(true);
    await composer.cycle(1);
    await composer.cycle(1);
    expect(compose(store).selected).toBe(2);
    await composer.cycle(1); // wraps
    expect(compose(store).selected).toBe(0);
    await composer.cycle(-1); // Shift+Tab wraps backwards
    await composer.commit();
    expect(compose(store).transcript).toEqual(['juice']);
  });

  it('Backspace removes the last gesture, then the last word when the buffer is empty', async () => {
    const { composer, store, type, events } = await setup();
    await type('635');
    await composer.commit();
    await type('64');
    await composer.backspace();
    expect(compose(store).buffer.map((t) => t.gesture)).toEqual(['DOUBLE_TAP']);
    await composer.backspace();
    expect(compose(store).buffer).toEqual([]);
    expect(compose(store).transcript).toEqual(['cheese']);
    await composer.backspace();
    expect(compose(store).transcript).toEqual([]);
    expect(events.at(-1)).toEqual(['compose:uncommit', { word: 'cheese' }]);
  });

  it('a nonsense sequence plus Space signals NO WORD and keeps the buffer', async () => {
    const { composer, store, type, events } = await setup();
    await type('555');
    await composer.commit();
    expect(events).toEqual([['compose:noword', expect.anything()]]);
    expect(compose(store).buffer).toHaveLength(3);
    expect(compose(store).transcript).toEqual([]);
  });

  it('Esc clears the buffer', async () => {
    const { composer, store, type } = await setup();
    await type('63');
    await composer.clear();
    expect(compose(store).buffer).toEqual([]);
  });

  it('R clears the buffer and every committed word at once', async () => {
    const { composer, store, type, events } = await setup();
    await type('635');
    await composer.commit();
    await type('645');
    await composer.commit();
    await type('63');
    await composer.clearAll();
    expect(compose(store)).toMatchObject({ buffer: [], result: null, transcript: [] });
    expect(events.at(-1)).toEqual(['compose:clearall', { words: ['cheese', 'choose'] }]);
    await composer.clearAll(); // nothing left: no event
    expect(events.filter(([name]) => name === 'compose:clearall')).toHaveLength(1);
  });

  it('records a trace row per gesture, newest first, at most 8', async () => {
    const { store, type } = await setup();
    await type('1234561234');
    const { trace } = compose(store);
    expect(trace).toHaveLength(8);
    expect(trace[0].gesture).toBe('TWIST_LEFT');
    expect(trace[0]).toMatchObject({ source: 'keyboard', confidence: 1 });
  });

  it('keeps working when a project classifier crashes on every event', async () => {
    const toast = vi.fn();
    const { composer, store, type, statuses } = await setup('classifier-runtime');
    composer.bus.on('toast', toast);
    await type('635');
    expect(compose(store).result.exact[0].word).toBe('cheese');
    expect(statuses.classifier.mode).toBe('error');
  });
});
