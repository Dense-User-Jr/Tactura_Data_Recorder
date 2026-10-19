import { DEFAULT_FINISH, FINISHES } from '../scene/watch/materials.js';
import { DEFAULT_FILTER_CRUDE, DEFAULT_LEXICON_SIZE, LEXICON_SIZES } from './lexicon.js';
import { DEFAULT_VOICE, VOICES } from './voice.js';
import { readPref, writePref } from '../core/prefs.js';

/**
 * Everything the settings panel controls, with defaults. Each slice lives in
 * the app store and is remembered per browser (localStorage), field by field
 * validated on load so a stale or hand-edited value can't break the sim.
 */
export const SETTINGS_DEFAULTS = {
  watch: { finish: DEFAULT_FINISH, mannequin: true }, // spec §10.4: mannequin default ON
  view: { annotations: true, telemetry: true }, // spec §10.6: callouts default ON
  lexicon: { size: DEFAULT_LEXICON_SIZE, filterCrude: DEFAULT_FILTER_CRUDE },
  voice: { id: DEFAULT_VOICE, muted: false, volume: 0.9 },
  sound: { volume: 0.35 }, // spec §7.5: on by default, quiet
};

const isBool = (v) => typeof v === 'boolean';
const isUnit = (v) => typeof v === 'number' && v >= 0 && v <= 1;

/** @type {Record<string, Record<string, (v: unknown) => boolean>>} */
const VALID = {
  watch: { finish: (v) => typeof v === 'string' && v in FINISHES, mannequin: isBool },
  view: { annotations: isBool, telemetry: isBool },
  lexicon: { size: (v) => LEXICON_SIZES.includes(/** @type {number} */ (v)), filterCrude: isBool },
  voice: { id: (v) => VOICES.some((x) => x.id === v), muted: isBool, volume: isUnit },
  sound: { volume: isUnit },
};

/** @typedef {typeof SETTINGS_DEFAULTS} Settings */

/** Saved settings merged over the defaults. @returns {Settings} */
export function loadSettings() {
  /** @type {any} */
  const out = {};
  for (const [slice, defaults] of Object.entries(SETTINGS_DEFAULTS)) {
    const saved = readPref(`settings.${slice}`, {}, (v) => typeof v === 'object' && v !== null);
    out[slice] = Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, key in saved && VALID[slice][key](saved[key]) ? saved[key] : value]),
    );
  }
  return out;
}

/** @param {keyof Settings} slice @param {object} value */
export function saveSetting(slice, value) {
  writePref(`settings.${slice}`, value);
}

/** Store updater that puts every setting back to its default. @template S @param {S} state @returns {S} */
export function resetSettings(state) {
  return { ...state, ...structuredClone(SETTINGS_DEFAULTS) };
}
