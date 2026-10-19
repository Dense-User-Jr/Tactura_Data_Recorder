import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_FINISH, applyFinish, createWatchMaterials, setDisplayLevel, setGlowLevel } from './materials.js';
import {
  DIM,
  buttonGeometry,
  caseGeometry,
  domeGeometry,
  domeNormal,
  domeRingGeometry,
  domeZ,
  glassGeometry,
  hornGeometry,
  strapCurve,
  strapThickness,
  sweptBandGeometry,
} from './geometry.js';

/** A tap ripple crosses the glass (~20 mm at 85 mm/s) and fades in this long. */
const RIPPLE_S = 0.32;

/**
 * @typedef {import('./materials.js').FinishId} FinishId
 * @typedef {{ position: THREE.Vector3, normal: THREE.Vector3 | null }} Anchor
 *          a point in watch-local mm; `normal` null means internal (always shown)
 */

/**
 * Procedural Samsung Galaxy Watch 7, 44 mm (spec §10.1), built from primitives
 * in millimeters. `group` is in watch-local axes: +X toward 3 o'clock,
 * +Y toward 12 o'clock, +Z out of the screen.
 *
 * The display is its own mesh driven by the screen canvas texture, so a
 * downloaded GLB case could replace the rest behind this same API.
 */
export class WatchModel {
  /**
   * @param {{ finish?: FinishId, screenTexture?: THREE.Texture | null }} [options]
   */
  constructor({ finish = DEFAULT_FINISH, screenTexture = null } = {}) {
    this.finish = finish;
    this.materials = createWatchMaterials(finish, screenTexture);
    this.group = new THREE.Group();
    this.group.name = 'GalaxyWatch7';

    const m = this.materials;
    const add = (geometry, material, name) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };

    /** The aluminum case shell. Later phases tint its edge for the fire glow. */
    this.caseMesh = add(caseGeometry(), m.aluminum, 'case');

    // lug horns at 12 o'clock, then the same pair turned 180° for 6 o'clock
    for (const end of [0, Math.PI]) {
      for (const side of [1, -1]) {
        const horn = add(hornGeometry(side), m.aluminumPlain, 'lug');
        horn.rotation.z = end;
      }
    }

    // display stack: black panel (the border) → lit display → sapphire
    const panel = add(new THREE.CircleGeometry(20.1, 128), m.panelBlack, 'panel');
    panel.position.z = DIM.panelZ;
    /** Display mesh; its texture is the WatchScreen canvas. */
    this.display = add(new THREE.CircleGeometry(DIM.displayR, 128), m.display, 'display');
    this.display.position.z = DIM.panelZ + 0.02;
    this.glass = add(glassGeometry(), m.glass, 'glass');
    this.glass.renderOrder = 2;

    // fire glow: a thin ring hugging the upper case shoulder, just off the surface
    this.glowRing = add(new THREE.TorusGeometry(21.8, 0.3, 12, 180), m.glow, 'edgeGlow');
    this.glowRing.position.z = 3.8;
    this.glowRing.renderOrder = 3;
    this.glowRing.visible = false;
    /** @type {number | null} seconds since the last tap ripple, null when idle */
    this.rippleT = null;

    // side keys on the 3 o'clock side: Home above center, Back below
    /** @type {{ home: THREE.Mesh, back: THREE.Mesh }} */
    this.buttons = { home: this.#button(1), back: this.#button(-1) };

    // microphone between the keys, speaker slot on the 9 o'clock side
    const mic = add(new THREE.CircleGeometry(0.32, 20), m.port, 'mic');
    mic.position.set(DIM.caseR + 0.1, 0, DIM.buttonZ);
    mic.rotation.y = Math.PI / 2;
    const speaker = add(new RoundedBoxGeometry(0.1, 4.6, 0.9, 2, 0.04), m.port, 'speaker');
    speaker.position.set(-DIM.caseR - 0.06, 0, DIM.buttonZ);

    this.#sensorModule();

    const strap = add(
      sweptBandGeometry(strapCurve(), { thicknessAt: strapThickness }),
      m.strap,
      'strap',
    );
    strap.renderOrder = 0;

    /** Callout anchors (spec §10.6), watch-local mm. @type {Record<string, Anchor>} */
    this.anchors = {
      homeKey: this.#keyAnchor(1),
      backKey: this.#keyAnchor(-1),
      display: { position: new THREE.Vector3(-9.5, 10.5, DIM.glassTop), normal: new THREE.Vector3(0, 0, 1) },
      // inside the case, below the clock digits so its marker doesn't sit on the time
      imu: { position: new THREE.Vector3(-6, -11, 0), normal: null },
      sensor: { position: new THREE.Vector3(0, 0, DIM.domeBottom), normal: new THREE.Vector3(0, 0, -1) },
    };
  }

