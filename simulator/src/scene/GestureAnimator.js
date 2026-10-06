import * as THREE from 'three';
import { FOREARM_AXIS_Z } from './WristMannequin.js';

/**
 * Gesture animations (spec §10.5), driven on the WristMannequin rig.
 *
 * Directions follow the real recordings (spec §1.4, Android sensor axes:
 * X toward 3 o'clock / along the forearm, Y toward 12 o'clock, Z out of the
 * screen). Positive roll is positive gyro_x.
 *
 * Timing is physical: every stroke starts and ends at rest, the out-stroke is
 * fast and the return is a softer underdamped spring with a slight overshoot.
 * Twist constants are tuned to the recordings: the out-stroke peaks near
 * 10.6 rad/s (data: 8–17) and the return stroke at ~71% of that (data: 60–75%).
 *
 * If a gesture fires mid-animation, the current pose becomes a residual that
 * eases out while the new clip starts, so nothing snaps.
 *
 * @typedef {import('../pipeline/types.js').GestureId} GestureId
 * @typedef {Object} Pose
 * @property {number} roll   forearm roll about X (rad); twists and shake
 * @property {number} tip    forearm tip about Y (rad); the small part of a flick
 * @property {number} hand   hand pitch at the wrist about Y (rad); negative = up, toward the back of the hand
 * @property {number} dip    forearm offset along watch Z (mm); double tap
 */

const deg = THREE.MathUtils.degToRad;

/** @returns {Pose} */
const rest = () => ({ roll: 0, tip: 0, hand: 0, dip: 0 });

const easeInOutSine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;

/**
 * Underdamped spring released at rest from 1, toward 0. Closed form.
 * @param {number} t seconds since release
 * @param {number} omega natural frequency (rad/s)
 * @param {number} zeta damping ratio (< 1)
 */
