import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ARM_HERO, CameraRig, HERO, easeInOutCubic, easeOutCubic } from './CameraRig.js';
import { SoftBloomPass } from './SoftBloomPass.js';
import { createLighting } from './lighting.js';
import { WristMannequin } from './WristMannequin.js';
import { GestureAnimator } from './GestureAnimator.js';
import { DIM } from './watch/geometry.js';

/** Spec §7.4: cap device pixel ratio at 2 to hold 60 fps on integrated GPUs. */
const MAX_DPR = 2;

/** World units per millimeter. The watch is modeled in mm; 1 unit = 100 mm keeps clipping planes sane. */
export const MM = 0.01;

const INTRO_MS = 1500;
/** Subtle: only HDR-bright pixels (display whites, specular glints, later the fire glow) bloom. */
const BLOOM = { strength: 0.09, radius: 0.2, threshold: 1.4 };
/** Camera moves smaller than this (matrix elements) don't trigger a redraw. */
const VIEW_EPSILON = 1e-6;
/**
 * MSAA only below this pixel ratio. On an Intel Arc iGPU at DPR 2, 4× MSAA on
 * the HDR target cut the frame rate from 200 to 55 fps, while 1:1 crops of the
 * case edge looked the same: at that density the pixels already hide aliasing.
 */
const MSAA_MAX_DPR = 1.75;
const MSAA_SAMPLES = 4;
/**
 * watchRig rotation about X with the arm shown: face up, 12 o'clock pointing
 * away from the viewer, the forearm level along world X. Like the recordings'
 * rest pose, so a flick up rises on screen and a tap dips down.
 */
const ARM_PRESENTATION = -Math.PI / 2;
/** Contact shadow per presentation (world units). Arm: on the floor under the elbow end of the forearm. */
const SHADOW = {
  product: { x: 0, y: DIM.floorY * MM, z: -0.17, scaleX: 1, scaleZ: 1 },
  arm: { x: 0.3, y: -0.54, z: 0, scaleX: 2.6, scaleZ: 1.5 },
};
const HERO_SWITCH_MS = 800;
const deg = THREE.MathUtils.degToRad;

/**
 * Owns the renderer, post-processing, scene graph, camera rig and lighting
 * for the full-bleed viewport. The canvas clears to transparent so the CSS
 * dot grid shows through (§10.2).
 *
 *   scene
 *   ├─ stage (scale MM, everything below is in millimeters)
 *   │  └─ watchRig                  watch-local axes: +X 3 o'clock, +Y 12 o'clock, +Z out of the screen
 *   │     └─ forearm                (WristMannequin) rolls/tips on the arm's axis; GestureAnimator drives it
 *   │        ├─ watchMount
 *   │        │  └─ watch.group
 *   │        └─ wrist               the hand's pivot
 *   ├─ lightRig, ambient, contact shadow
 *
 * Presentation (world Y up):
 *   - arm hidden: the watch stands upright facing +Z, 12 o'clock up, like a product shot.
 *   - arm shown: watchRig turns −90° about X so the watch lies face up on a level
 *     forearm, as in the recordings; the camera is the wearer's eye.
 * Gesture animation happens inside watchRig, so it is the same in both.
 *
 * Renders on demand: a frame is drawn only when the camera moved, an intro or
 * animation is running, or something called `invalidate()`. An idle sim costs
 * no GPU time.
 *
 * Throws if WebGL is unavailable; the caller shows that and keeps the HUD running.
 */
export class SceneRoot {
  /**
   * @param {HTMLElement} container
   * @param {{ reducedMotion: boolean }} options
   */
  constructor(container, { reducedMotion }) {
    this.container = container;
    this.reducedMotion = reducedMotion;

    // MSAA happens on the composer's render target, so the default framebuffer needs none
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);

