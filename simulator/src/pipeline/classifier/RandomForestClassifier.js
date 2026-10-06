/**
 * Socket for Raghav's random-forest gesture classifier (spec §8.4).
 * NOT IMPLEMENTED in v1: `init()` throws, so if this is configured as the
 * project classifier the registry falls back to the passthrough stand-in and
 * the badge says so.
 *
 * ─── Feature contract ─────────────────────────────────────────────────────
 * Source of truth: origin/ML:ML/train_gesture_classifier.py, function
 * `recording_features(rows, bins=32, source)`. A port must reproduce it
 * exactly, including its edge cases:
 *
 * 1. Input is ONE recording window (one CSV, or one repeated-header section
 *    of a CSV; a new section starts at a row whose first cell is
 *    "gesture_label"). The window must carry exactly one gesture label.
 * 2. Only rows with source_sensor == "accelerometer" or "gyroscope"
 *    (lowercased, trimmed) are used. Accelerometer rows feed accel_x/y/z,
 *    gyroscope rows feed gyro_x/y/z. Both sensors must be present.
 * 3. Event time (ms) = sensor_timestamp_ns / 1e6, or elapsed_ms when the
 *    timestamp cell is empty.
 * 4. start = min event time over BOTH sensors; duration = max − start.
 *    Each sample's time is (t − start) / duration, i.e. normalized to [0, 1]
 *    across the whole window. If duration is 0, every normalized time is 0.
 * 5. Per channel: sort samples by time; if several samples share a time,
 *    replace them with their mean (np.unique + bincount).
 * 6. Per channel: linearly interpolate onto 32 evenly spaced points,
 *    np.linspace(0, 1, 32), with np.interp, which CLAMPS to the first/last
 *    value outside the sampled range (no extrapolation).
 * 7. Feature vector = the six channels concatenated in this order:
 *    accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z → 6 × 32 = 192 float32.
 *    Feature names: accel_x_t00 … accel_x_t31, …, gyro_z_t31.
 * 8. Units are the recorder's: m/s² (accelerometer, gravity included) and
 *    rad/s (gyroscope), Android sensor axes (X toward 3 o'clock, Y toward
 *    12 o'clock, Z out of the screen).
 *
 * Model: scikit-learn RandomForestClassifier, 500 trees,
 * class_weight="balanced_subsample", random_state=42, saved with joblib as
 * { model, feature_names, time_bins: 32, supported_labels } where
 * supported_labels = FLICK_UP, FLICK_DOWN, TWIST_RIGHT, TWIST_LEFT, SHAKE,
 * DOUBLE_TAP. As of 2026-10-05 it is trained on 12 recordings covering 3 of
 * the 6 gestures; predictions for the others are meaningless.
 *
 * ─── Two ways to run it later (not built in v1) ───────────────────────────
 * A. In the browser: export with skl2onnx to ONNX and run with
 *    onnxruntime-web. classify() computes the 192 features in JS and feeds
 *    the session; map the output probabilities back onto GestureIds.
 * B. Next to the browser: a tiny local Python helper loads the .joblib as-is
 *    and answers over HTTP or WebSocket; classify() posts the window.
 * Either way, add a parity test that runs the JS feature function and the
 * Python `recording_features` on the real CSVs in recordings/ and compares
 * all 192 values.
 *
 * Simulated IMU data (spec §12) must never be used to train or evaluate this
 * model: accuracy can only come from the real watch.
 *
 * @typedef {import('../types.js').RawInput} RawInput
 * @typedef {import('../types.js').GestureId} GestureId
 */

export class NotImplementedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class RandomForestClassifier {
  name = 'random forest (ML branch)';

  async init() {
    throw new NotImplementedError(
      'RandomForestClassifier is a stub in v1: the model has not been ported to the browser (see the header for the feature contract)',
    );
  }

  /**
   * @param {RawInput} _raw  must carry `imu`
   * @returns {Promise<{ probabilities: Record<GestureId, number> }>}
   */
  async classify(_raw) {
    throw new NotImplementedError('RandomForestClassifier.classify is not implemented in v1');
  }
}
