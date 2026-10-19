/**
 * Lexicon settings (spec §8.6). The settings panel (Phase 5) exposes size and
 * the crude filter; until then these defaults apply.
 */

/** Lexicon size options: how many of wordfreq's most frequent English words to consider. */
export const LEXICON_SIZES = [5000, 20000, 50000];

/** Top 5k matches the collision analysis behind the bin assignment. */
export const DEFAULT_LEXICON_SIZE = 5000;

export const DEFAULT_FILTER_CRUDE = true;

/**
 * Crude words hidden while "Filter crude words" is on. Small on purpose:
 * the ones spellable with today's bins, plus common ones future bins could reach.
 */
export const CRUDE_WORDS = [
  'bitch',
  'bitches',
  'bitchy',
  'boob',
  'boobs',
  'booby',
  'piss',
  'pissed',
  'pisses',
  'pissing',
  'puss',
  'pussies',
  'pussy',
  // not spellable with the v1 bins
  'ass',
  'asshole',
  'bastard',
  'cock',
  'cunt',
  'dick',
  'fuck',
  'fucking',
  'shit',
  'slut',
  'tits',
  'whore',
];
