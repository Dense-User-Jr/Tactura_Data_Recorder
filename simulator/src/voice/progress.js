/**
 * Turns transformers.js per-file progress callbacks into one overall
 * fraction for the `VOICE: LOADING 42%` badge.
 *
 * Callbacks look like { status: 'initiate'|'download'|'progress'|'done'|'ready', file, loaded, total }.
 * Overall = bytes loaded / bytes known across every file seen so far. Small
 * files (config, tokenizer) finish first, so the number can step back a little
 * when the big model file starts; it never reports 100% before everything is done.
 */
export function createProgressTracker() {
  /** @type {Map<string, { loaded: number, total: number }>} */
  const files = new Map();

  return {
    /**
     * @param {{ status?: string, file?: string, loaded?: number, total?: number }} event
     * @returns {number} overall progress, 0..1
     */
    update(event) {
      const file = event.file ?? '';
      if (event.status === 'progress' && event.total) {
        files.set(file, { loaded: event.loaded ?? 0, total: event.total });
      } else if (event.status === 'done' && files.has(file)) {
        const f = /** @type {{ loaded: number, total: number }} */ (files.get(file));
        f.loaded = f.total;
      }
      return this.value;
    },
    get value() {
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      return total > 0 ? Math.min(loaded / total, 0.99) : 0;
    },
  };
}
