import { h } from '../dom.js';
import { GESTURES } from '../../config/gestures.js';

/**
 * Help overlay (spec §7.3): a full-screen dark scrim with every control laid
 * out on a keyboard diagram drawn in hairlines. Keys the sim uses are lit and
 * labeled with their action; the legend below groups them.
 * Opens with ? or H; closes with Esc, ? / H again, or a click on the scrim.
 */

/** key id → action shown on the keycap */
const ACTIONS = {
  Escape: 'CLEAR',
  Backspace: 'UNDO',
  Tab: 'CYCLE',
  Space: 'COMMIT',
  KeyW: 'ORBIT',
  KeyA: 'ORBIT',
  KeyS: 'ORBIT',
  KeyD: 'ORBIT',
  KeyR: 'RESET',
  KeyM: 'MUTE',
  KeyH: 'HELP',
  Slash: 'HELP',
  BracketLeft: 'RAIL',
  BracketRight: 'RAIL',
  ArrowUp: 'ORBIT',
  ArrowDown: 'ORBIT',
  ArrowLeft: 'ORBIT',
  ArrowRight: 'ORBIT',
  ...Object.fromEntries(GESTURES.map((g) => [`Digit${g.key}`, g.name.toUpperCase()])), // wraps onto two lines
};
const GESTURE_KEYS = new Set(GESTURES.map((g) => `Digit${g.key}`));

/** [id, cap, width in key units] */
const ROWS = [
  [['Escape', 'ESC', 1.25], ...'1234567890'.split('').map((d) => [`Digit${d}`, d, 1]), ['Minus', '-', 1], ['Equal', '=', 1], ['Backspace', '⌫', 1.75]],
  [['Tab', 'TAB', 1.5], ...'QWERTYUIOP'.split('').map((c) => [`Key${c}`, c, 1]), ['BracketLeft', '[', 1], ['BracketRight', ']', 1], ['Backslash', '\\', 1.5]],
  [['CapsLock', 'CAPS', 1.75], ...'ASDFGHJKL'.split('').map((c) => [`Key${c}`, c, 1]), ['Semicolon', ';', 1], ['Quote', "'", 1], ['Enter', 'ENTER', 2.25]],
  [['ShiftLeft', 'SHIFT', 2.25], ...'ZXCVBNM'.split('').map((c) => [`Key${c}`, c, 1]), ['Comma', ',', 1], ['Period', '.', 1], ['Slash', '? /', 1], ['ShiftRight', 'SHIFT', 2.75]],
  [['Spacer', '', 3.75], ['Space', 'SPACE', 6.25], ['Spacer', '', 5]],
];

const LEGEND = [
  ['GESTURES', GESTURES.map((g) => [g.key, g.name])],
  [
    'COMPOSE',
    [
      ['SPACE', 'Commit the word'],
      ['⌫', 'Undo a gesture, then a word'],
      ['TAB', 'Next match (⇧ previous)'],
      ['ESC', 'Clear the buffer'],
    ],
  ],
  [
    'CAMERA',
    [
      ['W A S D', 'Orbit (or arrows)'],
      ['DRAG', 'Orbit'],
      ['SCROLL', 'Zoom'],
      ['R', 'Reset to the hero view'],
    ],
  ],
  [
    'VIEW',
    [
      ['[ ]', 'Collapse left / right rail'],
      ['M', 'Mute the voice'],
      ['? H', 'This help'],
      ['⚙', 'Settings'],
    ],
  ],
];

export class HelpOverlay {
  /** @param {{ onClose?: () => void }} [options] */
  constructor({ onClose = () => {} } = {}) {
    this.onClose = onClose;
    const key = ([id, cap, width]) => {
      if (id === 'Spacer') return h('span', { class: 'kb__spacer', style: { '--w': String(width) } });
      const action = /** @type {Record<string, string>} */ (ACTIONS)[id];
      return h(
        'span',
        {
          class: `kb__key${action ? ' is-live' : ''}${GESTURE_KEYS.has(id) ? ' is-gesture' : ''}`,
          style: { '--w': String(width) },
        },
        h('span', { class: 'kb__cap' }, cap),
        action && h('span', { class: 'kb__act' }, action),
      );
    };
    const arrows = h(
      'div',
      { class: 'kb__arrows' },
      h('div', { class: 'kb__row' }, key(['Spacer', '', 1]), key(['ArrowUp', '↑', 1]), key(['Spacer', '', 1])),
      h('div', { class: 'kb__row' }, key(['ArrowLeft', '←', 1]), key(['ArrowDown', '↓', 1]), key(['ArrowRight', '→', 1])),
    );

    this.panel = h(
      'div',
      { class: 'help__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Controls' },
      h(
        'header',
        { class: 'help__head label' },
        h('span', { class: 'panel__num' }, 'H'),
        h('span', { class: 'panel__sep' }, '/'),
        h('span', {}, 'CONTROLS'),
        h('span', { class: 'help__try dim' }, 'TRY  6 3 5  SPACE  →  CHEESE'),
        h('button', { class: 'icon-btn chamfer', type: 'button', 'aria-label': 'Close help', onClick: () => this.close() }, '✕'),
      ),
      h('div', { class: 'kb' }, h('div', { class: 'kb__main' }, ROWS.map((row) => h('div', { class: 'kb__row' }, row.map(key)))), arrows),
      h(
        'div',
        { class: 'help__legend' },
        LEGEND.map(([title, items]) =>
          h(
            'section',
            { class: 'help__group' },
            h('h3', { class: 'label' }, title),
            h(
              'dl',
              {},
              items.map(([k, what]) => [h('dt', { class: 'label' }, k), h('dd', {}, what)]),
            ),
          ),
        ),
      ),
      h(
        'footer',
        { class: 'help__foot label dim' },
        'CLICK A GESTURE TILE TO FIRE IT  ·  HOVER A TOP-BAR BADGE TO SEE WHAT IS REAL AND WHAT IS A STAND-IN  ·  ESC TO CLOSE',
      ),
    );
    this.el = h('div', { class: 'help', hidden: true }, this.panel);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open() {
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('is-open'));
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-open');
    this.el.hidden = true;
    this.onClose();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}
