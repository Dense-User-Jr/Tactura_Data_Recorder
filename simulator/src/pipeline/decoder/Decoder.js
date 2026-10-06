/**
 * The decoder socket: turns the gestures typed so far into words.
 *
 * If you're writing the real Tactura decoder, this is the only contract you
 * need to meet. Point `STAGES.decoder.project` in src/pipeline/Pipeline.js at
 * your module and the sim uses it, with the top-bar badge reading
 * `DEC: PROJECT`. If it fails to load or throws, the sim falls back to the
 * placeholder lookup for that event and flips the badge to `DEC: ERROR`.
 *
 * INPUT: `tokens`, the current word buffer in order. Each token is one
 * gesture and the bin of phonemes it stands for:
 *
 *   [
 *     { gesture: 'DOUBLE_TAP',  bin: 'Affricate', phonemes: ['CH', 'JH'] },
 *     { gesture: 'TWIST_RIGHT', bin: 'High vowel (front-tense / back-lax)', phonemes: ['IY', 'UH'] },
 *     { gesture: 'SHAKE',       bin: 'Sibilant fricative', phonemes: ['S', 'Z'] },
 *   ]
 *
 * Each gesture is ambiguous between its bin's phonemes; resolving that is
 * the decoder's job. An empty array means nothing has been typed.
 *
 * OUTPUT: a DecodeResult (see types.js), or a Promise of one:
 *
 *   {
 *     exact: [                       // words this exact sequence spells, best first.
 *       { word: 'cheese', phonemes: ['CH', 'IY', 'Z'], zipf: 4.57 },
 *     ],                             // Space commits exact[selected]; Tab cycles through them
 *     prefixCount: 3,                // how many words the user could still be spelling
 *     prefixPreview: [ ... ],        // a few of those, best first (live preview)
 *   }
 *
 * The UI only reads these three fields, so a smarter decoder (context, a
 * language model, fuzzy matching) changes the ranking and contents, not the
 * shape. `zipf` is a word-frequency score (wordfreq's Zipf scale, ~0–8);
 * the trace panel draws it as a bar, so return something comparable or 0.
 *
 * Optional: `init()` (sync or async) runs once when the stage loads; throw
 * from it to signal the decoder can't start.
 *
 * @typedef {import('../types.js').BinToken} BinToken
 * @typedef {import('../types.js').DecodeResult} DecodeResult
 * @interface
 */
export class Decoder {
  /**
   * @param {BinToken[]} _tokens
   * @returns {DecodeResult | Promise<DecodeResult>}
   */
  decode(_tokens) {
    throw new Error(`${this.constructor.name}.decode() not implemented`);
  }
}
