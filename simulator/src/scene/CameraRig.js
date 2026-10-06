import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const deg = THREE.MathUtils.degToRad;

/**
 * @typedef {Object} Pose
 * @property {number} yaw       radians around the vertical axis; 0 = straight at the face, + = toward 3 o'clock
 * @property {number} pitch     radians above the watch's equator
 * @property {number} distance  world units from the watch center
 */

/** Hero angle (spec §10.3): slightly above, ~25° off the face normal toward the side keys. */
export const HERO = /** @type {Pose} */ ({ yaw: deg(25), pitch: deg(12), distance: 2.6 });

const MIN_PITCH = deg(-78); // clamped short of the poles so the view never flips
const MAX_PITCH = deg(80);
const KEY_SPEED = deg(95); // rad/s with a key fully held
const KEY_ACCEL_TAU = 0.14; // s, ease toward full speed
const KEY_RELEASE_TAU = 0.2; // s, coast to a stop
const RESET_MS = 600;

const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const easeOutCubic = (p) => 1 - (1 - p) ** 3;

/** Wraps an angle difference into (-π, π] so tweens take the short way round. */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Orbits the camera around the watch (spec §10.3). Mouse drag and wheel go
 * through OrbitControls (damped, zoom clamped, no pan). Keys feed axes that
 * become angular velocity with smooth acceleration and coasting.
 */
export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {{ reducedMotion: boolean }} options
   */
  constructor(camera, domElement, { reducedMotion }) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;

    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 1.3;
    controls.maxDistance = 4.8;
    controls.minPolarAngle = Math.PI / 2 - MAX_PITCH;
    controls.maxPolarAngle = Math.PI / 2 - MIN_PITCH;
    controls.addEventListener('start', () => {
      this.tween = null; // grabbing the view cancels a reset in progress
    });
    this.controls = controls;

    this.input = { yaw: 0, pitch: 0 };
    this.velocity = { yaw: 0, pitch: 0 };
    /** @type {{ from: Pose, to: Pose, elapsed: number, ms: number, ease: (p: number) => number } | null} */
    this.tween = null;

    this.setPose(HERO);
  }

  /** @returns {Pose} */
  get pose() {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    return { yaw: s.theta, pitch: Math.PI / 2 - s.phi, distance: s.radius };
  }

  /** @param {Pose} pose */
  setPose({ yaw, pitch, distance }) {
    const s = new THREE.Spherical(distance, Math.PI / 2 - pitch, yaw);
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
  }

  /**
   * Held-key axes from CameraKeys, each -1, 0 or 1.
   * @param {number} yaw
   * @param {number} pitch
   */
  setInput(yaw, pitch) {
    this.input = { yaw, pitch };
    if (yaw || pitch) this.tween = null;
  }

  /** `R`: animate back to the hero angle. */
  reset() {
    this.animateTo(HERO, RESET_MS);
  }

  /**
   * @param {Pose} to
   * @param {number} ms
   * @param {{ from?: Pose, ease?: (p: number) => number }} [options]
   */
  animateTo(to, ms, { from = this.pose, ease = easeInOutCubic } = {}) {
    // drop any leftover drag momentum (OrbitControls keeps it privately; best effort)
    /** @type {any} */ (this.controls)._sphericalDelta?.set(0, 0, 0);
    this.velocity = { yaw: 0, pitch: 0 };
    if (this.reducedMotion || ms <= 0) {
      this.tween = null;
      this.setPose(to);
      return;
    }
    this.setPose(from);
    this.tween = { from, to: { ...to, yaw: from.yaw + wrap(to.yaw - from.yaw) }, elapsed: 0, ms, ease };
  }

  /** @param {number} dt seconds */
  update(dt) {
    for (const axis of /** @type {const} */ (['yaw', 'pitch'])) {
      const target = this.input[axis] * KEY_SPEED;
      if (this.reducedMotion) {
        this.velocity[axis] = target;
      } else {
        const tau = target !== 0 ? KEY_ACCEL_TAU : KEY_RELEASE_TAU;
        this.velocity[axis] += (target - this.velocity[axis]) * (1 - Math.exp(-dt / tau));
        if (target === 0 && Math.abs(this.velocity[axis]) < 1e-3) this.velocity[axis] = 0;
      }
    }

    if (this.tween) {
      const tw = this.tween;
      tw.elapsed += dt * 1000;
      const k = tw.ease(Math.min(tw.elapsed / tw.ms, 1));
      this.setPose({
        yaw: tw.from.yaw + (tw.to.yaw - tw.from.yaw) * k,
        pitch: tw.from.pitch + (tw.to.pitch - tw.from.pitch) * k,
        distance: tw.from.distance + (tw.to.distance - tw.from.distance) * k,
      });
      if (tw.elapsed >= tw.ms) this.tween = null;
    } else if (this.velocity.yaw || this.velocity.pitch) {
      const pose = this.pose;
      this.setPose({
        yaw: pose.yaw + this.velocity.yaw * dt,
        pitch: THREE.MathUtils.clamp(pose.pitch + this.velocity.pitch * dt, MIN_PITCH, MAX_PITCH),
        distance: pose.distance,
      });
    }

    this.controls.update();
  }
}
