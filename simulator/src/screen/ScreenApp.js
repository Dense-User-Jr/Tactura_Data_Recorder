/**
 * A watch "app" that draws onto the round 480 × 480 screen (spec §11.2).
 * The real Tactura watch UI will be recreated as another ScreenApp later.
 *
 * The host (WatchScreen) calls `update(dt)` every frame and `render(ctx)`
 * only after the app called `api.invalidate()`, so a still screen costs
 * nothing. `render` gets a context already cleared to black and clipped to
 * the round display.
 *
 * @typedef {Object} ScreenApi
 * @property {import('../core/store.js').Store<any>} store
 * @property {import('../core/eventBus.js').EventBus} bus
 * @property {number} size            480
 * @property {() => void} invalidate   request a redraw
 * @property {() => number} voiceLevel current speech output level 0..1
 * @property {() => 'idle'|'preparing'|'speaking'} voiceActivity  whether the voice is synthesizing or speaking
 * @interface
 */
export class ScreenApp {
  /** Shown in the HUD as `APP: …`. */
  name = 'APP';

  /** @param {ScreenApi} _api */
  mount(_api) {}

  /** The display just turned on (boot). */
  wake() {}

  /** @param {number} _dt seconds */
  update(_dt) {}

  /** @param {CanvasRenderingContext2D} _ctx */
  render(_ctx) {}

  unmount() {}
}
