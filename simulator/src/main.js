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
import { readPref, writePref } from './core/prefs.js';
import { BootSequence } from './ui/components/BootSequence.js';
import { createToaster } from './ui/components/Toast.js';
import { GestureDeck } from './ui/components/GestureDeck.js';
import { Hud } from './ui/Hud.js';
import { UiSounds } from './ui/uiSounds.js';
import { SceneRoot } from './scene/SceneRoot.js';
import { WatchModel } from './scene/watch/WatchModel.js';
import { DEFAULT_FINISH, FINISHES } from './scene/watch/materials.js';
import { DIM } from './scene/watch/geometry.js';
import { Annotations } from './scene/Annotations.js';
import { WatchScreen } from './screen/WatchScreen.js';
import { TacturaStarterApp } from './screen/apps/TacturaStarterApp.js';
import { CameraKeys } from './input/CameraKeys.js';
import { KeyboardInput } from './input/KeyboardInput.js';
import { ComposeKeys } from './input/ComposeKeys.js';
import { GESTURES } from './config/gestures.js';
import { DEFAULT_FILTER_CRUDE, DEFAULT_LEXICON_SIZE } from './config/lexicon.js';
import gestureBins from './config/gesture_bins.json';
import lexiconExclude from '../tools/lexicon_exclude.txt?raw';
import { Pipeline, stagesWith } from './pipeline/Pipeline.js';
import { Composer, emptyCompose } from './pipeline/Composer.js';
import { describeError } from './pipeline/registry.js';

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
/** The display wakes partway into the scene intro; the screen boots with it. */
const SCREEN_WAKE_MS = 420;

/** What each stand-in is, for the badge tooltips. Honest about what it is not. */
const STAND_IN_NOTES = {
  classifier:
    'Passthrough: keyboard and tile input is already labeled, so it reports that gesture with confidence 1.0. It recognizes nothing. Raghav’s random forest plugs in here (pipeline/classifier/RandomForestClassifier.js).',
  decoder:
    'Placeholder dictionary lookup: exact gesture-sequence match, ranked by word frequency. No language model, no context. Russell’s decoder plugs into the Decoder interface (pipeline/decoder/Decoder.js).',
};
const BADGE_LABELS = { classifier: 'CLS', decoder: 'DEC' };

