/**
 * Stage loading and fallback (spec §8.3). Every stage is a socket with a
 * stand-in that ships with the sim and an optional project implementation.
 * Missing or broken project code never blocks the sim: it falls back to the
 * stand-in, says so in the stage's status (shown as a top-bar badge), and
 * keeps running.
 *
 * Status modes:
 *   project   the project implementation is running
 *   stand-in  no project implementation is configured; the stand-in runs
 *   error     a project implementation is configured but failed to load, or
 *             threw on some event; the stand-in covered for it. `reason` says what happened.
 *
 * @typedef {import('./types.js').StageStatus} StageStatus
 * @typedef {(message: string, error: unknown) => void} Notify
 */

/**
 * @template T, C
 * @typedef {Object} StageSources
 * @property {(context: C) => T | Promise<T>} standIn
 * @property {((context: C) => T | Promise<T>) | null} [project]  dynamic import + init
 */

/**
 * @template T
 * @typedef {{ impl: T, standIn: T, status: StageStatus }} LoadedStage
 */

/** @param {unknown} err */
export function describeError(err) {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * @template T, C
 * @param {string} name
 * @param {StageSources<T, C>} sources
 * @param {{ context?: C, notify?: Notify }} [options]
 * @returns {Promise<LoadedStage<T>>}
 */
export async function loadStage(name, { project, standIn }, { context, notify = () => {} } = {}) {
  const fallback = await standIn(/** @type {C} */ (context));
  if (!project) {
    return { impl: fallback, standIn: fallback, status: { mode: 'stand-in', name, reason: 'no project implementation configured' } };
  }
  try {
    const impl = await project(/** @type {C} */ (context));
    if (!impl) throw new Error('project loader returned nothing');
    return { impl, standIn: fallback, status: { mode: 'project', name } };
  } catch (err) {
    notify(`${name}: project failed to load, using stand-in`, err);
    return {
      impl: fallback,
      standIn: fallback,
      status: { mode: 'error', name, reason: `project implementation failed to load: ${describeError(err)}. Running the stand-in.` },
    };
  }
}

/**
 * A loaded stage plus per-call protection: if the project implementation
 * throws, the error is reported, the stand-in handles that call, and the
 * status flips to `error` (and stays there, so the problem stays visible).
 * @template T
 */
export class StageSocket {
  /**
   * @param {LoadedStage<T>} loaded
   * @param {{ notify?: Notify, onStatus?: (status: StageStatus) => void }} [hooks]
   */
  constructor({ impl, standIn, status }, { notify = () => {}, onStatus = () => {} } = {}) {
    this.impl = impl;
    this.standIn = standIn;
    this.status = status;
    this.notify = notify;
    this.onStatus = onStatus;
    onStatus(status);
  }

  /** True when the stand-in is what's running. */
  get usingStandIn() {
    return this.impl === this.standIn;
  }

  /**
   * @param {string} method
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async call(method, ...args) {
    if (this.usingStandIn) return /** @type {any} */ (this.standIn)[method](...args);
    try {
      return await /** @type {any} */ (this.impl)[method](...args);
    } catch (err) {
      this.notify(`${this.status.name}: project threw, stand-in used`, err);
      this.status = {
        mode: 'error',
        name: this.status.name,
        reason: `project implementation threw on ${method}(): ${describeError(err)}. The stand-in handled that event.`,
      };
      this.onStatus(this.status);
      return /** @type {any} */ (this.standIn)[method](...args);
    }
  }
}
