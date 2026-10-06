import { h } from '../dom.js';

/**
 * Case finish selector in the viewport corner. Moves into the settings panel
 * in Phase 5.
 */
export class FinishPicker {
  /**
   * @param {{ finishes: Record<string, { label: string }>, onPick: (id: string) => void }} options
   */
  constructor({ finishes, onPick }) {
    /** @type {Map<string, HTMLButtonElement>} */
    this.buttons = new Map();
    for (const [id, { label }] of Object.entries(finishes)) {
      const button = /** @type {HTMLButtonElement} */ (
        h('button', { class: 'chip chamfer label', type: 'button', 'aria-pressed': 'false', onClick: () => onPick(id) }, label)
      );
      this.buttons.set(id, button);
    }
    this.el = h(
      'div',
      { class: 'finish-picker', role: 'group', 'aria-label': 'Case finish' },
      h('span', { class: 'label dim' }, 'FINISH'),
      [...this.buttons.values()],
    );
  }

  /** @param {string} id */
  set(id) {
    for (const [key, button] of this.buttons) button.setAttribute('aria-pressed', String(key === id));
  }
}
