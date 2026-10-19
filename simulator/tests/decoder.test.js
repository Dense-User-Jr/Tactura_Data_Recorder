import { describe, expect, it } from 'vitest';
import { LexiconLookupDecoder } from '../src/pipeline/decoder/LexiconLookupDecoder.js';
import { lexicon, tokens } from './fixtures.js';

const decoder = new LexiconLookupDecoder(lexicon());
const words = (cands) => cands.map((c) => c.word);

describe('LexiconLookupDecoder (placeholder, spec §8.7)', () => {
  it('6 3 5 decodes to cheese', () => {
    const result = decoder.decode(tokens('635'));
    expect(words(result.exact)).toEqual(['cheese']);
  });

  it('6 4 5 is a collision: choose, jews, juice, most frequent first', () => {
    expect(words(decoder.decode(tokens('645')).exact)).toEqual(['choose', 'jews', 'juice']);
  });

  it('spec example spellings decode', () => {
    expect(words(decoder.decode(tokens('45')).exact)).toContain('is');
    expect(words(decoder.decode(tokens('145')).exact)).toContain('this');
    expect(words(decoder.decode(tokens('135')).exact)).toContain('these');
    expect(words(decoder.decode(tokens('5236')).exact)).toContain('speech');
    expect(words(decoder.decode(tokens('236')).exact)).toContain('beach');
  });

  it('reports prefix matches while typing', () => {
    const one = decoder.decode(tokens('6'));
    expect(one.exact).toEqual([]);
    expect(one.prefixCount).toBe(6);
    expect(one.prefixPreview).toHaveLength(3);
    const two = decoder.decode(tokens('63'));
    expect(two.prefixCount).toBeLessThan(one.prefixCount);
    expect(words(two.prefixPreview)).toContain('cheese');
  });

  it('a nonsense sequence has no matches at all', () => {
    expect(decoder.decode(tokens('555'))).toEqual({ exact: [], prefixCount: 0, prefixPreview: [] });
  });

  it('an empty buffer has no exact match and every word as a prefix match', () => {
    const result = decoder.decode([]);
    expect(result.exact).toEqual([]);
    expect(result.prefixCount).toBe(26);
  });

  it('returns empty results instead of crashing when the lexicon failed to load', () => {
    expect(new LexiconLookupDecoder(null).decode(tokens('635'))).toEqual({ exact: [], prefixCount: 0, prefixPreview: [] });
  });
});
