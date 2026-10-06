import { describe, expect, it } from 'vitest';
import { clipLength, poseAt } from '../src/scene/GestureAnimator.js';

const DEG = 180 / Math.PI;

/**
 * Samples one pose channel every millisecond across a clip.
 * @param {string} id
 * @param {'roll'|'tip'|'hand'|'dip'} channel
 */
function sample(id, channel) {
  const values = [];
  for (let t = 0; t <= clipLength(id); t++) values.push(poseAt(/** @type {any} */ (id), t)[channel]);
  return values;
}

/** Angular velocity in rad/s from 1 ms samples (radians). */
const velocity = (values) => values.slice(1).map((v, i) => (v - values[i]) * 1000);

describe('twists (spec §1.4, §10.5)', () => {
  it('Twist Right rolls +70° about X (positive gyro_x), Twist Left −70°', () => {
    expect(Math.max(...sample('TWIST_RIGHT', 'roll')) * DEG).toBeCloseTo(70, 0);
    expect(Math.min(...sample('TWIST_LEFT', 'roll')) * DEG).toBeCloseTo(-70, 0);
  });

  it('main stroke peaks in the recorded 8–13 rad/s range', () => {
    const peak = Math.max(...velocity(sample('TWIST_RIGHT', 'roll')));
    expect(peak).toBeGreaterThan(8);
    expect(peak).toBeLessThan(13);
  });

  it('return stroke is 60–75% of the main stroke, as in the recordings', () => {
    const v = velocity(sample('TWIST_RIGHT', 'roll'));
    const main = Math.max(...v);
    const back = -Math.min(...v);
    expect(back / main).toBeGreaterThan(0.6);
    expect(back / main).toBeLessThan(0.75);
  });

  it('returns past neutral with a slight overshoot', () => {
    const overshoot = -Math.min(...sample('TWIST_RIGHT', 'roll')) * DEG;
    expect(overshoot).toBeGreaterThan(1);
    expect(overshoot).toBeLessThan(8);
  });
});

describe('flicks', () => {
  it('Flick Up pitches the hand 40° up (toward the back of the hand) and the forearm only 8°', () => {
    expect(Math.min(...sample('FLICK_UP', 'hand')) * DEG).toBeCloseTo(-40, 0);
    expect(Math.min(...sample('FLICK_UP', 'tip')) * DEG).toBeCloseTo(-8, 0);
  });

  it('Flick Down mirrors it', () => {
    expect(Math.max(...sample('FLICK_DOWN', 'hand')) * DEG).toBeCloseTo(40, 0);
    expect(Math.max(...sample('FLICK_DOWN', 'tip')) * DEG).toBeCloseTo(8, 0);
  });
});

describe('shake and double tap', () => {
  it('Shake is a ±12° roll that swings both ways', () => {
    const roll = sample('SHAKE', 'roll').map((r) => r * DEG);
    expect(Math.max(...roll)).toBeCloseTo(12, 0);
    expect(Math.min(...roll)).toBeLessThan(-9);
  });

  it('Double Tap makes two 1.5 mm dips along −Z', () => {
    const dip = sample('DOUBLE_TAP', 'dip');
    expect(Math.min(...dip)).toBeCloseTo(-1.5, 2);
    let dips = 0;
    for (let i = 1; i < dip.length; i++) if (dip[i - 1] > -0.75 && dip[i] <= -0.75) dips++;
    expect(dips).toBe(2);
  });
});

describe('every clip', () => {
  it.each(['FLICK_UP', 'FLICK_DOWN', 'TWIST_RIGHT', 'TWIST_LEFT', 'SHAKE', 'DOUBLE_TAP'])(
    '%s starts and ends at rest',
    (id) => {
      const start = poseAt(/** @type {any} */ (id), 0);
      const end = poseAt(/** @type {any} */ (id), clipLength(id) - 1);
      for (const channel of /** @type {const} */ (['roll', 'tip', 'hand'])) {
        expect(Math.abs(start[channel]) * DEG).toBeLessThan(0.5);
        expect(Math.abs(end[channel]) * DEG).toBeLessThan(0.5);
      }
      expect(Math.abs(end.dip)).toBeLessThan(0.05);
    },
  );
});
