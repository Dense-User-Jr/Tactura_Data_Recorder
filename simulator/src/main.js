// Fonts are self-hosted (latin subsets only) so the sim works offline after install.
import '@fontsource/doto/latin-400.css';
import '@fontsource/doto/latin-700.css';
import '@fontsource/doto/latin-900.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';

import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/hud.css';

import { createEventBus } from './core/eventBus.js';
import { createStore } from './core/store.js';
import { createClock, formatT } from './core/clock.js';
import { BootSequence } from './ui/components/BootSequence.js';
import { createToaster } from './ui/components/Toast.js';
import { Hud } from './ui/Hud.js';
import { SceneRoot } from './scene/SceneRoot.js';
import { WatchModel } from './scene/watch/WatchModel.js';
import { DEFAULT_FINISH, FINISHES } from './scene/watch/materials.js';
import { DIM } from './scene/watch/geometry.js';
import { Annotations } from './scene/Annotations.js';
import { WatchScreen } from './screen/WatchScreen.js';
import { CameraKeys } from './input/CameraKeys.js';
import { KeyboardInput } from './input/KeyboardInput.js';
import { GestureDeck } from './ui/components/GestureDeck.js';
import { UiSounds } from './ui/uiSounds.js';
import { GESTURES } from './config/gestures.js';
import gestureBins from './config/gesture_bins.json';
import { readPref, writePref } from './core/prefs.js';

/* global __APP_VERSION__ */
/** `0.1.0` → `0.1`, as shown in the top bar. */
const VERSION = __APP_VERSION__.split('.').slice(0, 2).join('.');

const FONT_FACES = [
  '400 16px "Doto"',
  '700 16px "Doto"',
  '900 16px "Doto"',
  '400 12px "Space Mono"',
  '700 12px "Space Mono"',
  '400 14px "Space Grotesk"',
  '500 14px "Space Grotesk"',
];
const FONT_TIMEOUT_MS = 2000;
const FPS_SAMPLE_MS = 500;

/** @returns {import('./ui/Hud.js').HudState} */
function initialState() {
  /** @type {(label: string, reason: string) => import('./ui/components/StageBadge.js').BadgeState} */
  const offline = (label, reason) => ({ label, value: 'OFFLINE', tone: 'pending', reason });
  return {
    ui: { leftRail: true, rightRail: true },
    input: { source: 'none' },
    // Honest placeholders until the pipeline (Phase 3) and voice (Phase 4) exist.
    badges: {
      classifier: offline('CLS', 'Classifier stage not built yet. The passthrough stand-in arrives with the pipeline in Phase 3.'),
      bins: offline('BINS', 'Gesture-to-phoneme bin config not loaded yet (Phase 3).'),
      lexicon: offline('LEX', 'Lexicon not loaded yet (Phase 3).'),
      decoder: offline('DEC', 'Decoder stage not built yet. The lexicon-lookup placeholder arrives in Phase 3.'),
      voice: offline('VOICE', 'Voice engine not built yet (Phase 4).'),
    },
    perf: { fps: 0, dpr: 1, gl: 'PENDING' },
    watch: {
      finish: readPref('finish', DEFAULT_FINISH, (v) => typeof v === 'string' && v in FINISHES),
      mannequin: readPref('mannequin', true, (v) => typeof v === 'boolean'), // spec §10.4: default ON
    },
    camera: { yaw: 0, pitch: 0, distance: 0 },
  };
}

/** Resolves true when every face loaded, false on timeout or a missing face. Never rejects. */
async function loadFonts() {
  const loaded = Promise.all(FONT_FACES.map((face) => document.fonts.load(face))).then(
    () => FONT_FACES.every((face) => document.fonts.check(face)),
    () => false,
  );
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), FONT_TIMEOUT_MS));
  return Promise.race([loaded, timeout]);
}

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

