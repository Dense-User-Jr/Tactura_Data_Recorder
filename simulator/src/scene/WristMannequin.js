import * as THREE from 'three';

/**
 * Minimal abstract forearm and hand (spec §10.4), drawn like a technical
 * illustration: a near-black body with a fine light rim at its silhouette and
 * sparse hairline sections. Never realistic skin, and dark enough that the
 * watch stays the hero.
 *
 * Millimeters, watch-local axes: +X along the forearm toward the hand
 * (3 o'clock), +Y toward 12 o'clock, +Z out of the watch face. Left wrist,
 * palm down, so the thumb sits on the 6 o'clock (−Y) side.
 *
 * The groups are the motion rig, and they exist whether or not the body is
 * visible:
 *
 *   forearm        pivots on the forearm's own axis, inside the strap loop
 *   ├─ watchMount  the watch, strapped just behind the wrist joint
 *   └─ wrist       the hand's pivot; flicks rotate this
 *
 * So a twist rolls the watch around the arm (as on a real wrist), and a flick
 * swings the hand a lot while the watch on the forearm barely moves.
 */

/** Forearm axis, relative to the watch center (watch-local z, mm). The wrist top touches the sensor dome. */
export const FOREARM_AXIS_Z = -21.8;
/** Wrist joint, measured along the forearm from under the watch (mm). */
export const WRIST_X = 44;

/**
 * Body shading: base + a rim that brightens toward the silhouette + a faint
 * key-light term. The key light rides with the camera (see lighting.js), so
 * its direction is fixed in view space.
 */
