/**
 * Shared pipeline data types (spec §8.1). JSDoc only; nothing runs here.
 *
 * Flow: InputSource → RawInput → [segmenter] → classifier → GestureEvent
 *       → bin mapper → BinToken → decoder → DecodeResult → speaker
 */

/** @typedef {'FLICK_UP'|'FLICK_DOWN'|'TWIST_RIGHT'|'TWIST_LEFT'|'SHAKE'|'DOUBLE_TAP'} GestureId */

/**
 * Raw input from any source. v1 keyboard sends `label`.
 * Future sources (phone, replay) send `imu` instead and rely on the classifier.
 * @typedef {Object} RawInput
 * @property {'keyboard'|'mouse'|'phone'|'replay'|'webcam'} source
 * @property {number} t                      performance.now() in ms
 * @property {GestureId} [label]             known label (keyboard, mouse, replay with labels)
 * @property {ImuWindow} [imu]               sensor window (future)
 */

/**
 * Mirrors the recorder CSV so recordings and sim data share one shape.
 * @typedef {Object} ImuWindow
 * @property {Array<{tNs:number, sensor:'accelerometer'|'gyroscope', x:number, y:number, z:number}>} samples
 * @property {number} durationMs
 */

/**
 * @typedef {Object} GestureEvent
 * @property {string} id
 * @property {GestureId} gesture             argmax
 * @property {Record<GestureId, number>} probabilities
 * @property {number} confidence
 * @property {RawInput['source']} source
 * @property {number} t
 */

/** @typedef {{ gesture: GestureId, bin: string, phonemes: string[] }} BinToken */

/** @typedef {{ word: string, phonemes: string[], zipf: number }} Candidate */

/**
 * @typedef {Object} DecodeResult
 * @property {Candidate[]} exact            words whose full gesture sequence equals the buffer, ranked
 * @property {number} prefixCount           how many words start with this buffer
 * @property {Candidate[]} prefixPreview    top few prefix matches, ranked
 */

/**
 * @typedef {Object} StageStatus
 * @property {'project'|'stand-in'|'error'} mode
 * @property {string} name
 * @property {string} [reason]
 */

export {};
