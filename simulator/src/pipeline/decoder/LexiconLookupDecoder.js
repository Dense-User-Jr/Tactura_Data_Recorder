import { Decoder } from './Decoder.js';
import { sequenceKey } from '../lexicon/Lexicon.js';

/**
 * Placeholder only. The real Tactura decoder is designed separately and
 * plugs into the `Decoder` interface.
 *
 * A plain dictionary lookup (spec §8.7):
 *   exact          every lexicon word whose full gesture sequence equals the
 *                  buffer, ranked by word frequency (zipf), descending
 *   prefixCount    how many words start with the buffer
 *   prefixPreview  the top 3 of those
 * No language model, no context, no fuzzy matching.
 *
 * @typedef {import('../types.js').BinToken} BinToken
 * @typedef {import('../types.js').DecodeResult} DecodeResult
 */
export class LexiconLookupDecoder extends Decoder {
  name = 'lexicon lookup (placeholder)';

  /** @param {import('../lexicon/Lexicon.js').Lexicon | null} lexicon null if the lexicon failed to load */
  constructor(lexicon) {
    super();
    this.lexicon = lexicon;
  }

  /**
   * @param {BinToken[]} tokens
   * @returns {DecodeResult}
   */
  decode(tokens) {
    if (!this.lexicon) return { exact: [], prefixCount: 0, prefixPreview: [] };
    const key = sequenceKey(tokens.map((t) => t.gesture));
    const { count, preview } = this.lexicon.prefix(key, 3);
    return { exact: key ? this.lexicon.exact(key) : [], prefixCount: count, prefixPreview: preview };
  }
}
