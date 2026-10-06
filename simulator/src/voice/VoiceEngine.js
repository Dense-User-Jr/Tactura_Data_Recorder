import { DEFAULT_VOICE, KOKORO } from '../config/voice.js';
import { createSystemSpeaker } from './webSpeech.js';

/**
 * The speaker stage (spec §9). Tiered:
 *
 *   1. Neural (default): Kokoro-82M in a Web Worker. Loads lazily after the
 *      first key press or click; the model downloads once from Hugging Face
 *      and the browser caches it. Generated audio is cached per word in
 *      memory, and plays through Web Audio so the watch screen's ring can
 *      follow the output level.
 *   2. System: the Web Speech API, while the neural voice is loading or if it
 *      failed (offline on first run, blocked CDN, no WebGPU/WASM support).
 *   3. Muted (M).
 *
 * Speaks only on commit, never per gesture. A newer word cuts off an older one.
 *
 * @typedef {'standby'|'loading'|'neural'|'system'|'none'} EngineMode
 * @typedef {Object} VoiceState
 * @property {EngineMode} engine
 * @property {number} progress           0..1 while loading
 * @property {string | null} device      'webgpu' | 'wasm' once neural
 * @property {string | null} dtype
 * @property {string | null} error       why the neural voice is unavailable
 * @property {string} voice              Kokoro voice id
 * @property {boolean} muted
 * @property {string} systemVoice        name of the Web Speech voice in use
 * @typedef {'idle'|'preparing'|'speaking'} Activity
 */

const SPEAK_TIMEOUT_MS = 15000;
const SILENCE = 0.003; // trim leading silence below this amplitude

export class VoiceEngine {
  /**
   * @param {{ voice?: string, muted?: boolean, moduleUrl?: string, onChange?: (state: VoiceState) => void, onNotice?: (message: string, detail: string) => void }} [options]
   */
  constructor({ voice = DEFAULT_VOICE, muted = false, moduleUrl = KOKORO.module, onChange = () => {}, onNotice = () => {} } = {}) {
    this.moduleUrl = moduleUrl;
    this.onChange = onChange;
    this.onNotice = onNotice;
    this.system = createSystemSpeaker();
    /** @type {VoiceState} */
    this.state = {
      engine: 'standby',
      progress: 0,
      device: null,
      dtype: null,
      error: null,
      voice,
      muted,
      systemVoice: this.system.voiceName(),
    };
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {Map<string, AudioBuffer>} */
    this.cache = new Map();
    /** Syntheses in flight, so a prefetch and a commit of the same word share one request. @type {Map<string, Promise<AudioBuffer>>} */
    this.inflight = new Map();
    /** @type {Map<number, { resolve: (v: { samples: Float32Array, rate: number }) => void, reject: (e: Error) => void, timer: number }>} */
    this.pending = new Map();
    this.nextId = 0;
    /** Bumped per speak(); a stale request never plays over a newer word. */
    this.turn = 0;

    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {AnalyserNode | null} */
    this.analyser = null;
    /** @type {AudioBufferSourceNode | null} */
    this.source = null;
    this.samples = new Float32Array(512);
    this.preparing = false;
    this.playing = false;
    this.systemSpeaking = false;
    this.systemToken = 0;
    this.smoothed = 0;
    this.lastLevelAt = 0;
  }

  /** @returns {Activity} */
  get activity() {
    if (this.preparing) return 'preparing';
    if (this.playing || this.systemSpeaking) return 'speaking';
    return 'idle';
  }

  /** Starts loading on the first key press or click (spec §9: lazy, after the first interaction). */
  armOnFirstInteraction() {
    const start = () => {
      window.removeEventListener('keydown', start, true);
      window.removeEventListener('pointerdown', start, true);
      this.#ensureAudio(); // inside a user gesture, so the browser lets audio start
      this.load();
    };
    window.addEventListener('keydown', start, true);
    window.addEventListener('pointerdown', start, true);
  }

  load() {
    if (this.worker || this.state.engine === 'neural') return;
    this.#set({ engine: 'loading', progress: 0, error: null });
    try {
      this.worker = new Worker(new URL('./kokoro.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      this.#fail(err instanceof Error ? err.message : String(err));
      return;
    }
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    this.worker.onerror = (e) => this.#fail(e.message || 'voice worker crashed');
    this.worker.postMessage({ type: 'load', moduleUrl: this.moduleUrl, model: KOKORO.model, voice: this.state.voice });
  }

  /** @param {string} voice Kokoro voice id */
  setVoice(voice) {
    this.#set({ voice });
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    if (muted) this.stop();
    this.#set({ muted });
  }

  stop() {
    this.turn++;
    this.#stopPlayback();
  }

  /**
   * Speak a committed word.
   * @param {string} word
   */
  async speak(word) {
    if (this.state.muted) return;
    const turn = ++this.turn;
    this.#stopPlayback();
    this.#ensureAudio();

    if (this.state.engine !== 'neural') {
      this.#speakSystem(word);
      return;
    }

    let buffer = this.cache.get(`${this.state.voice}|${word}`);
    if (!buffer) {
      this.preparing = true;
      try {
        buffer = await this.#synthesize(word, this.state.voice);
      } catch (err) {
        this.preparing = false;
        if (turn !== this.turn) return;
        this.onNotice(`Neural voice failed on “${word}”, used the system voice`, err instanceof Error ? err.message : String(err));
        this.#speakSystem(word);
        return;
      }
      this.preparing = false;
    }
    if (turn !== this.turn || this.state.muted) return;
    this.#play(buffer);
  }

  /**
   * Synthesize a word in the background so that committing it plays at once.
   * Called for the decoder's current top match while the user is still typing.
   * @param {string} word
   */
  prefetch(word) {
    if (this.state.engine !== 'neural' || this.state.muted) return;
    this.#synthesize(word, this.state.voice).catch(() => {
      // a failed prefetch is harmless; speak() retries and falls back
    });
  }

