import { isShortcutEvent } from '../core/keyboard.js';

/**
 * Word-composition keys (spec §6.3):
 *
 *   Space              commit the buffer as a word
 *   Backspace          remove the last gesture; on an empty buffer, the last word
 *   Tab / Shift+Tab    cycle candidates, only when several words match
 *                      (otherwise Tab keeps moving keyboard focus as usual)
 *   Esc                clear the buffer
 *
 * Space is swallowed on both keydown and keyup so it never also "clicks" a
 * focused button such as a gesture tile.
 */
export class ComposeKeys {
  /** @param {import('../pipeline/Composer.js').Composer} composer */
  constructor(composer) {
    this.composer = composer;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** @param {KeyboardEvent} e */
  onKeyDown(e) {
    if (!isShortcutEvent(e)) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) this.composer.commit();
        break;
      case 'Backspace':
        e.preventDefault();
        this.composer.backspace(); // holding it keeps deleting, like a text field
        break;
      case 'Tab':
        if (!this.composer.canCycle) return;
        e.preventDefault();
        this.composer.cycle(e.shiftKey ? -1 : 1);
        break;
      case 'Escape':
        this.composer.clear();
        break;
      default:
    }
  }

  /** @param {KeyboardEvent} e */
  onKeyUp(e) {
    if (e.code === 'Space' && isShortcutEvent(e)) e.preventDefault();
  }
}
