import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SyntheticImu } from '../src/telemetry/SyntheticImu.js';
import { FOREARM_AXIS_Z } from '../src/scene/WristMannequin.js';
import { poseAt } from '../src/scene/GestureAnimator.js';

/** A bare rig with the same geometry as WristMannequin. */
function rig() {
  const forearm = new THREE.Object3D();
  forearm.position.z = FOREARM_AXIS_Z;
  const watchMount = new THREE.Object3D();
  watchMount.position.z = -FOREARM_AXIS_Z;
  forearm.add(watchMount);
  return { forearm, watchMount };
}

/** Drives the IMU at 60 fps for `ms`, with `pose(tMs)` setting the forearm. */
function run(imu, { forearm, watchMount }, ms, pose) {
  const dt = 1 / 60;
  for (let t = 0; t <= ms; t += dt * 1000) {
    pose(t, forearm);
    imu.step(forearm, watchMount, dt, t);
  }
}

describe('SyntheticImu (spec §12)', () => {
  it('reads like the recordings at rest: face up, ~9.81 m/s² on Z, no rotation', () => {
    const imu = new SyntheticImu();
    run(imu, rig(), 500, () => {});
    expect(imu.current.ax).toBeCloseTo(0, 3);
    expect(imu.current.ay).toBeCloseTo(0, 3);
    expect(imu.current.az).toBeCloseTo(9.81, 3);
    expect(Math.hypot(imu.current.gx, imu.current.gy, imu.current.gz)).toBeLessThan(1e-6);
  });

  it('a constant roll about the forearm reads as positive gyro_x at that rate', () => {
    const imu = new SyntheticImu();
    run(imu, rig(), 300, (t, forearm) => forearm.rotation.set(2 * (t / 1000), 0, 0)); // 2 rad/s
    expect(imu.current.gx).toBeCloseTo(2, 2);
    expect(Math.abs(imu.current.gy) + Math.abs(imu.current.gz)).toBeLessThan(1e-3);
  });

  it('Twist Right peaks on +gyro_x and Twist Left on −gyro_x, in the recorded range', () => {
    for (const [id, sign] of /** @type {const} */ ([['TWIST_RIGHT', 1], ['TWIST_LEFT', -1]])) {
      const imu = new SyntheticImu();
      let peak = 0;
      const r = rig();
      const dt = 1 / 60;
      for (let t = 0; t <= 900; t += dt * 1000) {
        const pose = poseAt(id, t);
        r.forearm.rotation.set(pose.roll, pose.tip, 0);
        imu.step(r.forearm, r.watchMount, dt, t);
        if (Math.abs(imu.current.gx) > Math.abs(peak)) peak = imu.current.gx;
      }
      expect(Math.sign(peak)).toBe(sign);
      expect(Math.abs(peak)).toBeGreaterThan(6);
      expect(Math.abs(peak)).toBeLessThan(17);
    }
  });

  it('resamples to ~50 Hz and keeps a 3 s window', () => {
    const imu = new SyntheticImu();
    run(imu, rig(), 5000, () => {});
    expect(imu.count).toBe(150);
    expect(imu.series('az')).toHaveLength(150);
  });
});
