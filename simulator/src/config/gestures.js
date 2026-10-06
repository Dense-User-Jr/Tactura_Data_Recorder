/**
 * The six gestures (spec §1.2). IDs and order match the Kotlin enum `Gesture`
 * in wear/src/main/kotlin/com/gesturedatarecorder/recording/RecordingModels.kt,
 * and keys 1–6 follow that order. Which phonemes each gesture carries lives in
 * gesture_bins.json, not here.
 *
 * @typedef {import('../pipeline/types.js').GestureId} GestureId
 * @typedef {Object} GestureDef
 * @property {GestureId} id
 * @property {string} name        display name
 * @property {string} key         the key that fires it
 * @property {string[]} codes     KeyboardEvent.code values (physical keys, so AZERTY etc. work)
 * @property {string} glyph       16×16 stroke-only SVG path data
 */

/** @type {GestureDef[]} */
export const GESTURES = [
  {
    id: 'FLICK_UP',
    name: 'Flick Up',
    key: '1',
    codes: ['Digit1', 'Numpad1'],
    glyph: 'M1.5 11.5H7.5L12.5 4.5M9 4.5H12.5V8',
  },
  {
    id: 'FLICK_DOWN',
    name: 'Flick Down',
    key: '2',
    codes: ['Digit2', 'Numpad2'],
    glyph: 'M1.5 4.5H7.5L12.5 11.5M9 11.5H12.5V8',
  },
  {
    id: 'TWIST_RIGHT',
    name: 'Twist Right',
    key: '3',
    codes: ['Digit3', 'Numpad3'],
    glyph: 'M12.5 8A4.5 4.5 0 1 1 8 3.5H10M8 1.5L10 3.5L8 5.5',
  },
  {
    id: 'TWIST_LEFT',
    name: 'Twist Left',
    key: '4',
    codes: ['Digit4', 'Numpad4'],
    glyph: 'M3.5 8A4.5 4.5 0 1 0 8 3.5H6M8 1.5L6 3.5L8 5.5',
  },
  {
    id: 'SHAKE',
    name: 'Shake',
    key: '5',
    codes: ['Digit5', 'Numpad5'],
    glyph: 'M1.5 8L3.5 5L6 11L8.5 5L11 11L13 5L14.5 8',
  },
  {
    id: 'DOUBLE_TAP',
    name: 'Double Tap',
    key: '6',
    codes: ['Digit6', 'Numpad6'],
    glyph: 'M3 8A2 2 0 1 0 7 8A2 2 0 1 0 3 8M9 8A2 2 0 1 0 13 8A2 2 0 1 0 9 8',
  },
];

/** @type {Record<string, GestureDef>} */
export const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

/** @type {Record<string, GestureDef>} */
export const GESTURE_BY_CODE = Object.fromEntries(GESTURES.flatMap((g) => g.codes.map((code) => [code, g])));

/**
 * Inline SVG markup for a gesture glyph (stroke uses currentColor).
 * @param {GestureDef} gesture
 */
export function glyphSvg(gesture) {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" aria-hidden="true"><path d="${gesture.glyph}"/></svg>`;
}