  /** @param {FinishId} finish */
  setFinish(finish) {
    this.finish = finish;
    applyFinish(this.materials, finish);
  }

  /** @param {number} level 0 (off) to 1 (normal) */
  setDisplayLevel(level) {
    setDisplayLevel(this.materials, level);
  }

  /** Red edge glow, 0 (off) to 1 (peak). @param {number} level */
  setGlow(level) {
    setGlowLevel(this.materials, level);
    this.glowRing.visible = level > 0.001;
  }

  /** Start a ripple across the glass (Double Tap). */
  ripple() {
    this.rippleT = 0;
  }

  get rippleActive() {
    return this.rippleT !== null;
  }

  /** @param {number} dt seconds */
  updateRipple(dt) {
    if (this.rippleT === null) return;
    this.rippleT += dt;
    const { time, amp } = this.materials.ripple;
    time.value = this.rippleT;
    amp.value = Math.max(0, 1 - this.rippleT / RIPPLE_S);
    if (this.rippleT >= RIPPLE_S) {
      this.rippleT = null;
      amp.value = 0;
    }
  }

  /** @param {THREE.Texture} texture */
  setScreenTexture(texture) {
    this.materials.display.map = texture;
    this.materials.display.needsUpdate = true;
  }

  /** @param {1 | -1} which +1 Home (toward 12), -1 Back (toward 6) */
  #button(which) {
    const a = DIM.buttonAngle * which;
    const mesh = new THREE.Mesh(buttonGeometry(), this.materials.button);
    mesh.name = which > 0 ? 'homeKey' : 'backKey';
    const r = DIM.caseR + 0.25;
    mesh.position.set(r * Math.cos(a), r * Math.sin(a), DIM.buttonZ);
    mesh.rotation.z = a;
    this.group.add(mesh);
    return mesh;
  }

  /** @param {1 | -1} which */
  #keyAnchor(which) {
    const a = DIM.buttonAngle * which;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    return { position: dir.clone().multiplyScalar(DIM.caseR + 1.15).setZ(DIM.buttonZ), normal: dir };
  }

  /** Underside: glossy dome, a ring of photodiode windows, LED cluster, electrode ring. */
  #sensorModule() {
    const m = this.materials;
    const dome = new THREE.Mesh(domeGeometry(), m.sensorGlass);
    dome.name = 'sensorDome';
    this.group.add(dome);

    const ring = new THREE.Mesh(domeRingGeometry(12.6, 13.3), m.electrode);
    ring.name = 'electrodeRing';
    this.group.add(ring);

    const placeOnDome = (mesh, r, a) => {
      const n = domeNormal(r, a);
      mesh.position.set(r * Math.cos(a), r * Math.sin(a), domeZ(r)).addScaledVector(n, 0.03);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.group.add(mesh);
    };

    const windowGeo = new THREE.CircleGeometry(0.8, 28);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      placeOnDome(new THREE.Mesh(windowGeo, m.sensorWindow), 8.6, a);
    }

    const ledGeo = new THREE.PlaneGeometry(1.15, 1.15);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const led = new THREE.Mesh(ledGeo, m.sensorWindow);
      placeOnDome(led, 1.7, a);
      led.rotateZ(a);
    }
  }
}
