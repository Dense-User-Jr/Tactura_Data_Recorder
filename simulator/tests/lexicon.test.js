import { describe, expect, it } from 'vitest';
import { GESTURES } from '../src/config/gestures.js';
import { sequenceKey } from '../src/pipeline/lexicon/Lexicon.js';
import { gestureBins, lexicon, lexiconData } from './fixtures.js';

describe('lexicon_base.json (spec §8.6 sanity check)', () => {
  // Recompute the spec's numbers straight from the data file: top 5k, before any exclusions.
  const phonemeOk = new Set(gestureBins.bins.flatMap((b) => b.phonemes));
  const gestureOf = Object.fromEntries(gestureBins.bins.flatMap((b) => b.phonemes.map((p) => [p, b.gesture])));
  const raw = [];
  for (const [word, , prons, rank] of lexiconData.words) {
    if (rank >= 5000) continue;
    for (const pron of prons) {
      const ph = pron.split(' ');
      if (ph.every((p) => phonemeOk.has(p))) raw.push([word, ph.map((p) => gestureOf[p]).join(' ')]);
    }
  }
  const bySeq = new Map();
  for (const [word, seq] of raw) bySeq.set(seq, new Set([...(bySeq.get(seq) ?? []), word]));

  it('has 37 spellable entries, 26 sequences, 6 shared at top 5k', () => {
    expect(raw).toHaveLength(37);
    expect(bySeq.size).toBe(26);
    expect([...bySeq.values()].filter((w) => w.size > 1)).toHaveLength(6);
  });

  it('has the collisions the spec lists', () => {
    expect([...bySeq.get('DOUBLE_TAP TWIST_LEFT SHAKE')]).toEqual(expect.arrayContaining(['choose', 'juice']));
    expect([...bySeq.get('FLICK_DOWN TWIST_RIGHT SHAKE')]).toEqual(expect.arrayContaining(['peace', 'piece']));
    expect([...bySeq.get('FLICK_DOWN TWIST_LEFT DOUBLE_TAP')]).toContain('pitch');
  });

  it('has ~114 spellable words at top 20k and ~217 at top 50k', () => {
    const spellableWords = (top) =>
      new Set(
        lexiconData.words
          .filter(([, , prons, rank]) => rank < top && prons.some((p) => p.split(' ').every((ph) => phonemeOk.has(ph))))
          .map(([word]) => word),
      ).size;
    expect(spellableWords(20000)).toBe(114);
    expect(spellableWords(50000)).toBe(217);
  });

  it('stays under the ~3 MB budget and is not pre-filtered by bins', () => {
    expect(JSON.stringify(lexiconData).length).toBeLessThan(3_000_000);
    expect(lexiconData.words.length).toBeGreaterThan(40_000);
  });
});

describe('Lexicon (runtime filter)', () => {
  it('drops single letters, acronyms and crude words: 37 → 26 words at top 5k', () => {
    const lex = lexicon();
    expect(lex.stats.words).toBe(26);
    const words = new Set(lex.entries.map((e) => e.word));
    for (const gone of ['b', 'c', 'e', 'p', 'g', 'z', 'bbc', 'pc', 'bc', 'bitch', 'pussy']) expect(words.has(gone)).toBe(false);
    for (const kept of ['cheese', 'choose', 'juice', 'these', 'speech', 'beach', 'is', 'this']) expect(words.has(kept)).toBe(true);
  });

  it('keeps crude words when the filter is off', () => {
    const words = new Set(lexicon({ filterCrude: false }).entries.map((e) => e.word));
    expect(words.has('bitch')).toBe(true);
  });

  it('counts collisions after filtering: see/sea, peace/piece, choose/jews/juice', () => {
    expect(lexicon().stats.collisions).toBe(3);
  });

  it('grows with the size setting, and filtering only ever removes words', () => {
    const k5 = lexicon().stats.words;
    const k20 = lexicon({ size: 20000 }).stats.words;
    const k50 = lexicon({ size: 50000 }).stats.words;
    expect(k20).toBeGreaterThan(k5);
    expect(k50).toBeGreaterThan(k20);
    expect(k20).toBeLessThan(114); // before exclusions (see the data sanity check above)
    expect(k50).toBeLessThan(217);
  });

  it('ranks exact matches by frequency', () => {
    const lex = lexicon();
    expect(lex.exact('645').map((c) => c.word)).toEqual(['choose', 'jews', 'juice']);
    expect(lex.exact('635')[0]).toEqual({ word: 'cheese', phonemes: ['CH', 'IY', 'Z'], zipf: 4.57 });
  });

  it('counts and previews prefix matches', () => {
    const { count, preview } = lexicon().prefix('6');
    expect(count).toBe(6); // choose, cheap, cheese, jews, juice, chip
    expect(preview.map((c) => c.word)).toEqual(['choose', 'cheap', 'cheese']);
  });

  it('uses one character per gesture in sequence keys', () => {
    expect(sequenceKey(['DOUBLE_TAP', 'TWIST_RIGHT', 'SHAKE'])).toBe('635');
    expect(sequenceKey(GESTURES.map((g) => g.id))).toBe('123456');
  });
});