/** @returns {import('./ui/Hud.js').HudState} */
function initialState() {
  /** @type {(label: string, value: string, reason: string) => import('./ui/components/StageBadge.js').BadgeState} */
  const pending = (label, value, reason) => ({ label, value, tone: 'pending', reason });
  return {
    ui: { leftRail: true, rightRail: true },
    input: { source: 'none' },
    badges: {
      classifier: pending('CLS', 'LOADING', 'Classifier stage loading.'),
      bins: pending('BINS', 'LOADING', 'Gesture-to-phoneme bin config loading.'),
      lexicon: pending('LEX', 'LOADING', 'Lexicon loading.'),
      decoder: pending('DEC', 'LOADING', 'Decoder stage loading.'),
      voice: pending('VOICE', 'OFFLINE', 'Voice engine not built yet (Phase 4). Committed words are not spoken.'),
    },
    perf: { fps: 0, dpr: 1, gl: 'PENDING' },
    watch: {
      finish: readPref('finish', DEFAULT_FINISH, (v) => typeof v === 'string' && v in FINISHES),
      mannequin: readPref('mannequin', true, (v) => typeof v === 'boolean'), // spec §10.4: default ON
    },
    camera: { yaw: 0, pitch: 0, distance: 0 },
    compose: emptyCompose(),
    screen: { app: 'NONE' },
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

async function loadLexiconData() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/lexicon_base.json`);
  if (!response.ok) throw new Error(`lexicon_base.json: HTTP ${response.status}`);
  return response.json();
}

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

async function boot() {
  const bus = createEventBus();
  const store = createStore(initialState());
  const clock = createClock();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const breakName = new URLSearchParams(window.location.search).get('break');
  const skipped = () => ({ value: 'SKIPPED', tone: /** @type {const} */ ('muted') });

  /** @param {string} id @param {import('./ui/components/StageBadge.js').BadgeState} badge */
  const setBadge = (id, badge) => store.update((s) => ({ ...s, badges: { ...s.badges, [id]: badge } }));

  const bootScreen = new BootSequence(el('boot'), { version: VERSION, reducedMotion });
  bootScreen.start();

  await bootScreen.step('FONTS', async () => ((await loadFonts()) ? 'OK' : { value: 'FALLBACK', tone: 'muted' }));

  /** @type {SceneRoot | null} */
  let scene = null;
  const glOk = await bootScreen.step('GL', () => {
    scene = new SceneRoot(el('viewport'), { reducedMotion });
    scene.initLighting();
    return scene.glLabel;
  });
  store.set({ perf: { ...store.get().perf, gl: glOk ? 'WEBGL2' : 'ERROR', dpr: scene?.pixelRatio ?? 1 } });

  const screen = new WatchScreen({ bus, store });
  const starterApp = new TacturaStarterApp();
  screen.setApp(starterApp);
  store.set({ screen: { app: starterApp.name } });

  /** @type {WatchModel | null} */
  let watch = null;
  /** @type {Annotations | null} */
  let annotations = null;
  await bootScreen.step('WATCH', () => {
    if (!scene) return skipped();
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
  await bootScreen.step(
    'HUD',
    () => {
      hud = new Hud({ root: el('hud'), store, bus, version: VERSION, finishes: FINISHES, deck });
      const toaster = createToaster(hud.toastRoot);
      bus.on('toast', ({ message, ...options }) => toaster.show(message, options));
      scene?.setFocusElement(hud.stageEl);
      annotations?.setBounds(hud.stageEl);
    },
    { quiet: true },
  );

  await bootScreen.step('INPUT', () => {
    store.set({ input: { source: keyboard.id } });
    return 'KEYBOARD';
  });

  // ---- pipeline (spec §8) ----
  const pipeline = new Pipeline({
    stages: stagesWith(breakName),
    notify: (message, err) => bus.emit('toast', { message, tone: 'error', detail: describeError(err), ms: 6000 }),
    onStatus: (stage, status, impl) => {
      const label = /** @type {Record<string, string>} */ (BADGE_LABELS)[stage];
      const note = /** @type {Record<string, string>} */ (STAND_IN_NOTES)[stage];
      if (status.mode === 'project') setBadge(stage, { label, value: 'PROJECT', tone: 'project', reason: `Project implementation running: ${impl?.name ?? stage}.` });
      else if (status.mode === 'stand-in') setBadge(stage, { label, value: 'STAND-IN', tone: 'stand-in', reason: note });
      else setBadge(stage, { label, value: 'ERROR', tone: 'error', reason: `${status.reason} ${note}` });
    },
  });
  /** @param {import('./pipeline/types.js').StageStatus} status */
  const stageLine = (status) =>
    status.mode === 'project'
      ? 'PROJECT'
      : status.mode === 'stand-in'
        ? { value: 'STAND-IN', tone: /** @type {const} */ ('muted') }
        : { value: 'ERROR', tone: /** @type {const} */ ('error') };

  await bootScreen.step('CLASSIFIER', async () => stageLine((await pipeline.loadStage('classifier')).status));

  const binsOk = await bootScreen.step('BINS', () => {
    try {
      const mapper = pipeline.loadBins(gestureBins);
      setBadge('bins', {
        label: 'BINS',
        value: 'LOADED',
        tone: 'project',
        reason: `gesture_bins.json v${gestureBins.version}: ${mapper.byGesture.size} gestures, ${mapper.phonemeCount} phonemes. The team’s real assignment, not a stand-in.`,
      });
      return 'LOADED';
    } catch (err) {
      setBadge('bins', { label: 'BINS', value: 'ERROR', tone: 'error', reason: describeError(err) });
      throw err;
    }
  });

  await bootScreen.step('LEXICON', async () => {
    if (!binsOk) {
      setBadge('lexicon', { label: 'LEX', value: '—', tone: 'error', reason: 'No lexicon: the gesture bins failed to load.' });
      return skipped();
    }
    try {
      const lexicon = pipeline.loadLexicon(await loadLexiconData(), {
        excludeText: lexiconExclude,
        size: DEFAULT_LEXICON_SIZE,
        filterCrude: DEFAULT_FILTER_CRUDE,
      });
      const s = lexicon.stats;
      setBadge('lexicon', {
        label: 'LEX',
        value: String(s.words),
        tone: 'stand-in',
        reason: `${s.source}, top ${s.size / 1000}k words, filtered by the current bins: ${s.words} spellable words, ${s.sequences} gesture sequences, ${s.collisions} shared by more than one word.${s.filterCrude ? ' Crude words hidden.' : ''}`,
      });
      return `${s.words} WORDS`;
    } catch (err) {
      setBadge('lexicon', { label: 'LEX', value: 'ERROR', tone: 'error', reason: describeError(err) });
      throw err;
    }
  });

  await bootScreen.step('DECODER', async () => stageLine((await pipeline.loadStage('decoder')).status));

  const composer = new Composer({ pipeline, store, bus, sinceStart: (t) => clock.sinceStart(t) });

  // A fired gesture: the arm and tile show the physical input right away; the
  // pipeline then classifies, maps and decodes it (trace, screen, transcript).
  bus.on('input', (/** @type {import('./pipeline/types.js').RawInput} */ raw) => {
    if (raw.label) {
      scene?.playGesture(raw.label);
      deck.flash(raw.label);
    }
    sounds.tick();
    composer.push(raw);
  });
  bus.on('compose:commit', () => sounds.commit());
  bus.on('compose:noword', () => sounds.buzz());

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
    screen.update(dt);
    if (scene) {
      scene.update(dt);
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
  window.setTimeout(() => screen.wake(), reducedMotion ? 0 : SCREEN_WAKE_MS);
  if (annotations) el('annotations').classList.add('is-live');

  if (scene) {
    const rig = scene.rig;
    new CameraKeys({ onAxes: (yaw, pitch) => rig.setInput(yaw, pitch), onReset: () => rig.reset() }).start();
  }
  keyboard.start((raw) => bus.emit('input', raw));
  new ComposeKeys(composer).start();

  for (const { label, error } of bootScreen.errors) {
    bus.emit('toast', { message: `${label} failed at boot`, tone: 'error', detail: error.message, ms: 6000 });
  }
  if (breakName) bus.emit('toast', { message: `Test switch ?break=${breakName} is on`, detail: 'Remove it from the URL to run normally.', ms: 6000 });

  if (import.meta.env.DEV) {
    // Handy in the devtools console while building later phases.
    Object.assign(window, { __tactura: { bus, store, clock, scene, watch, screen, sounds, pipeline, composer } });
  }
}

boot();
