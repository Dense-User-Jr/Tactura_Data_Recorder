import { InputSource } from './InputSource.js';
import { GESTURE_BY_CODE } from '../config/gestures.js';
import { isShortcutEvent } from '../core/keyboard.js';

/**
 * v1 input (spec §6.3): keys 1–6 fire the six gestures, and gesture tiles
 * call `press()` so the sim also works mouse-only. Keyboard RawInputs carry
 * `source: 'keyboard'`, tile clicks `source: 'mouse'`; both carry the known
 * `label`, since there is no sensor data to classify.
 *
 * OS key auto-repeat is ignored: holding a key fires once.
 *
 * @typedef {import('../pipeline/types.js').RawInput} RawInput
 * @typedef {import('../pipeline/types.js').GestureId} GestureId
 */
export class KeyboardInput extends InputSource {
  id = 'keyboard';
  /** @type {((raw: RawInput) => void) | null} */
  #emit = null;

  /** @param {(raw: RawInput) => void} emit */
  start(emit) {
    this.#emit = emit;
    window.addEventListener('keydown', this.#onKeyDown);
  }

  stop() {
    window.removeEventListener('keydown', this.#onKeyDown);
    this.#emit = null;
  }

  /**
   * Fire a gesture from a pointer (gesture tile click).
   * @param {GestureId} label
   */
  press(label) {
    this.#emit?.({ source: 'mouse', t: performance.now(), label });
  }

  /** @param {KeyboardEvent} e */
  #onKeyDown = (e) => {
    const gesture = GESTURE_BY_CODE[e.code];
    if (!gesture || !isShortcutEvent(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.#emit?.({ source: 'keyboard', t: performance.now(), label: gesture.id });
  };
}