async function boot() {
  const bus = createEventBus();
  const store = createStore(initialState());
  const clock = createClock();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const skipped = () => ({ value: 'SKIPPED', tone: /** @type {const} */ ('muted') });

  const bootScreen = new BootSequence(el('boot'), { version: VERSION, reducedMotion });
  bootScreen.start();

  await bootScreen.step('FONTS', async () => ((await loadFonts()) ? 'OK' : { value: 'FALLBACK', tone: 'muted' }));

  /** @type {SceneRoot | null} */
  let scene = null;
  const glOk = await bootScreen.step('GL', () => {
    scene = new SceneRoot(el('viewport'), { reducedMotion });
    return scene.glLabel;
  });
  store.set({ perf: { ...store.get().perf, gl: glOk ? 'WEBGL2' : 'ERROR', dpr: scene?.pixelRatio ?? 1 } });

  await bootScreen.step('ENV', () => {
    if (!scene) return skipped();
    scene.initLighting();
    return 'ROOM';
  });

  /** @type {WatchModel | null} */
  let watch = null;
  /** @type {WatchScreen | null} */
  let screen = null;
  /** @type {Annotations | null} */
  let annotations = null;
  await bootScreen.step('WATCH', () => {
    if (!scene) return skipped();
    screen = new WatchScreen({ bus });
    watch = new WatchModel({ finish: store.get().watch.finish, screenTexture: screen.texture });
    scene.addWatch(watch);
    annotations = new Annotations(el('annotations'), {
      camera: scene.camera,
      target: watch.group,
      radiusMm: DIM.caseR,
      callouts: [
        { num: '01', text: 'HOME KEY', anchor: watch.anchors.homeKey, prefer: [1, -0.4] },
        { num: '02', text: 'BACK KEY', anchor: watch.anchors.backKey, prefer: [1, 0.4] },
        { num: '03', text: 'DISPLAY 480×480', anchor: watch.anchors.display, prefer: [-0.7, -0.7] },
        { num: '04', text: 'IMU (ACCEL + GYRO)', anchor: watch.anchors.imu, prefer: [-0.74, 0.67] },
        { num: '05', text: 'SENSOR ARRAY', anchor: watch.anchors.sensor, prefer: [0.74, 0.67] },
      ],
    });
    return 'GW7 44MM';
  });

  const keyboard = new KeyboardInput();
  const sounds = new UiSounds();
  /** @type {Record<string, string[]>} */
  const phonemes = Object.fromEntries(gestureBins.bins.map((b) => [b.gesture, b.phonemes]));
  const deck = new GestureDeck({ gestures: GESTURES, phonemes, onPress: (id) => keyboard.press(id) });

  /** @type {Hud | null} */
  let hud = null;
  await bootScreen.step('HUD', () => {
    hud = new Hud({ root: el('hud'), store, bus, version: VERSION, finishes: FINISHES, deck });
    const toaster = createToaster(hud.toastRoot);
    bus.on('toast', ({ message, ...options }) => toaster.show(message, options));
    scene?.setFocusElement(hud.stageEl);
    annotations?.setBounds(hud.stageEl);
    return 'OK';
  });

  // Phase 2: a fired gesture animates, flashes its tile and ticks. Phase 3 puts the
  // pipeline (classifier → bins → decoder) between the input and the trace/screen.
  bus.on('input', (/** @type {import('./pipeline/types.js').RawInput} */ raw) => {
    if (!raw.label) return;
    scene?.playGesture(raw.label);
    deck.flash(raw.label);
    sounds.tick();
  });

  await bootScreen.step('INPUT', () => {
    store.set({ input: { source: keyboard.id } });
    return 'KEYBOARD';
  });

  await bootScreen.step('PIPELINE', () => ({ value: 'NOT WIRED', tone: 'muted' }));

  store.watch((s) => s.watch.finish, (finish) => {
    watch?.setFinish(/** @type {any} */ (finish));
    scene?.invalidate();
    writePref('finish', finish);
  });
  store.watch((s) => s.watch.mannequin, (on) => {
    scene?.setMannequinVisible(on);
    writePref('mannequin', on);
  });
  bus.on('screen:frame', () => scene?.invalidate());

  // `frames` counts frames actually drawn; the scene skips drawing while nothing changes
  let frames = 0;
  let windowStart = performance.now();
  let lastCamera = '';
  clock.onTick((dt, now) => {
    if (scene) {
      scene.update(dt);
      screen?.update();
      if (scene.render()) {
        frames++;
        annotations?.update();
      }

      const pose = scene.rig.pose;
      const camera = {
        yaw: Math.round((pose.yaw * 180) / Math.PI),
        pitch: Math.round((pose.pitch * 180) / Math.PI),
        distance: Math.round(pose.distance * 100) / 100,
      };
      const key = `${camera.yaw}|${camera.pitch}|${camera.distance}`;
      if (key !== lastCamera) {
        lastCamera = key;
        store.set({ camera });
      }
    }
    if (now - windowStart >= FPS_SAMPLE_MS) {
      const fps = Math.round((frames * 1000) / (now - windowStart));
      store.set({ perf: { ...store.get().perf, fps, dpr: scene?.pixelRatio ?? 1 } });
      frames = 0;
      windowStart = now;
    }
  });
  clock.start();

  await bootScreen.step('SYS.READY', () => ({ value: formatT(clock.sinceStart()), tone: 'muted' }));
  await bootScreen.finish();
  hud?.reveal();
  scene?.intro();
  if (annotations) el('annotations').classList.add('is-live');

  if (scene) {
    const rig = scene.rig;
    new CameraKeys({ onAxes: (yaw, pitch) => rig.setInput(yaw, pitch), onReset: () => rig.reset() }).start();
  }
  keyboard.start((raw) => bus.emit('input', raw));

  for (const { label, error } of bootScreen.errors) {
    bus.emit('toast', { message: `${label} failed at boot`, tone: 'error', detail: error.message, ms: 6000 });
  }

  if (import.meta.env.DEV) {
    // Handy in the devtools console while building later phases.
    Object.assign(window, { __tactura: { bus, store, clock, scene, watch, screen, sounds } });
  }
}

boot();
