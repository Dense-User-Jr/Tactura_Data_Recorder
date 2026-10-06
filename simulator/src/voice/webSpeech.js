import { SYSTEM_VOICE } from '../config/voice.js';

/**
 * System voice fallback (spec §9.2): the browser's Web Speech API, used when
 * the neural voice fails or is still loading.
 */

const PREMIUM = /natural|neural|premium|enhanced|siri|google/i;

/**
 * English voices, best first: names containing Natural, Neural, Premium,
 * Enhanced, Siri or Google; then any en-US; then any other English.
 * Within a tier en-US comes first, otherwise the browser's order is kept.
 * @template {{ name: string, lang: string }} V
 * @param {readonly V[]} voices
 * @returns {V[]}
 */
export function rankSystemVoices(voices) {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const isUS = (/** @type {V} */ v) => /^en[-_]us$/i.test(v.lang);
  const tier = (/** @type {V} */ v) => (PREMIUM.test(v.name) ? 0 : isUS(v) ? 1 : 2);
  return english
    .map((v, i) => ({ v, i }))
    .sort((a, b) => tier(a.v) - tier(b.v) || Number(isUS(b.v)) - Number(isUS(a.v)) || a.i - b.i)
    .map(({ v }) => v);
}

/**
 * @typedef {Object} SystemSpeaker
 * @property {boolean} available
 * @property {() => string} voiceName
 * @property {(text: string, hooks?: { onStart?: () => void, onEnd?: () => void, volume?: number }) => void} speak
 * @property {() => void} cancel
 */

/** @returns {SystemSpeaker} */
export function createSystemSpeaker() {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const available = Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined';
  /** @type {SpeechSynthesisVoice | null} */
  let voice = null;
  const refresh = () => {
    voice = synth ? (rankSystemVoices(synth.getVoices())[0] ?? null) : null;
  };
  if (available) {
    refresh();
    synth?.addEventListener?.('voiceschanged', refresh);
  }

  return {
    available,
    voiceName: () => voice?.name ?? 'browser default',
    speak(text, { onStart, onEnd, volume = 1 } = {}) {
      if (!available || !synth) {
        onEnd?.();
        return;
      }
      if (!voice) refresh();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'en-US';
      utterance.rate = SYSTEM_VOICE.rate;
      utterance.pitch = SYSTEM_VOICE.pitch;
      utterance.volume = Math.min(1, Math.max(0, volume));
      utterance.onstart = () => onStart?.();
      utterance.onend = () => onEnd?.();
      utterance.onerror = () => onEnd?.();
      synth.cancel();
      synth.speak(utterance);
    },
    cancel() {
      synth?.cancel();
    },
  };
}
