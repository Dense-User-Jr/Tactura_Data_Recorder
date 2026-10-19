import { GESTURES } from '../../config/gestures.js';

/**
 * v1 classifier stand-in (spec §8.2). Keyboard and tile input already says
 * which gesture was meant, so this returns that label one-hot with
 * confidence 1.0. It does not look at sensor data and must never be read as
 * a measure of real recognition accuracy (spec §2 non-goals).
 *
 * Unlabeled input (a future phone IMU stream) needs a real classifier; this
 * throws on it rather than guessing.
 *
 * @typedef {import('../types.js').RawInput} RawInput
 * @typedef {import('../types.js').GestureId} GestureId
 */
export class PassthroughClassifier {
  name = 'passthrough (labels from the keyboard)';

  /**
   * @param {RawInput} raw
   * @returns {Promise<{ probabilities: Record<GestureId, number> }>}
   */
  async classify(raw) {
    if (!raw.label) {
      throw new Error('the passthrough classifier needs a labeled input; unlabeled IMU needs a real classifier');
    }
    const probabilities = /** @type {Record<GestureId, number>} */ (
      Object.fromEntries(GESTURES.map((g) => [g.id, g.id === raw.label ? 1 : 0]))
    );
    return { probabilities };
  }
}