const GHOST = new THREE.ShaderMaterial({
  uniforms: {
    base: { value: new THREE.Color(0x0e0e10) },
    rim: { value: new THREE.Color(0x9a9aa2) },
    shade: { value: new THREE.Color(0x26262b) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 base;
    uniform vec3 rim;
    uniform vec3 shade;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec3 n = normalize(vNormal);
      float facing = abs(dot(n, normalize(vView)));
      float edge = pow(1.0 - facing, 3.0);
      float key = max(dot(n, normalize(vec3(-0.6, 0.65, 0.5))), 0.0);
      gl_FragColor = vec4(base + shade * key + rim * edge, 1.0);
    }`,
});

const HAIRLINE = new THREE.LineBasicMaterial({ color: 0x8c8c93, transparent: true, opacity: 0.26, depthWrite: false });

/** Forearm cross-sections [x, half-width (Y), half-height (Z)], forearm-local mm. Ends in a rounded wrist. */
const FOREARM_KEYS = [
  [-215, 37, 30],
  [-150, 35, 26.5],
  [-95, 32, 22.5],
  [-50, 29.5, 18.5],
  [-15, 28, 16.2],
  [20, 27.5, 16],
  [36, 26.5, 15.5],
  [46, 23, 13.8],
  [53, 13, 8.5],
  [55.5, 3, 2],
];

/** Palm cross-sections, wrist-local mm: heel → knuckles, rounding off where the fingers start. */
const PALM_KEYS = [
  [-9, 4, 3],
  [-6, 19, 10],
  [2, 25, 12],
  [24, 32, 12.5],
  [52, 37, 12],
  [78, 39.5, 11],
  [89, 38.5, 9.5],
  [95, 29, 6.5],
  [98, 9, 2.5],
];

/** Fingers [y at the knuckle, length, half-width, splay°]. Index sits next to the thumb (−Y). */
const FINGERS = [
  [-27, 74, 8.8, -4],
  [-9, 82, 9.1, -1.5],
  [9, 77, 8.7, 1.5],
  [26, 61, 7.6, 5],
];
const KNUCKLE_X = 84;

export class WristMannequin {
  constructor() {
    this.forearm = new THREE.Group();
    this.forearm.name = 'forearm';
    this.forearm.position.z = FOREARM_AXIS_Z;

    this.watchMount = new THREE.Group();
    this.watchMount.name = 'watchMount';
    this.watchMount.position.z = -FOREARM_AXIS_Z;

    this.wrist = new THREE.Group();
    this.wrist.name = 'wrist';
    this.wrist.position.x = WRIST_X;

    this.forearm.add(this.watchMount, this.wrist);

    // ---- visible body ----
    const arm = loft(FOREARM_KEYS, { samples: 64, exponent: 2.2 });
    this.forearmBody = new THREE.Group();
    this.forearmBody.add(
      new THREE.Mesh(arm.geometry, GHOST),
      hairlines(arm.stations, { exponent: 2.2, ringsAt: [-195, -160, -125, -90, -55, -24, 30], spokes: 4 }),
    );

    const palm = loft(PALM_KEYS, { samples: 40, exponent: 3 });
    this.handBody = new THREE.Group();
    this.handBody.add(
      new THREE.Mesh(palm.geometry, GHOST),
      hairlines(palm.stations, { exponent: 3, ringsAt: [8, 46], spokes: 4 }),
      ...FINGERS.map(([y, length, halfWidth, splay]) => finger(y, length, halfWidth, splay)),
      thumb(),
    );

    this.forearm.add(this.forearmBody);
    this.wrist.add(this.handBody);
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.forearmBody.visible = visible;
    this.handBody.visible = visible;
  }

  get visible() {
    return this.forearmBody.visible;
  }
}

/**
 * @typedef {{ x: number, a: number, b: number, z: number }} Station
 *          a cross-section: half-width a (Y), half-height b (Z), center height z
 */

/**
 * Smooth tube along X through superellipse cross-sections. The ends close
 * because the first and last keys taper to (almost) nothing.
 * @param {number[][]} keys [x, a, b]
 * @param {{ samples: number, exponent: number, zAt?: (x: number) => number, segments?: number }} options
 */
function loft(keys, { samples, exponent, zAt = () => 0, segments = 48 }) {
  const curve = new THREE.CatmullRomCurve3(
    keys.map(([x, a, b]) => new THREE.Vector3(x, a, b)),
    false,
    'centripetal',
  );
  /** @type {Station[]} */
  const stations = curve.getPoints(samples).map((p) => ({ x: p.x, a: Math.max(p.y, 0), b: Math.max(p.z, 0), z: zAt(p.x) }));
  // pinch both ends shut
  stations.unshift({ ...stations[0], a: 0, b: 0 });
  stations.push({ ...stations[stations.length - 1], a: 0, b: 0 });

  const positions = [];
  for (const s of stations) {
    for (let j = 0; j < segments; j++) {
      const [y, z] = superellipse(s, (j / segments) * Math.PI * 2, exponent);
      positions.push(s.x, y, z);
    }
  }
  const indices = [];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = (i + 1) * segments + j;
      const c = (i + 1) * segments + ((j + 1) % segments);
      const d = i * segments + ((j + 1) % segments);
      indices.push(a, d, b, b, d, c); // wound so faces point outward
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, stations };
}

/**
 * @param {Station} s
 * @param {number} t angle, 0 = +Y, π/2 = +Z
 * @param {number} n superellipse exponent (2 = ellipse, higher = boxier)
 * @param {number} [grow] outward offset in mm
 * @returns {[number, number]} [y, z]
 */
function superellipse(s, t, n, grow = 0) {
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const k = 2 / n;
  return [(s.a + grow) * Math.sign(c) * Math.abs(c) ** k, s.z + (s.b + grow) * Math.sign(sn) * Math.abs(sn) ** k];
}

/** Cross-section interpolated at any x. @param {Station[]} stations @param {number} x */
function stationAt(stations, x) {
  for (let i = 1; i < stations.length; i++) {
    const s0 = stations[i - 1];
    const s1 = stations[i];
    if (x <= s1.x && s1.x > s0.x) {
      const f = THREE.MathUtils.clamp((x - s0.x) / (s1.x - s0.x), 0, 1);
      return { x, a: s0.a + (s1.a - s0.a) * f, b: s0.b + (s1.b - s0.b) * f, z: s0.z + (s1.z - s0.z) * f };
    }
  }
  return { ...stations[stations.length - 1], x };
}

/**
 * Technical-drawing hairlines: section rings at chosen x, plus longitudinal spokes.
 * @param {Station[]} stations
 * @param {{ exponent: number, ringsAt: number[], spokes: number }} options
 */
function hairlines(stations, { exponent, ringsAt, spokes }) {
  const GROW = 0.25; // sit just above the surface
  const RING_STEPS = 72;
  const pts = [];
  for (const x of ringsAt) {
    const s = stationAt(stations, x);
    for (let j = 0; j < RING_STEPS; j++) {
      const [y0, z0] = superellipse(s, (j / RING_STEPS) * Math.PI * 2, exponent, GROW);
      const [y1, z1] = superellipse(s, ((j + 1) / RING_STEPS) * Math.PI * 2, exponent, GROW);
      pts.push(x, y0, z0, x, y1, z1);
    }
  }
  const solid = stations.filter((s) => s.a > 1.5 && s.b > 1.5);
  for (let k = 0; k < spokes; k++) {
    const t = (k / spokes) * Math.PI * 2 + Math.PI / 4;
    for (let i = 0; i < solid.length - 1; i++) {
      const [y0, z0] = superellipse(solid[i], t, exponent, GROW);
      const [y1, z1] = superellipse(solid[i + 1], t, exponent, GROW);
      pts.push(solid[i].x, y0, z0, solid[i + 1].x, y1, z1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geometry, HAIRLINE);
}

/**
 * One tapered finger from its knuckle, curling slightly down toward the tip.
 * @param {number} y knuckle position across the hand
 * @param {number} length
 * @param {number} halfWidth at the base
 * @param {number} splayDeg spread in the plane of the hand
 */
function finger(y, length, halfWidth, splayDeg) {
  const w = halfWidth;
  const h = w * 0.86;
  const { geometry } = loft(
    [
      [-6, w * 0.6, h * 0.6],
      [0, w, h],
      [length * 0.45, w * 0.92, h * 0.9],
      [length * 0.85, w * 0.78, h * 0.76],
      [length - 2, w * 0.55, h * 0.55],
      [length, w * 0.12, h * 0.12],
    ],
    { samples: 20, exponent: 2.3, segments: 24 },
  );
  const mesh = new THREE.Mesh(geometry, GHOST);
  mesh.position.set(KNUCKLE_X, y, -1.5);
  mesh.rotation.set(0, THREE.MathUtils.degToRad(7), THREE.MathUtils.degToRad(splayDeg), 'ZYX');
  return mesh;
}

/** Thumb along the 6 o'clock side of the palm, angled forward and slightly down. */
function thumb() {
  const from = new THREE.Vector3(14, -27, -3);
  const to = new THREE.Vector3(62, -45, -8);
  const dir = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(9, dir.length(), 8, 24), GHOST);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}
