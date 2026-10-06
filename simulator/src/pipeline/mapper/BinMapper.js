/**
 * Bin mapper stage (spec §8.2, §8.5): gesture → the bin of phonemes it carries.
 * Reads gesture_bins.json, the single source of truth for the assignment.
 * This is real project config, shared by the sim and (later) the watch, not
 * a stand-in.
 *
 * @typedef {import('../types.js').GestureId} GestureId
 * @typedef {import('../types.js').GestureEvent} GestureEvent
 * @typedef {import('../types.js').BinToken} BinToken
 * @typedef {{ gesture: string, bin: string, phonemes: string[], score?: number }} BinDef
 * @typedef {{ version: number, source?: string, bins: BinDef[] }} BinsConfig
 */

export class BinConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`gesture_bins.json is invalid: ${problems.join('; ')}`);
    this.name = 'BinConfigError';
    this.problems = problems;
  }
}

/**
 * Checks the bins config (spec §8.5): every gesture appears exactly once, and
 * every phoneme in at most one bin.
 * @param {BinsConfig} config
 * @param {readonly string[]} gestureIds all gestures the sim knows
 * @returns {string[]} readable problems; empty when valid
 */
export function validateBins(config, gestureIds) {
  const problems = [];
  if (!config || !Array.isArray(config.bins)) return ['missing "bins" array'];

  const seenGestures = new Map();
  const phonemeOwner = new Map();
  for (const [i, bin] of config.bins.entries()) {
    const where = `bin ${i + 1}${bin?.gesture ? ` (${bin.gesture})` : ''}`;
    if (!bin || typeof bin.gesture !== 'string') {
      problems.push(`${where} has no gesture`);
      continue;
    }
    if (!gestureIds.includes(bin.gesture)) problems.push(`${where}: unknown gesture "${bin.gesture}"`);
    seenGestures.set(bin.gesture, (seenGestures.get(bin.gesture) ?? 0) + 1);
    if (!Array.isArray(bin.phonemes) || bin.phonemes.length === 0) {
      problems.push(`${where} has no phonemes`);
      continue;
    }
    for (const phoneme of bin.phonemes) {
      const owner = phonemeOwner.get(phoneme);
      if (owner && owner !== bin.gesture) problems.push(`phoneme ${phoneme} is in both ${owner} and ${bin.gesture}`);
      else if (owner === bin.gesture) problems.push(`phoneme ${phoneme} is listed twice in ${bin.gesture}`);
      phonemeOwner.set(phoneme, bin.gesture);
    }
  }
  for (const id of gestureIds) {
    const count = seenGestures.get(id) ?? 0;
    if (count === 0) problems.push(`gesture ${id} has no bin`);
    if (count > 1) problems.push(`gesture ${id} appears in ${count} bins`);
  }
  return problems;
}

export class BinMapper {
  /**
   * @param {BinsConfig} config
   * @param {readonly string[]} gestureIds
   * @throws {BinConfigError} if the config fails validation
   */
  constructor(config, gestureIds) {
    const problems = validateBins(config, gestureIds);
    if (problems.length) throw new BinConfigError(problems);
    this.config = config;
    /** @type {Map<string, BinDef>} */
    this.byGesture = new Map(config.bins.map((b) => [b.gesture, b]));
    /** @type {Map<string, GestureId>} */
    this.gestureByPhoneme = new Map(
      config.bins.flatMap((b) => b.phonemes.map((p) => [p, /** @type {GestureId} */ (b.gesture)])),
    );
  }

  get phonemeCount() {
    return this.gestureByPhoneme.size;
  }

  /**
   * @param {Pick<GestureEvent, 'gesture'>} event
   * @returns {BinToken}
   */
  map(event) {
    const bin = this.byGesture.get(event.gesture);
    if (!bin) throw new Error(`no bin for gesture ${event.gesture}`);
    return { gesture: event.gesture, bin: bin.bin, phonemes: [...bin.phonemes] };
  }

  /** @param {string} phoneme ARPAbet, stress stripped @returns {GestureId | undefined} */
  gestureFor(phoneme) {
    return this.gestureByPhoneme.get(phoneme);
  }
}
