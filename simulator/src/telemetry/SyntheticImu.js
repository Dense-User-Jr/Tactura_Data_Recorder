import * as THREE from 'three';

/**
 * SYNTHETIC accelerometer and gyroscope (spec §12), derived from the
 * animated watch pose, in the recorder's units and axes: m/s² and rad/s,
 * X toward 3 o'clock, Y toward 12 o'clock, Z out of the screen, ~50 Hz.
 *
 *   gyro  = ω, the watch's angular velocity in its own frame
 *   accel = Rᵀ (a_world − g),  g = (0, −9.81, 0)
 *
 * It works in a fixed physical frame where the watch rests face up on a level
 * forearm (like the recordings, which rest at about (0.3, 0.6, 9.7)), using
 * only the gesture motion. So the numbers don't depend on which presentation
 * the 3D view uses or where the camera is.
 *
 * For intuition only. These are NOT sensor data: never feed them to a
 * classifier for training or evaluation, and never present them as real.
 *
 * @typedef {'ax'|'ay'|'az'|'gx'|'gy'|'gz'} Channel
 */

export const CHANNELS = /** @type {const} */ (['ax', 'ay', 'az', 'gx', 'gy', 'gz']);

const G = 9.81;
/** Watch-local → physical: face (watch +Z) up, 12 o'clock (watch +Y) pointing away from the wearer. */
const REST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** Light smoothing of the frame-to-frame derivatives, so frame-time jitter doesn't read as motion. */
const SMOOTH_MS = 12;

export class SyntheticImu {
  /** @param {{ rateHz?: number, seconds?: number }} [options] */
  constructor({ rateHz = 50, seconds = 3 } = {}) {
    this.period = 1000 / rateHz;
    this.capacity = Math.round(rateHz * seconds);
    /** Ring buffers, one per channel; `head` is the next write index. */
    this.buffers = Object.fromEntries(CHANNELS.map((c) => [c, new Float32Array(this.capacity)]));
    this.head = 0;
    this.count = 0;
    /** Bumped on every sample, so a view can tell when to redraw. */
    this.version = 0;
    /** Latest value per channel. @type {Record<Channel, number>} */
    this.current = { ax: 0, ay: 0, az: G, gx: 0, gy: 0, gz: 0 };

    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.prevQ = new THREE.Quaternion();
    this.prevP = new THREE.Vector3();
    this.prevV = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.a = new THREE.Vector3();
    this.omega = new THREE.Vector3();
    this.primed = 0;
    this.lastSampleAt = -Infinity;
  }

  /**
   * Feed the rig's pose once per frame.
   * @param {THREE.Object3D} forearm   the gesture-driven forearm group (watch-local mm, see WristMannequin)
   * @param {THREE.Object3D} watchMount where the watch sits on the forearm
   * @param {number} dt seconds
   * @param {number} now ms
   */
  step(forearm, watchMount, dt, now) {
    if (dt <= 0) return;
    // watch pose relative to the rig, then into the physical frame (metres)
    this.q.copy(REST).multiply(forearm.quaternion);
    this.p.copy(watchMount.position).applyQuaternion(forearm.quaternion).add(forearm.position);
    this.p.applyQuaternion(REST).multiplyScalar(0.001);

    if (this.primed >= 1) {
      // body-frame angular velocity from the quaternion change: q = q_prev · Δ
      const delta = this.prevQ.clone().invert().multiply(this.q);
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w); // shortest arc
      const half = Math.acos(Math.min(1, delta.w));
      const s = Math.sin(half);
      const angle = 2 * half;
      const omega = s > 1e-9 ? new THREE.Vector3(delta.x / s, delta.y / s, delta.z / s).multiplyScalar(angle / dt) : new THREE.Vector3();
      const k = 1 - Math.exp(-(dt * 1000) / SMOOTH_MS);
      this.omega.lerp(omega, k);

      const v = this.p.clone().sub(this.prevP).divideScalar(dt);
      if (this.primed >= 2) {
        const a = v.clone().sub(this.prevV).divideScalar(dt);
        this.a.lerp(a, k);
      }
      this.prevV.copy(v);
    }
    this.prevQ.copy(this.q);
    this.prevP.copy(this.p);
    this.primed = Math.min(this.primed + 1, 2);

    // accel = Rᵀ (a − g) with g = (0, −9.81, 0)
    const specific = this.a.clone().add(new THREE.Vector3(0, G, 0)).applyQuaternion(this.q.clone().invert());
    this.current = { ax: specific.x, ay: specific.y, az: specific.z, gx: this.omega.x, gy: this.omega.y, gz: this.omega.z };

    // resample to the fixed rate (sample-and-hold between frames)
    if (now - this.lastSampleAt > 4 * this.period) this.lastSampleAt = now - this.period;
    while (now - this.lastSampleAt >= this.period) {
      this.lastSampleAt += this.period;
      for (const c of CHANNELS) this.buffers[c][this.head] = this.current[c];
      this.head = (this.head + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
      this.version++;
    }
  }

  /**
   * Samples of one channel, oldest first.
   * @param {Channel} channel
   * @returns {Float32Array}
   */
  series(channel) {
    const out = new Float32Array(this.count);
    const buf = this.buffers[channel];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out[i] = buf[(start + i) % this.capacity];
    return out;
  }
}