function springFromOne(t, omega, zeta) {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

/**
 * 0 → 1 (eased out-stroke), hold, then spring back to 0.
 * @param {number} t ms
 * @param {{ out: number, hold: number, omega: number, zeta: number }} s
 */
function stroke(t, s) {
  if (t < s.out) return easeInOutSine(t / s.out);
  if (t < s.out + s.hold) return 1;
  return springFromOne((t - s.out - s.hold) / 1000, s.omega, s.zeta);
}

/** 180 ms out, 60 ms hold, return crosses neutral at ~230 ms then overshoots ~5%. */
const TWIST = { out: 180, hold: 60, omega: 13, zeta: 0.65 };
/** 120 ms out, back in ~200 ms with barely any overshoot. */
const FLICK = { out: 120, hold: 0, omega: 20.8, zeta: 0.8 };

const TWIST_ANGLE = deg(70);
const FLICK_HAND = deg(40);
const FLICK_FOREARM = deg(8);
const SHAKE = { amplitude: deg(12), cycles: 3.5, ms: 450 };
/** Peak of the shake envelope sin(πp)·(1 − p/2), so the strongest swing reaches the full ±12°. */
const SHAKE_ENVELOPE_PEAK = 0.766;
const TAP = { depth: 1.5, ms: 90, gap: 110 };

/**
 * @typedef {Object} Clip
 * @property {number} ms                     after this the clip's pose is exactly rest
 * @property {(t: number) => Partial<Pose>} pose
 * @property {number[]} [taps]               ms offsets that trigger the glass ripple
 */

/** @type {Record<GestureId, Clip>} */
const CLIPS = {
  TWIST_RIGHT: { ms: 900, pose: (t) => ({ roll: TWIST_ANGLE * stroke(t, TWIST) }) },
  TWIST_LEFT: { ms: 900, pose: (t) => ({ roll: -TWIST_ANGLE * stroke(t, TWIST) }) },
  FLICK_UP: {
    ms: 460,
    pose: (t) => {
      const k = stroke(t, FLICK);
      return { hand: -FLICK_HAND * k, tip: -FLICK_FOREARM * k };
    },
  },
  FLICK_DOWN: {
    ms: 460,
    pose: (t) => {
      const k = stroke(t, FLICK);
      return { hand: FLICK_HAND * k, tip: FLICK_FOREARM * k };
    },
  },
  // Rapid left-right roll about the forearm axis (Russell, 2026-10-05), decaying.
  SHAKE: {
    ms: SHAKE.ms,
    pose: (t) => {
      const p = t / SHAKE.ms;
      const envelope = (Math.sin(Math.PI * p) * (1 - 0.5 * p)) / SHAKE_ENVELOPE_PEAK;
      return { roll: SHAKE.amplitude * envelope * Math.sin(2 * Math.PI * SHAKE.cycles * p) };
    },
  },
  DOUBLE_TAP: {
    ms: 2 * TAP.ms + TAP.gap,
    taps: [0, TAP.ms + TAP.gap],
    pose: (t) => {
      const local = t < TAP.ms ? t : t - TAP.ms - TAP.gap;
      if (local < 0 || local > TAP.ms) return {};
      return { dip: -TAP.depth * Math.sin((Math.PI * local) / TAP.ms) ** 2 };
    },
  },
};

/**
 * The pose a gesture clip prescribes at `t` ms after it fires (rest outside
 * the clip). Pure; used by the animator, the tests, and later the synthetic IMU.
 * @param {GestureId} id
 * @param {number} t
 * @returns {Pose}
 */
export function poseAt(id, t) {
  const clip = CLIPS[id];
  if (!clip || t < 0 || t >= clip.ms) return rest();
  return { ...rest(), ...clip.pose(t) };
}

/** @param {GestureId} id @returns {number} clip length in ms */
export function clipLength(id) {
  return CLIPS[id]?.ms ?? 0;
}

/**
 * How long an interrupted gesture takes to hand over to the new one. Long
 * enough that Twist Right → Twist Left back-to-back stays under ~20 rad/s,
 * near the fastest real twists (17 rad/s).
 */
const RESIDUAL_MS = 200;
/** Red edge glow per fire (spec §10.5: ~250 ms). */
const GLOW = { attack: 25, ms: 250 };

export class GestureAnimator {
  /**
   * @param {import('./WristMannequin.js').WristMannequin} rig
   */
  constructor(rig) {
    this.rig = rig;
    /** @type {import('./watch/WatchModel.js').WatchModel | null} */
    this.watch = null;
    this.pose = rest();
    /** @type {{ clip: Clip, t: number, tapsDone: number } | null} */
    this.active = null;
    /** @type {{ pose: Pose, t: number } | null} */
    this.residual = null;
    /** @type {number | null} */
    this.glowT = null;
  }

  /** @param {import('./watch/WatchModel.js').WatchModel} watch */
  setWatch(watch) {
    this.watch = watch;
  }

  /** @param {GestureId} id */
  play(id) {
    const clip = CLIPS[id];
    if (!clip) return;
    this.residual = { pose: { ...this.pose }, t: 0 };
    this.active = { clip, t: 0, tapsDone: 0 };
    this.glowT = 0;
  }

  /**
   * @param {number} dt seconds
   * @returns {boolean} whether anything moved this frame (so the scene must redraw)
   */
  update(dt) {
    const ms = dt * 1000;
    if (!this.active && !this.residual && this.glowT === null && !this.watch?.rippleActive) return false;

    const pose = rest();
    if (this.active) {
      const a = this.active;
      a.t = Math.min(a.t + ms, a.clip.ms);
      Object.assign(pose, a.clip.pose(a.t));
      const taps = a.clip.taps ?? [];
      while (a.tapsDone < taps.length && a.t >= taps[a.tapsDone]) {
        this.watch?.ripple();
        a.tapsDone++;
      }
      if (a.t >= a.clip.ms) this.active = null;
    }
    if (this.residual) {
      const r = this.residual;
      r.t += ms;
      const k = 1 - THREE.MathUtils.smoothstep(r.t, 0, RESIDUAL_MS);
      pose.roll += r.pose.roll * k;
      pose.tip += r.pose.tip * k;
      pose.hand += r.pose.hand * k;
      pose.dip += r.pose.dip * k;
      if (k <= 0) this.residual = null;
    }
    this.pose = pose;
    this.#apply(pose);

    if (this.glowT !== null) {
      this.glowT += ms;
      const t = this.glowT;
      const level = t < GLOW.attack ? t / GLOW.attack : (1 - (t - GLOW.attack) / (GLOW.ms - GLOW.attack)) ** 2;
      this.watch?.setGlow(t >= GLOW.ms ? 0 : level);
      if (t >= GLOW.ms) this.glowT = null;
    }
    this.watch?.updateRipple(dt);
    return true;
  }

  /** @param {Pose} pose */
  #apply(pose) {
    const { forearm, wrist } = this.rig;
    forearm.rotation.set(pose.roll, pose.tip, 0);
    forearm.position.set(0, 0, FOREARM_AXIS_Z + pose.dip);
    wrist.rotation.set(0, pose.hand, 0);
  }
}
