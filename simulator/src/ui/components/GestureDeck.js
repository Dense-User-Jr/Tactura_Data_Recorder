import { h } from '../dom.js';
import { glyphSvg } from '../../config/gestures.js';

const FIRE_MS = 300; // red + scan sweep (spec §7.3)
const DECAY_MS = 300; // then back to rest (spec §7.4)

/**
 * The six gesture tiles in the left rail (spec §7.3). Chamfered; big Doto
 * key number, gesture name, the bin's phonemes. Clicking a tile fires the
 * gesture, so the sim works mouse-only.
 *
 * On fire the border and number turn signal red while a red scan sweeps
 * across, then everything decays back.
 *
 * @typedef {import('../../config/gestures.js').GestureDef} GestureDef
 * @typedef {import('../../pipeline/types.js').GestureId} GestureId
 */
export class GestureDeck {
  /**
   * @param {{ gestures: GestureDef[], phonemes: Record<string, string[]>, onPress: (id: GestureId) => void }} options
   */
  constructor({ gestures, phonemes, onPress }) {
    /** @type {Map<GestureId, { el: HTMLElement, timers: number[] }>} */
    this.tiles = new Map();
    for (const g of gestures) {
      const el = h(
        'button',
        {
          class: 'tile chamfer',
          type: 'button',
          dataset: { gesture: g.id },
          title: `${g.name} (key ${g.key})`,
          'aria-keyshortcuts': g.key,
          onClick: () => onPress(g.id),
        },
        h('span', { class: 'tile__scan', 'aria-hidden': 'true' }),
        h('span', { class: 'tile__key' }, g.key),
        h(
          'span',
          { class: 'tile__text' },
          h('span', { class: 'tile__name label' }, g.name),
          h('span', { class: 'tile__ph label' }, (phonemes[g.id] ?? []).join(' · ')),
        ),
        h('span', { class: 'tile__glyph', html: glyphSvg(g) }),
      );
      this.tiles.set(g.id, { el, timers: [] });
    }
    this.el = h('div', { class: 'deck' }, [...this.tiles.values()].map((t) => t.el));
  }

  /** @param {GestureId} id */
  flash(id) {
    const tile = this.tiles.get(id);
    if (!tile) return;
    const { el } = tile;
    tile.timers.forEach(clearTimeout);
    el.classList.remove('is-firing', 'is-decaying');
    void el.offsetWidth; // restart the sweep if it was already running
    el.classList.add('is-firing');
    tile.timers = [
      window.setTimeout(() => el.classList.replace('is-firing', 'is-decaying'), FIRE_MS),
      window.setTimeout(() => el.classList.remove('is-decaying'), FIRE_MS + DECAY_MS),
    ];
  }
}
