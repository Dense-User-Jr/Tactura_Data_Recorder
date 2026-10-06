/**
 * Tiny pub/sub. A throwing handler is logged and skipped so one broken
 * subscriber can never take the rest of the sim down with it.
 *
 * @typedef {(payload: any) => void} Handler
 * @typedef {Object} EventBus
 * @property {(type: string, fn: Handler) => () => void} on   returns an unsubscribe function
 * @property {(type: string, fn: Handler) => () => void} once
 * @property {(type: string, payload?: any) => void} emit
 */

/** @returns {EventBus} */
export function createEventBus() {
  /** @type {Map<string, Set<Handler>>} */
  const handlers = new Map();

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  }

  function once(type, fn) {
    const off = on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  function emit(type, payload) {
    const set = handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] handler for "${type}" threw`, err);
      }
    }
  }

  return { on, once, emit };
}
