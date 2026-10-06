import { GESTURES } from '../config/gestures.js';
import { BinMapper } from './mapper/BinMapper.js';
import { Lexicon, parseWordList } from './lexicon/Lexicon.js';
import { LexiconLookupDecoder } from './decoder/LexiconLookupDecoder.js';
import { PassthroughClassifier } from './classifier/PassthroughClassifier.js';
import { StageSocket, loadStage } from './registry.js';

/**
 * The pipeline (spec §8):
 *
 *   RawInput → segment → classify → GestureEvent → bin mapper → BinToken
 *            → (buffer) → decode → DecodeResult
 *
 * @typedef {import('./types.js').RawInput} RawInput
 * @typedef {import('./types.js').GestureEvent} GestureEvent
 * @typedef {import('./types.js').GestureId} GestureId
 * @typedef {import('./types.js').BinToken} BinToken
 * @typedef {import('./types.js').DecodeResult} DecodeResult
 * @typedef {import('./types.js').StageStatus} StageStatus
 * @typedef {{ lexicon: Lexicon | null, mapper: BinMapper | null }} StageContext
 */

/**
 * Which implementation each stage uses. To plug in a real component, set its
 * `project` loader (a dynamic import plus any init); that is the whole change.
 * Loaders receive { lexicon, mapper }. If a project loader fails, or the
 * project throws on an event, the stand-in takes over and the badge says so.
 */
export const STAGES = {
  classifier: {
    standIn: () => new PassthroughClassifier(),
    // Raghav's random forest, once ported (see classifier/RandomForestClassifier.js):
    // project: async () => {
    //   const { RandomForestClassifier } = await import('./classifier/RandomForestClassifier.js');
    //   const classifier = new RandomForestClassifier();
    //   await classifier.init();
    //   return classifier;
    // },
    project: null,
  },
  decoder: {
    standIn: (/** @type {StageContext} */ { lexicon }) => new LexiconLookupDecoder(lexicon),
    // Russell's decoder (see decoder/Decoder.js for the contract):
    // project: async (ctx) => new (await import('./decoder/TacturaDecoder.js')).TacturaDecoder(ctx),
    project: null,
  },
};

/**
 * Test switches for the fallback path (spec §14, Phase 3). Add `?break=<name>`
 * to the URL; nothing changes without it.
 */
export const BREAKS = {
  /** a configured project classifier whose init() throws: today's random-forest stub */
  classifier: {
    classifier: {
      project: async () => {
        const { RandomForestClassifier } = await import('./classifier/RandomForestClassifier.js');
        const classifier = new RandomForestClassifier();
        await classifier.init();
        return classifier;
      },
    },
  },
  /** a project classifier that loads, then throws on every gesture */
  'classifier-runtime': {
    classifier: {
      project: () => ({
        name: 'crashing test double',
        classify: async () => {
          throw new Error('simulated crash inside classify()');
        },
      }),
    },
  },
  /** a project decoder pointing at a file that does not exist */
  decoder: {
    decoder: {
      project: async () => {
        const missing = './decoder/NoSuchDecoder.js';
        const module = await import(/* @vite-ignore */ missing);
        return new module.default();
      },
    },
  },
};

/**
 * STAGES with any `?break=` switch from the URL applied.
 * @param {string | null} breakName
 */
export function stagesWith(breakName) {
  const override = breakName ? /** @type {Record<string, any>} */ (BREAKS)[breakName] : null;
  if (!override) return STAGES;
  return /** @type {typeof STAGES} */ (
    Object.fromEntries(Object.entries(STAGES).map(([name, sources]) => [name, { ...sources, ...(override[name] ?? {}) }]))
  );
}

const GESTURE_IDS = GESTURES.map((g) => g.id);

/**
 * Segmenter stand-in (spec §8.2): pass-through, because a keypress is
 * already exactly one gesture. Real segmentation of a continuous IMU stream
 * replaces this when phone streaming arrives.
 * @param {RawInput} raw
 * @returns {RawInput[]}
 */
function segment(raw) {
  return [raw];
}

/** @param {Record<string, number>} probabilities @returns {[GestureId, number]} */
function argmax(probabilities) {
  let best = /** @type {GestureId} */ (GESTURE_IDS[0]);
  let bestP = -Infinity;
  for (const [id, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      best = /** @type {GestureId} */ (id);
      bestP = p;
    }
  }
  return [best, bestP];
}

let eventSeq = 0;

export class Pipeline {
  /**
   * @param {{ stages?: typeof STAGES, notify: (message: string, error: unknown) => void, onStatus: (stage: string, status: StageStatus, impl: any) => void }} options
   */
  constructor({ stages = STAGES, notify, onStatus }) {
    this.stages = stages;
    this.notify = notify;
    this.onStatus = onStatus;
    /** @type {BinMapper | null} */
    this.mapper = null;
    /** @type {Lexicon | null} */
    this.lexicon = null;
    /** @type {StageSocket<any> | null} */
    this.classifier = null;
    /** @type {StageSocket<any> | null} */
    this.decoder = null;
  }

  /**
   * Validates and loads the bin assignment. Throws BinConfigError if invalid.
   * @param {import('./mapper/BinMapper.js').BinsConfig} config
   */
  loadBins(config) {
    this.mapper = new BinMapper(config, GESTURE_IDS);
    return this.mapper;
  }

  /**
   * Builds the spellable vocabulary for the current bins.
   * @param {import('./lexicon/Lexicon.js').LexiconData} data
   * @param {{ excludeText?: string } & import('./lexicon/Lexicon.js').LexiconOptions} [options]
   */
  loadLexicon(data, { excludeText = '', ...options } = {}) {
    if (!this.mapper) throw new Error('bins must load before the lexicon');
    this.lexicon = new Lexicon(data, this.mapper, { exclude: parseWordList(excludeText), ...options });
    return this.lexicon;
  }

  /**
   * Loads one stage through the registry.
   * @param {'classifier'|'decoder'} name
   * @returns {Promise<StageSocket<any>>}
   */
  async loadStage(name) {
    const loaded = await loadStage(name, this.stages[name], {
      context: { lexicon: this.lexicon, mapper: this.mapper },
      notify: this.notify,
    });
    const socket = new StageSocket(loaded, {
      notify: this.notify,
      onStatus: (status) => this.onStatus(name, status, loaded.impl),
    });
    this[name] = socket;
    return socket;
  }

  /**
   * One raw input → the gesture(s) it contains and their bins.
   * @param {RawInput} raw
   * @returns {Promise<Array<{ event: GestureEvent, token: BinToken }>>}
   */
  async recognize(raw) {
    if (!this.classifier) throw new Error('classifier stage not loaded');
    if (!this.mapper) throw new Error('no valid gesture bins loaded');
    const results = [];
    for (const piece of segment(raw)) {
      const { probabilities } = await this.classifier.call('classify', piece);
      const [gesture, confidence] = argmax(probabilities);
      /** @type {GestureEvent} */
      const event = { id: `g${++eventSeq}`, gesture, probabilities, confidence, source: piece.source, t: piece.t };
      results.push({ event, token: this.mapper.map(event) });
    }
    return results;
  }

  /**
   * @param {BinToken[]} tokens
   * @returns {Promise<DecodeResult>}
   */
  async decode(tokens) {
    if (!this.decoder) throw new Error('decoder stage not loaded');
    return this.decoder.call('decode', tokens);
  }
}
