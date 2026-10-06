/**
 * Voice settings (spec §9). The settings panel (Phase 5) exposes the voice
 * picker; until then a chip in the viewport cycles through these.
 */

/** Kokoro voices offered in the sim. Grades are Kokoro's own quality ratings. */
export const VOICES = [
  { id: 'af_heart', label: 'Heart', note: 'US English, female (Kokoro grade A, default)' },
  { id: 'af_bella', label: 'Bella', note: 'US English, female (grade A−)' },
  { id: 'bf_emma', label: 'Emma', note: 'UK English, female (grade B−)' },
  { id: 'am_michael', label: 'Michael', note: 'US English, male (grade C+)' },
];

export const DEFAULT_VOICE = 'af_heart';

export const KOKORO = {
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  /**
   * kokoro-js's self-contained browser bundle (transformers.js and the
   * phonemizer inside), loaded at runtime and cached by the browser. The npm
   * package would add ~425 MB of onnxruntime packages the browser never uses.
   */
  module: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js',
  /** First-use downloads, for honest badge text. */
  downloadMb: { webgpu: 311, wasm: 88 },
};

/** Web Speech fallback (spec §9.2). */
export const SYSTEM_VOICE = { rate: 0.95, pitch: 1.0 };
