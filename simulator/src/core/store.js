/**
 * Single app state object. Treat state as immutable: `set` and `update`
 * replace slices instead of mutating them, so `watch` can compare with ===.
 *
 * @template S
 * @typedef {Object} Store
 * @property {() => S} get
 * @property {(patch: Partial<S>) => void} set                shallow merge at the top level
 * @property {(fn: (state: S) => S) => void} update
 * @property {(fn: (state: S, prev: S) => void) => () => void} subscribe
 * @property {<T>(select: (state: S) => T, fn: (value: T, prev: T | undefined) => void) => () => void} watch
 *           calls `fn` now and whenever the selected slice changes (===)
 */

/**
 * @template S
 * @param {S} initial
 * @returns {Store<S>}
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(state: S, prev: S) => void>} */
  const subscribers = new Set();

  function commit(next) {
    if (next === state) return;
    const prev = state;
    state = next;
    for (const fn of [...subscribers]) {
      try {
        fn(state, prev);
      } catch (err) {
        console.error('[store] subscriber threw', err);
      }
    }
  }

  return {
    get: () => state,
    set: (patch) => commit({ ...state, ...patch }),
    update: (fn) => commit(fn(state)),
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    watch(select, fn) {
      let last = select(state);
      fn(last, undefined);
      const listener = (s) => {
        const value = select(s);
        if (value === last) return;
        const prev = last;
        last = value;
        fn(value, prev);
      };
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}
