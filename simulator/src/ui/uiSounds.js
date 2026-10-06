/**
 * Tiny synthesized UI ticks (spec §7.5): Web Audio only, no audio files.
 * Separate from the voice. Default on and quiet; one master volume (the
 * settings panel exposes it in Phase 5).
 *
 *   tick()    short high tick on gesture fire
 *   commit()  lower double tick on word commit (Phase 3)
 *   buzz()    soft buzz on NO WORD (Phase 3)
 *
 * The AudioContext is created on first use, which is always inside a key or
 * click handler, so browser autoplay rules are satisfied. Any audio failure
 * is swallowed: sound is never allowed to break the sim.
 */
export class UiSounds {
  /** @param {{ volume?: number }} [options] 0..1 */
  constructor({ volume = 0.35 } = {}) {
    this.volume = volume;
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
  }

  /** @param {number} volume 0..1 */
  setVolume(volume) {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  tick() {
    this.#play((ctx, out, t) => blip(ctx, out, t, { from: 2600, to: 1700, ms: 28, gain: 0.5, type: 'sine' }));
  }

  commit() {
    this.#play((ctx, out, t) => {
      blip(ctx, out, t, { from: 1150, to: 1000, ms: 40, gain: 0.45, type: 'triangle' });
      blip(ctx, out, t + 0.07, { from: 900, to: 780, ms: 50, gain: 0.45, type: 'triangle' });
    });
  }

  buzz() {
    this.#play((ctx, out, t) => {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, t);
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  /** @param {(ctx: AudioContext, out: AudioNode, t: number) => void} build */
  #play(build) {
    if (this.volume <= 0) return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      build(this.ctx, /** @type {GainNode} */ (this.master), this.ctx.currentTime + 0.005);
    } catch (err) {
      console.warn('[uiSounds] audio unavailable', err);
    }
  }
}

/**
 * One short pitched blip with a fast exponential decay.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {number} t start time
 * @param {{ from: number, to: number, ms: number, gain: number, type: OscillatorType }} p
 */
function blip(ctx, out, t, { from, to, ms, gain, type }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + ms / 1000);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.01);
}