  /**
   * Output level for the speaking ring, 0..1, smoothed. Neural: measured from
   * the audio. System voice: Web Speech can't be measured, so a gentle
   * synthetic flicker while it speaks.
   */
  level() {
    const now = performance.now();
    const dt = Math.min((now - this.lastLevelAt) / 1000, 0.1);
    this.lastLevelAt = now;
    let target = 0;
    if (this.playing && this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (const s of this.samples) sum += s * s;
      target = Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
    } else if (this.systemSpeaking) {
      target = 0.35 + 0.3 * Math.abs(Math.sin(now / 90)) * Math.abs(Math.sin(now / 37));
    }
    const rate = target > this.smoothed ? 30 : 8; // fast attack, slower release
    this.smoothed += (target - this.smoothed) * (1 - Math.exp(-dt * rate));
    return this.smoothed;
  }

  // ---------- internals ----------

  /** @param {Partial<VoiceState>} patch */
  #set(patch) {
    this.state = { ...this.state, ...patch, systemVoice: this.system.voiceName() };
    this.onChange(this.state);
  }

  /** @param {any} msg */
  #onMessage(msg) {
    if (msg.type === 'progress') {
      if (this.state.engine === 'loading') this.#set({ progress: msg.progress });
    } else if (msg.type === 'ready') {
      this.#set({ engine: 'neural', progress: 1, device: msg.device, dtype: msg.dtype, error: null });
    } else if (msg.type === 'audio') {
      const job = this.pending.get(msg.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(msg.id);
      job.resolve({ samples: msg.samples, rate: msg.rate });
    } else if (msg.type === 'error') {
      if (msg.phase === 'load') {
        this.#fail(msg.message);
        return;
      }
      const job = this.pending.get(msg.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(msg.id);
      job.reject(new Error(msg.message));
    }
  }

  /** @param {string} message */
  #fail(message) {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) job.reject(new Error(message));
    this.pending.clear();
    this.#set({ engine: this.system.available ? 'system' : 'none', error: message, progress: 0 });
    this.onNotice(
      this.system.available ? 'Neural voice unavailable, using the system voice' : 'No voice available',
      message,
    );
  }

  /**
   * Cached audio for a word, synthesizing it (once) if needed.
   * @param {string} word
   * @param {string} voice
   * @returns {Promise<AudioBuffer>}
   */
  #synthesize(word, voice) {
    const key = `${voice}|${word}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    this.#ensureAudio();
    const job = this.#request(`${word}.`, voice)
      .then(({ samples, rate }) => {
        const buffer = this.#toBuffer(samples, rate);
        this.cache.set(key, buffer);
        return buffer;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /**
   * @param {string} text
   * @param {string} voice
   * @returns {Promise<{ samples: Float32Array, rate: number }>}
   */
  #request(text, voice) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('speech synthesis timed out'));
      }, SPEAK_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.worker?.postMessage({ type: 'speak', id, text, voice });
    });
  }

  #ensureAudio() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
  }

  /** @param {Float32Array} samples @param {number} rate */
  #toBuffer(samples, rate) {
    if (!this.ctx) throw new Error('audio unavailable');
    let start = 0;
    while (start < samples.length && Math.abs(samples[start]) < SILENCE) start++;
    start = Math.max(0, start - Math.round(rate * 0.01)); // keep 10 ms before the onset
    const trimmed = samples.subarray(start);
    const buffer = this.ctx.createBuffer(1, Math.max(1, trimmed.length), rate);
    buffer.copyToChannel(trimmed, 0);
    return buffer;
  }

  /** @param {AudioBuffer} buffer */
  #play(buffer) {
    if (!this.ctx || !this.analyser) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        this.playing = false;
      }
    };
    this.source = source;
    this.playing = true;
    source.start();
  }

  /** @param {string} word */
  #speakSystem(word) {
    if (!this.system.available) return;
    const token = ++this.systemToken;
    const done = () => {
      if (token === this.systemToken) this.systemSpeaking = false;
    };
    this.systemSpeaking = true;
    this.system.speak(word, { onEnd: done });
    // some browsers never fire onend when interrupted; don't let the ring hang
    window.setTimeout(done, 4000);
  }

  #stopPlayback() {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source = null;
    }
    this.playing = false;
    if (this.systemSpeaking) this.system.cancel();
    this.systemSpeaking = false;
  }
}
