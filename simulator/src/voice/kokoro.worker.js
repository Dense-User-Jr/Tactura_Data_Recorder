/**
 * Kokoro neural TTS, off the main thread (spec §9.1) so the 3D scene never
 * stutters while a word is synthesized.
 *
 * Messages in:
 *   { type: 'load', moduleUrl, model, voice }
 *   { type: 'speak', id, text, voice }
 * Messages out:
 *   { type: 'progress', progress }                    0..1 while downloading
 *   { type: 'ready', device, dtype }
 *   { type: 'audio', id, samples, rate }              Float32Array (transferred), Hz
 *   { type: 'error', phase: 'load' | 'speak', id?, message }
 *
 * Device: WebGPU with fp32 when an adapter is available, otherwise WASM with
 * q8 (spec §9.1). If WebGPU fails to start, it retries once on WASM.
 */
import { createProgressTracker } from './progress.js';

/** @type {any} */
let tts = null;
/** Synthesis runs one request at a time. */
let queue = Promise.resolve();

/** @param {any} message @param {Transferable[]} [transfer] */
const post = (message, transfer = []) => self.postMessage(message, transfer);

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') load(data);
  else if (data.type === 'speak') queue = queue.then(() => speak(data));
};

/** @param {{ moduleUrl: string, model: string, voice: string }} options */
async function load({ moduleUrl, model, voice }) {
  try {
    const { KokoroTTS } = await import(/* @vite-ignore */ moduleUrl);

    const adapter = 'gpu' in navigator ? await /** @type {any} */ (navigator).gpu.requestAdapter().catch(() => null) : null;
    const attempts = adapter
      ? [{ device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }];

    let lastError = null;
    for (const options of attempts) {
      const tracker = createProgressTracker();
      let lastPost = 0;
      try {
        tts = await KokoroTTS.from_pretrained(model, {
          ...options,
          progress_callback: (/** @type {any} */ event) => {
            const progress = tracker.update(event);
            const now = performance.now();
            if (now - lastPost > 120) {
              lastPost = now;
              post({ type: 'progress', progress });
            }
          },
        });
        // warm up: compiles kernels and fetches the voice, so the first real word is quick
        await tts.generate('Ready.', { voice });
        post({ type: 'ready', ...options });
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  } catch (err) {
    post({ type: 'error', phase: 'load', message: describe(err) });
  }
}

/** @param {{ id: number, text: string, voice: string }} request */
async function speak({ id, text, voice }) {
  try {
    if (!tts) throw new Error('voice model not loaded');
    const audio = await tts.generate(text, { voice });
    const samples = /** @type {Float32Array} */ (audio.audio);
    post({ type: 'audio', id, samples, rate: audio.sampling_rate }, [samples.buffer]);
  } catch (err) {
    post({ type: 'error', phase: 'speak', id, message: describe(err) });
  }
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
