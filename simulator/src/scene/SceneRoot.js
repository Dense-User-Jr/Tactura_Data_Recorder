import * as THREE from 'three';

/** Spec §7.4: cap device pixel ratio at 2 to hold 60 fps on integrated GPUs. */
const MAX_DPR = 2;

/**
 * Owns the WebGL renderer, scene and camera for the full-bleed viewport.
 * The canvas clears to transparent so the CSS dot grid shows through (§10.2).
 *
 * Phase 0: empty scene. The watch, lighting and camera rig arrive in Phase 1.
 * Throws if WebGL is unavailable; the caller shows that and keeps the HUD running.
 */
export class SceneRoot {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    this.camera.position.set(0, 0, 4);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Short GL label for the HUD readout. three.js r163+ only runs on WebGL2. */
  get glLabel() {
    return 'WEBGL2';
  }

  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** @param {number} _dt seconds */
  update(_dt) {}

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
