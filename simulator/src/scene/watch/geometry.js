import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Geometry for the procedural Galaxy Watch 7 (44 mm). Millimeters, in
 * watch-local axes that follow Android sensors: +X toward 3 o'clock,
 * +Y toward 12 o'clock, +Z out of the screen.
 */

/** Reference dimensions (spec §10.1). Total thickness: glass top to dome bottom = 9.7 mm. */
export const DIM = {
  caseR: 22.2, //           44.4 mm diameter
  glassTop: 4.25,
  glassR: 20.25,
  displayR: 19.0, //        ~38 mm visible display
  panelZ: 3.62, //          display panel plane, just under the glass
  backZ: -3.9, //           where the sensor module meets the case back
  sensorR: 16.8,
  domeBottom: -5.5,
  buttonAngle: THREE.MathUtils.degToRad(17), // Home above 3 o'clock, Back below
  buttonZ: 0.55,
  bandWidth: 20,
  floorY: -31.7, //         lowest point of the strap loop (presentation floor)
};

const LATHE_SEGMENTS = 160;

/** Points on a circular arc, angles in degrees, counter-clockwise from +r. */
function arc(cr, cz, radius, fromDeg, toDeg, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = THREE.MathUtils.degToRad(fromDeg + ((toDeg - fromDeg) * i) / steps);
    pts.push(new THREE.Vector2(cr + radius * Math.cos(a), cz + radius * Math.sin(a)));
  }
  return pts;
}

/**
 * Lathe around watch Z. LatheGeometry spins around Y, so rotate afterwards.
 * Profile points are (r, z); order them so (dz, -dr) points outward.
 * @param {THREE.Vector2[]} profile
 */
function latheZ(profile, segments = LATHE_SEGMENTS) {
  const geo = new THREE.LatheGeometry(profile, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Case body: back plate → lower shoulder → slightly bellied side → upper shoulder → glass seat. */
export function caseGeometry() {
  const { caseR } = DIM;
  const profile = [
    new THREE.Vector2(DIM.sensorR, DIM.backZ),
    new THREE.Vector2(17.4, -3.56),
    new THREE.Vector2(18.3, -3.43),
    ...arc(20.0, -1.2, 2.2, -90, 0, 20),
  ];
  // the side bulges by 0.06 mm at mid-height, like the real case
  for (let i = 1; i < 6; i++) {
    const z = -1.2 + (3.4 * i) / 6;
    profile.push(new THREE.Vector2(caseR + 0.06 * Math.sin((Math.PI * i) / 6), z));
  }
  profile.push(...arc(caseR - 1.75, 2.2, 1.75, 0, 90, 20));
  profile.push(new THREE.Vector2(20.25, 3.93), new THREE.Vector2(20.05, 3.7));
  return latheZ(profile);
}

/** Flat sapphire with a small edge chamfer. Outer edge first so normals face up. */
export function glassGeometry() {
  return latheZ([
    new THREE.Vector2(DIM.glassR, 3.98),
    new THREE.Vector2(20.05, 4.17),
    new THREE.Vector2(19.7, DIM.glassTop),
    new THREE.Vector2(0, DIM.glassTop),
  ]);
}

/** Height of the underside sensor dome at radius r (a shallow paraboloid). */
export function domeZ(r) {
  return DIM.domeBottom + (DIM.backZ - DIM.domeBottom) * (r / DIM.sensorR) ** 2;
}

/** Outward (downward) unit normal of the dome at radius r, angle a. */
export function domeNormal(r, a) {
  const slope = (2 * (DIM.backZ - DIM.domeBottom) * r) / DIM.sensorR ** 2; // dz/dr
  return new THREE.Vector3(slope * Math.cos(a), slope * Math.sin(a), -1).normalize();
}

/** Sensor dome, center outward so normals face down. */
export function domeGeometry() {
  const profile = [];
  for (let i = 0; i <= 24; i++) {
    const r = (DIM.sensorR * i) / 24;
    profile.push(new THREE.Vector2(r, domeZ(r)));
  }
  return latheZ(profile, 96);
}

/** Thin band following the dome surface (the electrode ring). */
export function domeRingGeometry(r0, r1, lift = 0.03) {
  return latheZ(
    [
      new THREE.Vector2(r0, domeZ(r0) - lift),
      new THREE.Vector2(r1, domeZ(r1) - lift),
    ],
    96,
  );
}

/**
 * One lug horn. A side profile (in the Y–Z plane) extruded along X with
 * rounded bevels, so it grows out of the case shoulder and dips toward the wrist.
 * @param {number} side +1 for the 3 o'clock horn, -1 for the 9 o'clock horn (12 o'clock end)
 */
export function hornGeometry(side) {
  const s = new THREE.Shape();
  s.moveTo(16, 2.95);
  s.lineTo(20.8, 2.8);
  s.quadraticCurveTo(24.3, 2.45, 25.0, 0.7);
  s.quadraticCurveTo(25.35, -0.35, 24.6, -1.25);
  s.quadraticCurveTo(23.1, -2.6, 20.8, -2.85);
  s.lineTo(16, -2.85);
  s.closePath();

  const depth = 1.6;
  const bevel = 0.5;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: 0.45,
    bevelSegments: 5,
    curveSegments: 20,
  });
  // shape (u, v, extrude w) → watch (x = w, y = u, z = v); a rotation, so normals stay valid
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  // horns sit just outside the 20 mm band: |x| from 10.1 to 12.7
  geo.translate(side > 0 ? 10.1 + bevel : -10.1 - bevel - depth, 0, 0);
  return geo;
}