    this.stage = new THREE.Group();
    this.stage.name = 'stage';
    this.stage.scale.setScalar(MM);
    this.scene.add(this.stage);
    this.watchRig = new THREE.Group();
    this.watchRig.name = 'watchRig';
    this.stage.add(this.watchRig);
    this.arm = new WristMannequin();
    this.watchRig.add(this.arm.forearm);
    this.animator = new GestureAnimator(this.arm);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: MSAA_SAMPLES });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new SoftBloomPass(BLOOM));
    this.composer.addPass(new OutputPass()); // ACES tone mapping + sRGB happen here

    this.rig = new CameraRig(this.camera, renderer.domElement, { reducedMotion });

    /** @type {ReturnType<typeof createLighting> | null} */
    this.lighting = null;
    /** @type {import('./watch/WatchModel.js').WatchModel | null} */
    this.watch = null;
    /** @type {HTMLElement | null} */
    this.focusEl = null;
    /** @type {number | null} ms into the boot intro, null when not playing */
    this.introElapsed = null;
    /** True once the boot intro has started; before that, view changes jump instead of animating. */
    this.live = false;
    /** @type {{ from: number, to: number, elapsed: number } | null} watchRig tilt between presentations */
    this.presentTween = null;

    this.dirty = true;
    this.lastView = new THREE.Matrix4();
    this.lastProjection = new THREE.Matrix4();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.#watchPixelRatio();
  }

  /** Dragging the window to a screen with a different density changes DPR without resizing. */
  #watchPixelRatio() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        this.resize();
        this.#watchPixelRatio();
      },
      { once: true },
    );
  }

  /** Short GL label for the HUD readout. three.js r163+ only runs on WebGL2. */
  get glLabel() {
    return 'WEBGL2';
  }

  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  /** Request a redraw on the next frame (texture changed, finish changed, ...). */
  invalidate() {
    this.dirty = true;
  }

  /** Environment, lights and contact shadow. Starts dark until `intro()`. */
  initLighting() {
    this.lighting = createLighting(this.scene, this.renderer, { floorY: DIM.floorY * MM });
    this.lighting.setLevel(0);
  }

  /** @param {import('./watch/WatchModel.js').WatchModel} watch */
  addWatch(watch) {
    this.watch = watch;
    watch.setDisplayLevel(0);
    this.arm.watchMount.add(watch.group);
    this.animator.setWatch(watch);
    this.invalidate();
  }

  /** Animate a gesture on the arm and watch. @param {import('../pipeline/types.js').GestureId} id */
  playGesture(id) {
    this.animator.play(id);
    this.invalidate();
  }

  /**
   * Show or hide the forearm and hand, switching presentation: the watch tips
   * between upright (product) and face up on the arm, and the camera moves to
   * the matching hero. Animated once the sim is live.
   * @param {boolean} visible
   */
  setMannequinVisible(visible) {
    this.arm.setVisible(visible);
    const animate = this.live && !this.reducedMotion;
    this.rig.setHero(visible ? ARM_HERO : HERO, animate ? HERO_SWITCH_MS : 0);
    const to = visible ? ARM_PRESENTATION : 0;
    if (animate) this.presentTween = { from: this.watchRig.rotation.x, to, elapsed: 0 };
    else this.#present(to);
    this.invalidate();
  }

  /** @param {number} angle watchRig rotation about X, 0 (product) to ARM_PRESENTATION (arm) */
  #present(angle) {
    this.watchRig.rotation.x = angle;
    const k = angle / ARM_PRESENTATION;
    const lerp = (a, b) => a + (b - a) * k;
    const { product: p, arm: a } = SHADOW;
    this.lighting?.setShadow({
      x: lerp(p.x, a.x),
      y: lerp(p.y, a.y),
      z: lerp(p.z, a.z),
      scaleX: lerp(p.scaleX, a.scaleX),
      scaleZ: lerp(p.scaleZ, a.scaleZ),
    });
  }

  /**
   * Keeps the watch centered in this element (the HUD's viewport cell) rather
   * than the window, including while rails collapse and expand.
   * @param {HTMLElement} el
   */
  setFocusElement(el) {
    this.focusEl = el;
    new ResizeObserver(() => this.#applyViewOffset()).observe(el);
    this.#applyViewOffset();
  }

  /** Boot fade-in: studio light comes up from black, the display wakes, the camera settles on the hero angle. */
  intro() {
    this.live = true;
    this.container.classList.add('is-live');
    this.invalidate();
    if (this.reducedMotion) {
      this.lighting?.setLevel(1);
      this.watch?.setDisplayLevel(1);
      return;
    }
    this.introElapsed = 0;
    const hero = this.rig.hero;
    this.rig.animateTo(hero, INTRO_MS, {
      from: { ...hero, yaw: hero.yaw - deg(16), pitch: hero.pitch + deg(5), distance: hero.distance * 1.25 },
      ease: easeOutCubic,
    });
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    const samples = dpr < MSAA_MAX_DPR ? MSAA_SAMPLES : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === samples) continue;
      rt.samples = samples;
      rt.dispose(); // reallocated with the new sample count on next use
    }
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.#applyViewOffset();
    this.invalidate(); // resizing the canvas clears it
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (this.introElapsed !== null) {
      this.introElapsed += dt * 1000;
      const p = Math.min(this.introElapsed / INTRO_MS, 1);
      this.lighting?.setLevel(easeOutCubic(p));
      this.watch?.setDisplayLevel(THREE.MathUtils.smoothstep(p, 0.3, 0.7));
      this.invalidate();
      if (p >= 1) this.introElapsed = null;
    }
    if (this.presentTween) {
      const tw = this.presentTween;
      tw.elapsed += dt * 1000;
      const k = easeInOutCubic(Math.min(tw.elapsed / HERO_SWITCH_MS, 1));
      this.#present(tw.from + (tw.to - tw.from) * k);
      if (tw.elapsed >= HERO_SWITCH_MS) this.presentTween = null;
      this.invalidate();
    }
    if (this.animator.update(dt)) this.invalidate();
    this.rig.update(dt);
    this.lighting?.update(this.camera);
  }

  /**
   * Draws a frame if anything changed since the last one.
   * @returns {boolean} whether a frame was drawn
   */
  render() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const moved =
      !nearlyEqual(cam.matrixWorld, this.lastView) || !nearlyEqual(cam.projectionMatrix, this.lastProjection);
    if (!this.dirty && !moved) return false;

    this.composer.render();
    this.lastView.copy(cam.matrixWorld);
    this.lastProjection.copy(cam.projectionMatrix);
    this.dirty = false;
    return true;
  }

  #applyViewOffset() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (!this.focusEl) {
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      return;
    }
    const focus = this.focusEl.getBoundingClientRect();
    const frame = this.container.getBoundingClientRect();
    const dx = focus.left + focus.width / 2 - (frame.left + width / 2);
    const dy = focus.top + focus.height / 2 - (frame.top + height / 2);
    // a sub-window that starts up-left of the full frame shifts the image down-right
    this.camera.setViewOffset(width, height, -dx, -dy, width, height);
  }
}

/** @param {THREE.Matrix4} a @param {THREE.Matrix4} b */
function nearlyEqual(a, b) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.elements[i] - b.elements[i]) > VIEW_EPSILON) return false;
  }
  return true;
}
