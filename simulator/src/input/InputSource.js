/**
 * Where gestures come from (spec §8.2, Input stage).
 *
 * v1 ships `KeyboardInput` (keys 1–6 plus gesture tile clicks). Future
 * sources plug in behind this same shape (spec §15):
 *   - phone IMU streamed over Wi-Fi (emits RawInput with `imu`, no `label`)
 *   - CSV replay of real recordings (with or without `label`)
 *   - webcam
 *
 * A source calls `emit(raw)` once per gesture (or per IMU window, once a
 * segmenter exists). It never classifies; that is the pipeline's job.
 *
 * @typedef {import('../pipeline/types.js').RawInput} RawInput
 * @interface
 */
export class InputSource {
  /** Short id shown in the top bar, e.g. `keyboard`. */
  id = 'abstract';

  /** @param {(raw: RawInput) => void} _emit */
  start(_emit) {
    throw new Error(`${this.constructor.name}.start() not implemented`);
  }

  stop() {}
}