/** Pill-shaped side key, long axis along the case circumference. */
export function buttonGeometry() {
  return new RoundedBoxGeometry(1.8, 5.0, 2.0, 4, 0.85);
}

/**
 * The sport band as one closed loop, as if worn: it leaves the 12 o'clock
 * lug, wraps around a wrist-sized cross-section (about 61 × 40 mm, axis along X)
 * and comes back into the 6 o'clock lug. Both ends start inside the case.
 */
export function strapCurve() {
  const yz = [
    [16, -0.7],
    [23.5, -0.9],
    [27.8, -3.6],
    [30.4, -10],
    [30.9, -18],
    [28.6, -27],
    [21.5, -35.5],
    [8, -40.3],
  ];
  const half = yz.map(([y, z]) => new THREE.Vector3(0, y, z));
  const mirrored = [...yz].reverse().map(([y, z]) => new THREE.Vector3(0, -y, z));
  return new THREE.CatmullRomCurve3([...half, ...mirrored], false, 'centripetal');
}

/**
 * Sweeps a rounded-rectangle cross-section along a planar curve in the Y–Z
 * plane. Width runs along X, thickness along the curve's outward normal.
 * Normals are analytic (exact on the flat faces, radial on the rounded edges).
 * @param {THREE.Curve<THREE.Vector3>} curve
 * @param {{ samples?: number, width?: number, thicknessAt?: (u: number) => number, corner?: number, cornerSteps?: number, loopCenter?: THREE.Vector3 }} [options]
 */
export function sweptBandGeometry(curve, options = {}) {
  const {
    samples = 260,
    width = DIM.bandWidth,
    thicknessAt = () => 2.6,
    corner = 0.95,
    cornerSteps = 5,
    loopCenter = new THREE.Vector3(0, 0, -20),
  } = options;

  // unit cross-section corners, counter-clockwise in (w, n) starting bottom-right
  const corners = [
    { cw: 1, cn: -1, from: -90 },
    { cw: 1, cn: 1, from: 0 },
    { cw: -1, cn: 1, from: 90 },
    { cw: -1, cn: -1, from: 180 },
  ];
  const perRing = corners.length * (cornerSteps + 1);
  const length = curve.getLength();
  const X = new THREE.Vector3(1, 0, 0);

  const positions = [];
  const normals = [];
  const uvs = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    n.set(0, t.z, -t.y).normalize();
    if (n.dot(p.clone().sub(loopCenter)) < 0) n.negate();

    const thick = thicknessAt(u);
    const halfW = width / 2 - corner;
    const halfT = thick / 2 - corner;

    for (const c of corners) {
      for (let k = 0; k <= cornerSteps; k++) {
        const a = THREE.MathUtils.degToRad(c.from + (90 * k) / cornerSteps);
        const nw = Math.cos(a);
        const nn = Math.sin(a);
        const w = c.cw * halfW + corner * nw;
        const off = c.cn * halfT + corner * nn;
        positions.push(p.x + X.x * w + n.x * off, p.y + X.y * w + n.y * off, p.z + X.z * w + n.z * off);
        normals.push(X.x * nw + n.x * nn, X.y * nw + n.y * nn, X.z * nw + n.z * nn);
        uvs.push((w + off) / 7, (u * length) / 7); // grain tile ≈ 7 mm, fine like fluoroelastomer
      }
    }
  }

  const indices = [];
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < perRing; j++) {
      const a = i * perRing + j;
      const b = (i + 1) * perRing + j;
      const c = (i + 1) * perRing + ((j + 1) % perRing);
      const d = i * perRing + ((j + 1) % perRing);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  matchWindingToNormals(geo);
  return geo;
}

/** Flips triangle winding if it disagrees with the supplied normals, so front faces face outward. */
function matchWindingToNormals(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const idx = /** @type {THREE.BufferAttribute} */ (geo.getIndex());
  const [a, b, c] = [idx.getX(0), idx.getX(1), idx.getX(2)];
  const va = new THREE.Vector3().fromBufferAttribute(pos, a);
  const face = new THREE.Vector3()
    .subVectors(new THREE.Vector3().fromBufferAttribute(pos, b), va)
    .cross(new THREE.Vector3().subVectors(new THREE.Vector3().fromBufferAttribute(pos, c), va));
  if (face.dot(new THREE.Vector3().fromBufferAttribute(nor, a)) >= 0) return;
  const arr = idx.array;
  for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
  idx.needsUpdate = true;
}

/** Band is thicker where it meets the lugs, thinner around the wrist. */
export function strapThickness(u) {
  const end = Math.min(u, 1 - u);
  const k = THREE.MathUtils.smoothstep(end, 0.02, 0.16);
  return 3.3 - 0.8 * k;
}
