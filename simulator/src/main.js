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

async function boot() {
  const bus = createEventBus();
  const store = createStore(initialState());
  const clock = createClock();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const bootScreen = new BootSequence(/** @type {HTMLElement} */ (document.getElementById('boot')), {
    version: VERSION,
    reducedMotion,
  });
  bootScreen.start();

  await bootScreen.step('FONTS', async () => ((await loadFonts()) ? 'OK' : { value: 'FALLBACK', tone: 'muted' }));

  /** @type {SceneRoot | null} */
  let scene = null;
  const glOk = await bootScreen.step('GL', () => {
    scene = new SceneRoot(/** @type {HTMLElement} */ (document.getElementById('viewport')));
    return scene.glLabel;
  });
  store.set({ perf: { ...store.get().perf, gl: glOk ? scene.glLabel : 'ERROR', dpr: scene?.pixelRatio ?? 1 } });

  /** @type {Hud | null} */
  let hud = null;
  await bootScreen.step('HUD', () => {
    hud = new Hud({ root: /** @type {HTMLElement} */ (document.getElementById('hud')), store, bus, version: VERSION });
    const toaster = createToaster(hud.toastRoot);
    bus.on('toast', ({ message, ...options }) => toaster.show(message, options));
    return 'OK';
  });

  await bootScreen.step('PIPELINE', () => ({ value: 'NOT WIRED', tone: 'muted' }));

  let frames = 0;
  let windowStart = performance.now();
  clock.onTick((dt, now) => {
    if (scene) {
      scene.update(dt);
      scene.render();
    }
    frames++;
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

  for (const { label, error } of bootScreen.errors) {
    bus.emit('toast', { message: `${label} failed at boot`, tone: 'error', detail: error.message, ms: 6000 });
  }

  if (import.meta.env.DEV) {
    // Handy in the devtools console while building later phases.
    Object.assign(window, { __tactura: { bus, store, clock, scene } });
  }
}

boot();
