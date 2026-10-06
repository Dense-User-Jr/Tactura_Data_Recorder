// Shared test setup: the real committed data, so tests catch drift in it.
import lexiconData from '../public/data/lexicon_base.json';
import gestureBins from '../src/config/gesture_bins.json';
import excludeText from '../tools/lexicon_exclude.txt?raw';
import { GESTURES } from '../src/config/gestures.js';
import { BinMapper } from '../src/pipeline/mapper/BinMapper.js';
import { Lexicon, parseWordList } from '../src/pipeline/lexicon/Lexicon.js';

export { lexiconData, gestureBins, excludeText };

export const GESTURE_IDS = GESTURES.map((g) => g.id);

export const mapper = () => new BinMapper(gestureBins, GESTURE_IDS);

/** @param {import('../src/pipeline/lexicon/Lexicon.js').LexiconOptions} [options] */
export const lexicon = (options = {}) =>
  new Lexicon(lexiconData, mapper(), { exclude: parseWordList(excludeText), ...options });

/** BinTokens for a run of gesture keys, e.g. tokens('635'). @param {string} keys */
export function tokens(keys) {
  const m = mapper();
  return [...keys].map((k) => m.map({ gesture: GESTURES[Number(k) - 1].id }));
}
