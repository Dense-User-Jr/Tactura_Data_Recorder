/**
 * Per-browser view preferences (finish, arm on/off, ...). These are
 * conveniences, so plain localStorage: if storage is unavailable (private
 * window, blocked site data) reads fall back and writes are dropped.
 */

const PREFIX = 'tactura.sim.';

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @param {(value: unknown) => boolean} [isValid]
 * @returns {T}
 */
export function readPref(key, fallback, isValid = () => true) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** @param {string} key @param {unknown} value */
export function writePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // not persisted; the sim works the same
  }
}
