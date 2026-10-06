import { isShortcutEvent } from '../core/keyboard.js';

/**
 * WASD and arrow keys → camera orbit axes (spec §6.3), plus C to reset
 * (spec's R now clears the text, see the README decision log).
 * Reports held-key state as axes in -1..1; CameraRig turns that into eased
 * angular velocity. WASD uses physical key positions (`event.code`), so it
 * works on AZERTY and other layouts too.
 *
 *   A / ←  yaw left     D / →  yaw right
 *   W / ↑  pitch up     S / ↓  pitch down
 */
const AXES = {
  KeyA: ['yaw', -1],
  ArrowLeft: ['yaw', -1],
  KeyD: ['yaw', 1],
  ArrowRight: ['yaw', 1],
  KeyW: ['pitch', 1],
  ArrowUp: ['pitch', 1],
  KeyS: ['pitch', -1],
  ArrowDown: ['pitch', -1],
};

export class CameraKeys {
  /**
   * @param {{ onAxes: (yaw: number, pitch: number) => void, onReset: () => void }} handlers
   */
  constructor({ onAxes, onReset }) {
    this.onAxes = onAxes;
    this.onReset = onReset;
    /** @type {Set<string>} */
    this.held = new Set();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.release = this.release.bind(this);
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.release);
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.release);
    this.release();
  }

  /** @param {KeyboardEvent} e */
  onKeyDown(e) {
    if (!isShortcutEvent(e)) return;
    if (e.code === 'KeyC') {
      if (!e.repeat) this.onReset();
      e.preventDefault();
      return;
    }
    if (!(e.code in AXES)) return;
    e.preventDefault();
    if (this.held.has(e.code)) return; // OS auto-repeat
    this.held.add(e.code);
    this.#emit();
  }

  /** @param {KeyboardEvent} e */
  onKeyUp(e) {
    if (this.held.delete(e.code)) this.#emit();
  }

  /** Drops every held key, e.g. when the window loses focus mid-orbit. */
  release() {
    if (this.held.size === 0) return;
    this.held.clear();
    this.#emit();
  }

  #emit() {
    let yaw = 0;
    let pitch = 0;
    for (const code of this.held) {
      const [axis, dir] = AXES[code];
      if (axis === 'yaw') yaw += dir;
      else pitch += dir;
    }
    this.onAxes(Math.sign(yaw), Math.sign(pitch));
  }
}
