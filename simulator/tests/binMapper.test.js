import { describe, expect, it } from 'vitest';
import { BinConfigError, BinMapper, validateBins } from '../src/pipeline/mapper/BinMapper.js';
import { GESTURE_IDS, gestureBins, mapper } from './fixtures.js';

/** @param {(bins: any[]) => void} edit */
const edited = (edit) => {
  const config = structuredClone(gestureBins);
  edit(config.bins);
  return config;
};

describe('BinMapper', () => {
  it('maps a gesture to its bin and phonemes (spec §1.2)', () => {
    expect(mapper().map({ gesture: 'DOUBLE_TAP' })).toEqual({ gesture: 'DOUBLE_TAP', bin: 'Affricate', phonemes: ['CH', 'JH'] });
    expect(mapper().map({ gesture: 'FLICK_UP' }).phonemes).toEqual(['TH', 'DH']);
  });

  it('knows which gesture spells each of the 12 phonemes', () => {
    const m = mapper();
    expect(m.phonemeCount).toBe(12);
    expect(m.gestureFor('UW')).toBe('TWIST_LEFT');
    expect(m.gestureFor('AH')).toBeUndefined();
  });
});

describe('validateBins (spec §8.5)', () => {
  it('accepts the committed config', () => {
    expect(validateBins(gestureBins, GESTURE_IDS)).toEqual([]);
  });

  it('catches a phoneme in two bins', () => {
    const problems = validateBins(edited((bins) => bins[0].phonemes.push('S')), GESTURE_IDS);
    expect(problems.join()).toMatch(/phoneme S is in both/);
  });

  it('catches a gesture listed twice and a gesture with no bin', () => {
    const problems = validateBins(edited((bins) => (bins[5].gesture = 'SHAKE')), GESTURE_IDS);
    expect(problems.join()).toMatch(/SHAKE appears in 2 bins/);
    expect(problems.join()).toMatch(/DOUBLE_TAP has no bin/);
  });

  it('catches unknown gestures and empty bins', () => {
    const problems = validateBins(
      edited((bins) => {
        bins[0].gesture = 'WAVE';
        bins[1].phonemes = [];
      }),
      GESTURE_IDS,
    );
    expect(problems.join()).toMatch(/unknown gesture "WAVE"/);
    expect(problems.join()).toMatch(/has no phonemes/);
  });

  it('makes the mapper refuse an invalid config with a readable error', () => {
    const bad = edited((bins) => bins.pop());
    expect(() => new BinMapper(bad, GESTURE_IDS)).toThrow(BinConfigError);
    expect(() => new BinMapper(bad, GESTURE_IDS)).toThrow(/DOUBLE_TAP has no bin/);
  });
});
