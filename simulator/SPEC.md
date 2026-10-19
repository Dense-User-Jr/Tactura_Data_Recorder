# Tactura Watch Simulator: Build Spec (v1)

> Owner: Russell Mehta. Written 2026-10-05 for a Claude Code session to implement.
> Branch: `interactive-watch` in the `Tactura_Data_Recorder` repo.
> Everything in this spec lives inside `simulator/`. Nothing outside that folder gets touched.

---

## 0. TL;DR

Build a **3D web simulator of a Samsung Galaxy Watch 7** that lets the Tactura team test the *feel and flow* of the gesture-to-speech pipeline when nobody has the club's one physical watch.

v1 input is the keyboard: keys **1 to 6 fire the six gestures**, **Space commits a word**, **Backspace undoes**. Each gesture animates a realistic 3D watch, flows through a pluggable pipeline (classifier → phoneme bin → word lookup), shows up on a simulated round watch screen, and the committed word is **spoken aloud with a high-quality voice**.

It must look exceptional: a dark, high-contrast, **Nothing-inspired, early-2000s-Sony-futurism** interface with sharp geometric controls. It must launch with a **double-click** on Windows and macOS.

Think of it as the Meta XR Simulator, but for one watch and six gestures.

---

## 1. Context you need

### 1.1 What Tactura is

Tactura is a wearable gesture-to-speech system. A person performs wrist gestures while wearing a smartwatch. Each gesture maps to a **bin of phonemes**, a sequence of bins is decoded into a word, and the watch outputs text and audio.

Pipeline, end to end:

```
wrist motion → IMU (accel + gyro, ~50 Hz) → [segmenter] → classifier → gesture
            → phoneme bin → decoder → word → screen + speech
```

### 1.2 The six gestures and their phoneme bins

This is the source of truth for v1 (from the team's "Gesture-to-Phoneme Bin Assignment" document). The gesture IDs match the Kotlin enum `Gesture` in `wear/src/main/kotlin/com/gesturedatarecorder/recording/RecordingModels.kt` and the label list in the ML training script.

| Key | Gesture ID    | Display name | Bin name           | Phonemes (ARPAbet) | Collision score |
|-----|---------------|--------------|--------------------|--------------------|-----------------|
| 1   | `FLICK_UP`    | Flick Up     | Dental fricative   | TH, DH             | 0.00000 |
| 2   | `FLICK_DOWN`  | Flick Down   | Bilabial stop      | P, B               | 0.00052 |
| 3   | `TWIST_RIGHT` | Twist Right  | High vowel (front-tense / back-lax) | IY, UH | 0.00072 |
| 4   | `TWIST_LEFT`  | Twist Left   | High vowel (front-lax / back-tense) | IH, UW | 0.00210 |
| 5   | `SHAKE`       | Shake        | Sibilant fricative | S, Z               | 0.00256 |
| 6   | `DOUBLE_TAP`  | Double Tap   | Affricate          | CH, JH             | 0.00001 |

Example spellings (useful for testing):

| Word   | Phonemes      | Keys        |
|--------|---------------|-------------|
| is     | IH Z          | 4 5         |
| this   | DH IH S       | 1 4 5       |
| these  | DH IY Z       | 1 3 5       |
| cheese | CH IY Z       | 6 3 5       |
| choose | CH UW Z       | 6 4 5       |
| juice  | JH UW S       | 6 4 5 (same keys as *choose*, a deliberate collision) |
| speech | S P IY CH     | 5 2 3 6     |
| beach  | B IY CH       | 2 3 6       |
| zip    | Z IH P        | 5 4 2       |

### 1.3 What exists in the repo today (as of 2026-10-05)

| Piece | Status | Where |
|---|---|---|
| Wear OS **data recorder** app (3 s countdown, 3 s capture, labeled CSV) | Built | `wear/` (Kotlin, Compose for Wear) |
| CSV plotting utility | Built | `Accessory Software/sensor_gesture_plot.py` |
| Labeled recordings | 10 on this branch (twist left/right only) | `recordings/GestureDataRecorder/` |
| Random-forest gesture classifier | Built by Raghav, **only on the remote `ML` branch**, Python/scikit-learn, trained on 12 recordings covering 3 of 6 gestures | `origin/ML:ML/train_gesture_classifier.py`, `ML/gesture_random_forest.joblib` |
| Segmenter (finding gestures in a continuous stream) | Not built | |
| Gesture → phoneme bin mapping in code | Not built (only in the PDF) | |
| Decoder (bins → words) | Not built | |
| Tactura watch app UI | Not built | |
| Speech output | Not built | |

**Implication:** the simulator ships its own clearly labeled stand-ins for every missing piece, behind interfaces that the real implementations can plug into later.

### 1.4 Facts from the real recordings (use these to make animations believable)

From the 10 recordings on this branch (Android sensor axes: **X** toward 3 o'clock, **Y** toward 12 o'clock, **Z** out of the screen):

- At rest the watch reads about `accel = (0.3, 0.6, 9.7) m/s²`, meaning it is worn **face up, roughly flat**.
- **Twists rotate around the watch X axis** (the forearm axis). Peak angular velocity is large: **8 to 17 rad/s**.
- **Twist Right**: main stroke is **positive** `gyro_x` (+8 to +13 rad/s), then a **return stroke** of about −7 to −10 rad/s.
- **Twist Left**: main stroke is **negative** `gyro_x` (−15 to −17 rad/s), then a return of about +8 to +11 rad/s.
- The return stroke is 60 to 75% the size of the main stroke. (This is a known open UX question for the team. The animation should include the return so people see it.)
- **Double Tap** is subtle: accel magnitude only swings between about 7.3 and 10.5 m/s², and gyro stays under ~1 rad/s.
- Sampling is about **50 Hz** (20 ms between accelerometer events).

---

## 2. Goals and non-goals

### Goals (v1)

1. Test the **UX and flow** of Tactura end to end without the physical watch.
2. Make gestures, bins, candidates, collisions and committed words **visible and legible** at a glance.
3. Look and feel **premium**. This is a tool the team should *enjoy* opening.
4. **Double-click to launch** on Windows and macOS. No repeated terminal commands.
5. Be **architected for later input modes** (phone IMU streaming, CSV replay, webcam) and **later real components** (Raghav's model, Russell's decoder, the real watch app UI) without rewrites.
6. **Keep working even when project code is broken**, by falling back to built-in stand-ins with a visible badge.

### Non-goals (v1)

- Do **not** evaluate or train any classifier on simulated data. Classifier accuracy can only come from the real watch.
- Do **not** build a smart decoder (no language model, no beam search, no context). The placeholder is a plain dictionary lookup. The real decoder is being designed separately by Russell and will plug into the `Decoder` interface.
- Do **not** port or run the Kotlin app. The watch screen is a JS replica slot.
- No phone streaming, webcam, CSV replay or multiplayer in v1. Leave clean extension points only.
- No user accounts, no cloud backend.

---

## 3. Hard rules for the implementer

1. **Isolation.** Only create or modify files inside `simulator/`. Do not edit `wear/`, `ML/`, `Accessory Software/`, `recordings/`, Gradle files, or anything at the repo root.
2. **Git hygiene.** Work on the `interactive-watch` branch. The repo already tracks `.idea/`, `.gradle/` and build outputs, and many show as modified because of line endings. **Never stage those.** Stage with `git add simulator/` only. Do not merge or rebase other branches. Do not push unless Russell asks.
3. **Honesty badges.** Every pipeline stage shows whether it is running the **PROJECT** implementation or the **SIM STAND-IN**, and why. A stand-in must never pretend to be the real thing.
4. **Never block on missing project code.** If a project implementation fails to load or throws, catch it, log it in the UI, fall back to the stand-in, and keep running.
5. **Work in phases** (Section 14). After each phase, stop, summarize what was built, and wait for Russell's review before continuing.
6. **Ask before deviating.** If something in this spec is unclear or seems wrong, ask Russell before improvising. Record any decision in `simulator/README.md` under "Decision log".
7. Plain **JavaScript (ES modules)** with JSDoc types. No TypeScript, no UI framework (no React, no Vue). Vanilla DOM + CSS for the HUD, three.js for 3D.

---

## 4. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js **20 LTS or newer** | One-time install for each teammate. The launcher checks for it. |
| Dev server and build | **Vite** | Hot reload during development. |
| 3D | **three.js** (+ `three/addons`) | `RoomEnvironment` + `PMREMGenerator` for reflections (no HDR file needed), `EffectComposer` + `UnrealBloomPass` for subtle glow. |
| UI | Vanilla JS + CSS custom properties | Components are small classes or functions in `src/ui/`. |
| Fonts | Self-hosted via `@fontsource/*` packages | Display: **Doto** (open-source dot-matrix, OFL). Labels: **Space Mono**. Body: **Space Grotesk**. |
| Neural voice | **kokoro-js** (`onnx-community/Kokoro-82M-v1.0-ONNX`) in a Web Worker | Falls back to the Web Speech API. See Section 9. |
| Tests | **Vitest** | Unit tests for lexicon, bin mapper, decoder, registry fallback. |
| Lexicon builder | Python script, run once, output committed | Uses `cmudict` + `wordfreq` from pip. The simulator itself never needs Python at runtime. |

---

## 5. Folder structure

```
simulator/
  SPEC.md                         ← this file
  README.md                       ← how to launch, controls, decision log
  Start Simulator (Windows).bat
  Start Simulator (Mac).command
  package.json
  package-lock.json
  vite.config.js
  index.html
  .gitignore                      ← node_modules/, dist/, .vite/
  public/
    data/
      lexicon_base.json           ← generated by tools/build_lexicon.py, committed
  tools/
    build_lexicon.py
    requirements.txt              ← cmudict, wordfreq
    lexicon_exclude.txt           ← acronyms/letters to drop (bbc, pc, bc, ...)
  src/
    main.js                       ← boot sequence
    core/
      eventBus.js                 ← tiny pub/sub
      store.js                    ← single app state object + subscribe()
      clock.js
    config/
      gestures.js                 ← IDs, display names, key bindings, glyphs
      gesture_bins.json           ← the table in §1.2, single source of truth
    input/
      InputSource.js              ← interface
      KeyboardInput.js            ← v1
      CameraKeys.js               ← WASD/arrow orbit
    pipeline/
      types.js                    ← JSDoc typedefs (§8.1)
      registry.js                 ← stage loading + fallback + status
      Pipeline.js                 ← wires stages together
      classifier/
        PassthroughClassifier.js  ← v1 stand-in
        RandomForestClassifier.js ← stub with the feature contract, throws NotImplemented
      mapper/
        BinMapper.js
      decoder/
        Decoder.js                ← interface + docs for Russell
        LexiconLookupDecoder.js   ← v1 placeholder
      lexicon/
        Lexicon.js                ← loads lexicon_base.json, filters by current bins
    voice/
      VoiceEngine.js
      kokoro.worker.js
      webSpeech.js
    scene/
      SceneRoot.js
      lighting.js
      CameraRig.js
      watch/
        WatchModel.js             ← procedural Galaxy Watch 7
        materials.js
      WristMannequin.js
      GestureAnimator.js
      Annotations.js
    screen/
      WatchScreen.js              ← offscreen 480×480 canvas → texture
      ScreenApp.js                ← interface
      apps/
        TacturaStarterApp.js
    ui/
      Hud.js
      components/                 ← GestureDeck, PipelineTrace, StageBadge, Transcript, ScreenMirror, HelpOverlay, Toast, SettingsPanel
      styles/
        tokens.css
        base.css
        hud.css
    telemetry/
      SyntheticImu.js             ← stretch goal (§10)
  tests/
    lexicon.test.js
    decoder.test.js
    binMapper.test.js
    registry.test.js
```

---

## 6. User experience

### 6.1 Launch

1. Teammate double-clicks `Start Simulator (Windows).bat` or `Start Simulator (Mac).command`.
2. A terminal window opens with a short branded banner (ASCII dot-matrix "TACTURA SIM").
3. The first run installs dependencies automatically. Later runs skip straight to starting.
4. The browser opens automatically at the local URL.
5. The page shows a **boot sequence** (≤1.5 s): dot-matrix wordmark assembles, stage badges tick on one by one (`CLASSIFIER … STAND-IN`, `BINS … LOADED`, `LEXICON … 37 WORDS`, `VOICE … LOADING`), then the watch fades in under studio light.

Details in Section 13.

### 6.2 Layout (desktop, min width 1024 px, designed at 1440 × 900)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TACTURA / SIM   v0.1   INPUT: KEYBOARD   [CLS: STAND-IN][BINS][DEC: STAND-IN][VOICE: NEURAL]   ⚙  ? │
├──────────────┬─────────────────────────────────────────────┬──────────────┤
│ 01 / GESTURES│                                             │ 02 / SCREEN  │
│ ┌──────────┐ │                                             │   ◯ mirror   │
│ │1 FLICK UP│ │                                             │              │
│ │ TH · DH  │ │            3D VIEWPORT (full bleed)         │ 03 / TRACE   │
│ └──────────┘ │         watch hero + annotation lines       │ GESTURE ▸ BIN│
│  … 6 tiles   │                                             │ ▸ PHONEMES ▸ │
│              │                                             │ CANDIDATES   │
├──────────────┴─────────────────────────────────────────────┴──────────────┤
│ 04 / TRANSCRIPT   these cheese speech ▌   buffer: [6][3]  → 2 matches      │
│ 05 / TELEMETRY (stretch)  accel ~~~~~~  gyro ~~~~~~   SYNTHETIC             │
└───────────────────────────────────────────────────────────────────────────┘
```

- The 3D viewport is full bleed behind everything. The rails are translucent panels on top of it.
- Panels are numbered `01 / …`, `02 / …` like sections of a technical manual.
- The left rail and right rail can be collapsed (`[` and `]`) for a clean hero view.

### 6.3 Controls

| Key | Action |
|---|---|
| `1` to `6` | Fire gesture (see §1.2). Ignore OS key auto-repeat (`event.repeat`). |
| `Space` | Commit the current buffer as a word. |
| `Backspace` | Remove the last gesture from the buffer. If the buffer is empty, remove the last committed word. |
| `Tab` / `Shift+Tab` | Cycle through candidates when more than one word matches (for example *choose* / *juice*). |
| `Esc` | Clear the current buffer. |
| `W A S D` and `← ↑ → ↓` | Orbit the camera around the watch (A/D and ←/→ yaw, W/S and ↑/↓ pitch). Holding a key orbits smoothly with easing. |
| Mouse drag / scroll | Orbit and zoom. |
| `R` | Reset camera to the hero angle. |
| `M` | Mute or unmute voice. |
| `[` / `]` | Collapse left / right rail. |
| `?` or `H` | Help overlay listing every control. |

Gesture tiles in the left rail are also clickable, so the sim works with a mouse only.

Keyboard events are ignored while focus is inside a text field (settings panel).

### 6.4 Core flow, step by step (typing "cheese")

1. Press `6`.
   - Left rail tile `6 DOUBLE TAP` flashes signal red for 300 ms.
   - The 3D watch plays the Double Tap animation.
   - Right rail trace shows `DOUBLE_TAP ▸ Affricate ▸ CH · JH ▸ 9 words start with this`.
   - Watch screen shows a chip `CH/JH` in the buffer row.
2. Press `3`. Same as above for Twist Right (`IY/UH`). The candidate preview narrows.
3. Press `5`. Shake (`S/Z`). The screen previews the top exact match: **cheese**.
4. Press `Space`.
   - The word **cheese** is committed: it animates from the watch screen buffer into the large center slot, then appends to the transcript bar.
   - The voice engine speaks "cheese". A thin ring on the watch screen pulses while it speaks.
   - The buffer clears.
5. If there is more than one exact match (keys `6 4 5` → *choose*, *juice*), the screen shows the top-ranked word plus `+1` and the trace panel lists all of them with a `COLLISION` tag. `Tab` cycles before committing.
6. If there are **no** matches, `Space` triggers a short red `NO WORD` flash and a haptic-style shake of the screen content. Nothing is spoken. The buffer stays so the user can Backspace.

---

## 7. Visual design system

### 7.1 Direction

"Nothing" design language meets early-2000s Sony futurism (VAIO, PS2-era, Walkman-era industrial design): **monochrome, dot-matrix, technical, precise, and quietly luxurious.** Dark. Sharp contrast. Sharp geometry. Smooth, expensive-feeling motion.

Inspired by, never copied: **no Nothing or Sony logos, wordmarks or proprietary fonts.** Use the open fonts below.

The watch is the hero and is rendered **realistically** (real metal, real glass). The interface around it is **flat and technical**. The contrast between a photoreal object and a schematic UI is the signature look.

### 7.2 Tokens (`src/ui/styles/tokens.css`)

```css
:root {
  --bg:            #0A0A0B;
  --surface:       rgba(17, 17, 19, 0.72);   /* translucent panels over the viewport */
  --surface-solid: #111113;
  --surface-2:     #18181B;
  --line:          #2A2A2F;   /* 1px hairlines */
  --line-strong:   #3D3D44;
  --text:          #F4F4F1;
  --text-muted:    #8C8C93;
  --text-dim:      #55555C;
  --accent:        #FF3B2F;   /* signal red: ONLY for "something just happened" and errors */
  --accent-soft:   rgba(255, 59, 47, 0.14);
  --ok:            #F4F4F1;   /* success is white, not green */

  --font-display: "Doto", ui-monospace, monospace;
  --font-label:   "Space Mono", ui-monospace, monospace;
  --font-body:    "Space Grotesk", system-ui, sans-serif;

  --radius: 0px;              /* sharp */
  --chamfer: 10px;            /* signature 45° corner cut */
  --grid: 8px;

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --t-fast: 120ms;
  --t-med: 180ms;
  --t-flash: 300ms;
}
```

Rules:

- **One accent color.** Red appears only on fresh events (tile flash, new trace row, recording dot) and errors. Everything else is white, grey and black.
- **Hairlines, not boxes.** 1 px borders in `--line`. No drop shadows, no gradients on UI elements, no blur except the panel backdrop (`backdrop-filter: blur(12px)`).
- **Signature shape:** rectangles with **one 45° chamfered corner** (top-right) via `clip-path`. Use for gesture tiles, buttons, badges.
- **Labels** in Space Mono, uppercase, letter-spacing `0.08em`, 11 to 12 px, `--text-muted`.
- **Readouts and big words** in Doto. Numbers use tabular figures.
- **Microcopy** is terse and technical: `SYS.READY`, `IMU: NONE`, `CLS: STAND-IN`, `LEX: 37`, `T+0412ms`.
- **Viewport background:** near-black with a very faint dot grid (Nothing-style, ~3% opacity) and a soft radial falloff behind the watch.

### 7.3 Components

| Component | Look and behavior |
|---|---|
| **Gesture tile** (×6) | Chamfered rectangle. Big Doto key number at left, gesture name in Space Mono, phonemes `TH · DH` below in `--text-muted`. On fire: border and number turn red, a red scan line sweeps across in 300 ms, then decays back. Hover: border brightens to `--line-strong`. |
| **Stage badge** | Small chamfered chip: `CLS: STAND-IN`. White text for PROJECT, muted for STAND-IN, red for ERROR. Hover or click shows the reason (for example "project model not configured"). |
| **Pipeline trace** | Vertical list of the last 8 events, newest on top. Each row: `T+ms`, gesture glyph, bin, phonemes, candidate count. Newest row slides in (180 ms) with a red left tick that fades. |
| **Candidates list** | Inside the trace panel. Word in Doto, thin horizontal frequency bar, `COLLISION` tag when >1 exact match. Selected candidate marked with `▸`. |
| **Transcript bar** | Committed words in Doto, large, with a blinking block cursor. Current buffer shown as chips after the cursor. |
| **Screen mirror** | A crisp 2D round copy of the watch screen canvas (same pixels), so the screen is readable at any camera angle. |
| **Help overlay** | Full-screen dark scrim, controls laid out as a keyboard diagram drawn with hairlines. |
| **Toast** | Bottom-center, chamfered, auto-dismiss 2.5 s. Used for fallbacks and errors. |

### 7.4 Motion

- Default transition: `var(--t-med) var(--ease-out)`. No bouncy springs.
- Flash events decay over 300 ms.
- Respect `prefers-reduced-motion`: disable sweeps and camera easing, keep instant state changes.
- Target **60 fps** on a typical laptop with integrated graphics. Cap device pixel ratio at 2.

### 7.5 Sound (optional, default on, quiet)

Tiny synthesized UI ticks via Web Audio (no audio files): a short high tick on gesture fire, a lower double tick on commit, a soft buzz on `NO WORD`. One master volume in settings. Separate from the voice.

---

## 8. Pipeline architecture

### 8.1 Data types (`src/pipeline/types.js`)

```js
/** @typedef {'FLICK_UP'|'FLICK_DOWN'|'TWIST_RIGHT'|'TWIST_LEFT'|'SHAKE'|'DOUBLE_TAP'} GestureId */

/**
 * Raw input from any source. v1 keyboard sends `label`.
 * Future sources (phone, replay) send `imu` instead and rely on the classifier.
 * @typedef {Object} RawInput
 * @property {'keyboard'|'mouse'|'phone'|'replay'|'webcam'} source
 * @property {number} t                      performance.now() in ms
 * @property {GestureId} [label]             known label (keyboard, mouse, replay with labels)
 * @property {ImuWindow} [imu]               sensor window (future)
 */

/**
 * Mirrors the recorder CSV so recordings and sim data share one shape.
 * @typedef {Object} ImuWindow
 * @property {Array<{tNs:number, sensor:'accelerometer'|'gyroscope', x:number, y:number, z:number}>} samples
 * @property {number} durationMs
 */

/**
 * @typedef {Object} GestureEvent
 * @property {string} id
 * @property {GestureId} gesture             argmax
 * @property {Record<GestureId, number>} probabilities
 * @property {number} confidence
 * @property {RawInput['source']} source
 * @property {number} t
 */

/** @typedef {{ gesture: GestureId, bin: string, phonemes: string[] }} BinToken */

/** @typedef {{ word: string, phonemes: string[], zipf: number }} Candidate */

/**
 * @typedef {Object} DecodeResult
 * @property {Candidate[]} exact            words whose full gesture sequence equals the buffer, ranked
 * @property {number} prefixCount           how many words start with this buffer
 * @property {Candidate[]} prefixPreview    top few prefix matches, ranked
 */

/**
 * @typedef {Object} StageStatus
 * @property {'project'|'stand-in'|'error'} mode
 * @property {string} name
 * @property {string} [reason]
 */
```

### 8.2 Stages and interfaces

Each stage is a "socket" with a **stand-in** (ships with the sim) and an optional **project** implementation (plugged in later).

| Stage | Interface | v1 stand-in | Future project implementation |
|---|---|---|---|
| Input | `InputSource { start(emit), stop() }` | `KeyboardInput` (+ tile clicks) | Phone IMU stream, CSV replay, webcam |
| Segmenter | `segment(RawInput) → RawInput[]` | Pass-through (each keypress is already one gesture) | Real segmentation of continuous IMU |
| Classifier | `classify(RawInput) → Promise<{probabilities}>` | `PassthroughClassifier`: one-hot on `label` (confidence 1.0) | `RandomForestClassifier` (see §8.4) |
| Bin mapper | `map(GestureEvent) → BinToken` | `BinMapper` reading `gesture_bins.json` | Same, shared config |
| Decoder | `decode(BinToken[]) → DecodeResult` | `LexiconLookupDecoder` | Russell's decoder |
| Speaker | `speak(word) → Promise<void>` | `VoiceEngine` (§9) | Same |

### 8.3 Registry and fallback (`src/pipeline/registry.js`)

```js
// Pseudocode
async function loadStage(name, { project, standIn }) {
  if (project) {
    try {
      const impl = await project();          // dynamic import + init
      return { impl, status: { mode: 'project', name } };
    } catch (err) {
      notify(`${name}: project failed, using stand-in`, err);
      const impl = await standIn();
      return { impl, status: { mode: 'stand-in', name, reason: String(err) } };
    }
  }
  return { impl: await standIn(), status: { mode: 'stand-in', name, reason: 'no project implementation configured' } };
}
```

- Runtime errors inside a project stage are also caught per event: log, toast, fall back for that event, and flip the badge to `ERROR`.
- Which implementation each stage uses is configured in one place: `src/pipeline/Pipeline.js` (a small `STAGES` object). Swapping in a real component later should be a one-line change.

### 8.4 Classifier stub for Raghav's model

`RandomForestClassifier.js` exists in v1 but throws `NotImplemented` (so the registry falls back). Its header comment must document the **feature contract** of `recording_features()` in `origin/ML:ML/train_gesture_classifier.py` so a future port matches exactly:

- Input is one recording window. Sort samples by `sensor_timestamp_ns`.
- Accelerometer channels use only rows where `source_sensor == "accelerometer"`. Gyroscope channels use only `gyroscope` rows.
- Times are normalized to [0, 1] across the whole window (min to max event time over both sensors).
- Each of the 6 channels (`accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z`) is linearly interpolated onto **32** evenly spaced points (`np.linspace(0, 1, 32)`). Duplicate timestamps are averaged first.
- Feature vector = concatenation in that channel order → **192 floats**.
- Model: scikit-learn `RandomForestClassifier`, 500 trees, saved with joblib along with `time_bins` and `supported_labels`.

Document the two future paths (do not implement in v1):

1. Export to ONNX (`skl2onnx`) and run with `onnxruntime-web` in the browser.
2. A tiny local Python helper that loads the `.joblib` directly and answers over HTTP/WebSocket.

Either way, a parity test should compare JS features against the Python function on the real CSVs.

### 8.5 Gesture bins config (`src/config/gesture_bins.json`)

```json
{
  "version": 1,
  "source": "Tactura Gesture-to-Phoneme Bin Assignment (6 gestures / 12 phonemes)",
  "bins": [
    { "gesture": "FLICK_UP",    "bin": "Dental fricative",  "phonemes": ["TH", "DH"], "score": 0.00000 },
    { "gesture": "FLICK_DOWN",  "bin": "Bilabial stop",     "phonemes": ["P", "B"],   "score": 0.00052 },
    { "gesture": "TWIST_RIGHT", "bin": "High vowel (front-tense / back-lax)", "phonemes": ["IY", "UH"], "score": 0.00072 },
    { "gesture": "TWIST_LEFT",  "bin": "High vowel (front-lax / back-tense)", "phonemes": ["IH", "UW"], "score": 0.00210 },
    { "gesture": "SHAKE",       "bin": "Sibilant fricative","phonemes": ["S", "Z"],   "score": 0.00256 },
    { "gesture": "DOUBLE_TAP",  "bin": "Affricate",         "phonemes": ["CH", "JH"], "score": 0.00001 }
  ]
}
```

Validate on load: every gesture appears exactly once, every phoneme appears in at most one bin. Show a red badge and a readable error if validation fails.

### 8.6 Lexicon

**Build step (once, output committed):** `tools/build_lexicon.py`

- `pip install -r tools/requirements.txt` (`cmudict`, `wordfreq`).
- Take the **top 50,000** English words from `wordfreq.top_n_list('en', 50000)`.
- Keep words matching `^[a-z']+$`.
- Attach **every** CMUdict pronunciation, with stress digits stripped (`IY1` → `IY`).
- Attach `wordfreq.zipf_frequency(word, 'en')`.
- Write compact JSON to `public/data/lexicon_base.json`:
  `{"v":1,"source":"cmudict + wordfreq top 50k","words":[["cheese",4.39,["CH IY Z"]], ...]}`
- Keep the file under ~3 MB. Do **not** pre-filter by the current bins.

**Runtime (`Lexicon.js`):** filter `lexicon_base.json` by the **current** `gesture_bins.json` on load.

- Keep a pronunciation only if every phoneme is in some bin. Convert it to a gesture-ID sequence.
- Drop single-letter words and anything in `tools/lexicon_exclude.txt` (copy it into `public/data/` at build time, or inline it).
- Settings toggle `Lexicon size`: top 5k (default, matches the bin analysis), 20k, 50k.
- Settings toggle `Filter crude words` (default on) using a small list in config.
- Build an index `Map<sequenceKey, Candidate[]>` (exact) plus a trie or sorted list for prefix counts.

Because filtering happens at runtime, **editing the bins automatically recomputes the vocabulary.** (A live bin editor is a future feature, but the architecture must allow it.)

**Sanity check for tests** (verified 2026-10-05 with `cmudict` + `wordfreq`, top 5k, before exclusions): **37** spellable entries, **26** unique gesture sequences, **6** sequences shared by more than one word, including:

- `DOUBLE_TAP TWIST_LEFT SHAKE` → choose, juice (+ one more)
- `FLICK_DOWN TWIST_RIGHT SHAKE` → peace, piece (true homophones)
- `FLICK_DOWN TWIST_LEFT DOUBLE_TAP` → pitch (+ one crude word)

At top 20k: about 114 spellable words. At top 50k: about 217.

The HUD should surface this: the `LEX` badge shows the current spellable-word count.

### 8.7 Placeholder decoder (`LexiconLookupDecoder.js`)

- `exact`: all candidates whose gesture sequence equals the buffer, ranked by zipf frequency, descending.
- `prefixCount` and `prefixPreview` (top 3) for the live preview while typing.
- That is all. **No** language model, no context, no fuzzy matching. The file header must say clearly:
  > Placeholder only. The real Tactura decoder is designed separately and plugs into the `Decoder` interface.
- `Decoder.js` documents the interface with a short, friendly explanation of inputs and outputs, written for a teammate who will implement a real one.

---

## 9. Voice

Russell wants the voice to **sound good**. Use a tiered `VoiceEngine`:

1. **Neural (default):** `kokoro-js` with model `onnx-community/Kokoro-82M-v1.0-ONNX`.
   - Run inside a **Web Worker** so the 3D scene never stutters.
   - Device: `webgpu` with `dtype: "fp32"` when `navigator.gpu` is available, otherwise `wasm` with `dtype: "q8"`.
   - Default voice **`af_heart`**. Selectable in settings: `af_bella`, `bf_emma`, plus a male option.
   - Load lazily after the first user interaction. Badge shows `VOICE: LOADING 42%` then `VOICE: NEURAL`.
   - The model downloads once from Hugging Face and is cached by the browser. Internet is required on first use only.
   - Cache generated audio per word in memory, so repeated words play instantly.
   - Play through Web Audio so it can be routed and visualized (the speaking ring on the watch screen reads the output level).
2. **System fallback:** Web Speech API (`speechSynthesis`) if the neural engine fails or is still loading.
   - Pick the best available English voice by name ranking: contains `Natural`, `Neural`, `Premium`, `Enhanced`, `Siri`, or `Google` first, then any `en-US`, then any `en`.
   - Rate 0.95, pitch 1.0. Badge shows `VOICE: SYSTEM`.
3. **Mute** (`M`). Badge shows `VOICE: MUTED`.

Speak only on commit, never on each gesture.

---

## 10. 3D scene

### 10.1 Watch model (`WatchModel.js`): procedural Samsung Galaxy Watch 7, 44 mm

Build it in code from primitives (`LatheGeometry`, `CylinderGeometry`, `ExtrudeGeometry` with bevels, `RoundedBox`-style shapes). Use real proportions. Work in **millimeters** and scale the root group (e.g. 0.01) so the camera clipping planes behave.

Reference dimensions (44 mm model):

| Part | Spec |
|---|---|
| Case | Round, **44.4 mm** diameter, **9.7 mm** thick, aluminum ("Armor Aluminum") with a softly rounded edge profile |
| Glass | Flat **sapphire crystal**, sitting nearly flush, tiny chamfer at the edge |
| Display | Round **1.5 in** Super AMOLED, **480 × 480 px**, about 38 mm visible diameter, thin black border between display and case edge |
| Buttons | Two pill-shaped buttons on the **right side** (3 o'clock side), one above center (Home) and one below (Back). They depress slightly when "pressed" (future). |
| Underside | Slightly domed sensor module with a ring of small dark windows (health sensor). Visible when the camera orbits below. |
| Lugs and strap | Short integrated lug blocks at 12 and 6 o'clock. Matte **black** sport band (fluoroelastomer look, subtle micro-texture via a normal map generated in code), curving down and away so the watch reads as "worn". |
| Finishes | Case: **Silver** (default), Green, Cream. Switchable in settings. |

Materials (`materials.js`): `MeshPhysicalMaterial` everywhere.

- Aluminum: metalness 1.0, roughness ~0.28, faint anisotropic brushed look if feasible.
- Glass: clearcoat 1.0, low roughness, slight reflection, transmission off (keep the screen readable).
- Display: `MeshBasicMaterial` with the screen `CanvasTexture`, `toneMapped: false` so AMOLED blacks stay pure and whites stay bright. Bloom picks up bright pixels subtly.
- Strap: dielectric, roughness ~0.75.

Quality bar: at the hero angle, a viewer should believe it is a product render. **If the procedural model cannot reach that bar, a downloaded Galaxy Watch 7 glTF/GLB model may replace the case geometry**, as long as (a) it is swapped in behind the same `WatchModel` API, (b) the screen remains a separate mesh driven by our canvas, and (c) the look still matches §7. Licensing is not a concern for this internal tool, but record the source in the decision log.

### 10.2 Lighting and environment (`lighting.js`)

- `RoomEnvironment` through `PMREMGenerator` for reflections (no external HDR).
- A soft key light from upper left, a cool rim light from behind right to outline the case edge, low ambient.
- `ACESFilmicToneMapping`, sRGB output.
- A subtle soft contact shadow under the watch (a blurred radial plane, not real-time shadows).
- Background is the CSS dot grid, the WebGL canvas has a transparent clear color.

### 10.3 Camera rig (`CameraRig.js`)

- Orbit around the watch center. Hero angle: slightly above, about 25° off the face normal, so the face, edge and buttons are all visible.
- Keys (§6.3) apply angular velocity with smooth acceleration and damping. Mouse drag and wheel via `OrbitControls` with damping, zoom clamped.
- Pitch is clamped to avoid flipping. `R` animates back to the hero angle over 600 ms.

### 10.4 Wrist mannequin (`WristMannequin.js`), toggle, default ON

A minimal, abstract forearm and hand so gestures read clearly. Style: matte dark grey or hairline wireframe, consistent with the technical-drawing look. Never realistic skin.

- The watch is strapped to the **forearm, just behind the wrist joint**.
- The hand is a separate part that pivots at the wrist.
- This matters for honesty: in a real **flick**, the hand moves a lot but the watch on the forearm moves much less. The animation should show that (big hand motion, small watch motion).

### 10.5 Gesture animations (`GestureAnimator.js`)

Animate the forearm group (and the hand where noted). Watch-local axes follow Android: **X** toward 3 o'clock (along the forearm toward the hand), **Y** toward 12 o'clock, **Z** out of the screen. Rotation directions follow the sign of the real `gyro_x` data (§1.4).

| Gesture | Motion | Timing |
|---|---|---|
| Twist Right | Roll the forearm **+70° about X** (positive gyro_x), brief hold, return to neutral with a slight overshoot (the return stroke) | 180 ms out, 60 ms hold, 260 ms back |
| Twist Left | Roll **−70° about X** (negative gyro_x), hold, return with slight overshoot | same |
| Flick Up | Hand pitches **up ~40°** at the wrist. Forearm and watch tip only **~8°** | 120 ms out, 200 ms back |
| Flick Down | Hand pitches **down ~40°**. Forearm and watch tip **~8°** | same |
| Shake | Forearm oscillates side to side about Y, ±12°, 3.5 cycles, decaying | ~450 ms |
| Double Tap | Two sharp small dips of the watch along −Z (about 1.5 mm), plus a tiny ripple on the screen glass highlight | 2 × 90 ms with 110 ms gap |

- Use easing curves that feel physical (fast out, softer return). No linear motion.
- Animations can overlap: if a new gesture fires mid-animation, blend from the current pose rather than snapping.
- Each fire also triggers a short **edge glow** on the watch case rim (signal red, ~250 ms) as the 3D-side feedback.

### 10.6 Annotations (`Annotations.js`), toggle, default ON

Thin hairline callouts anchored to 3D points and projected to screen space each frame, technical-drawing style:

- `01 / HOME KEY`, `02 / BACK KEY`, `03 / DISPLAY 480×480`, `04 / IMU (ACCEL + GYRO)`, `05 / SENSOR ARRAY` (underside).
- Labels in Space Mono, muted. Fade out when their anchor faces away from the camera.

---

## 11. Watch screen (`src/screen/`)

### 11.1 Rendering

- `WatchScreen` owns an **offscreen 480 × 480 canvas** (2D context). It is the texture of the display mesh (`CanvasTexture`, `needsUpdate` each frame it changes).
- The same canvas is drawn into the HUD **Screen mirror** at full resolution, clipped to a circle.
- Everything is clipped to a circle. Keep content inside a **safe area** (inscribed circle at ~84% of the diameter).
- Wait for fonts (`document.fonts.load`) before first draw.

### 11.2 ScreenApp interface (`ScreenApp.js`)

```js
/**
 * A watch "app" that draws onto the round 480×480 screen.
 * The real Tactura watch UI will be recreated as another ScreenApp later.
 * @interface
 */
export class ScreenApp {
  /** @param {{ store, bus }} api */ mount(api) {}
  /** @param {number} dt seconds */  update(dt) {}
  /** @param {CanvasRenderingContext2D} ctx */ render(ctx) {}
  unmount() {}
}
```

`WatchScreen` hosts exactly one app at a time and can switch apps (future: a settings toggle listing apps).

### 11.3 `TacturaStarterApp` states

Visual style matches §7 (dot-matrix on true black, which looks fantastic on AMOLED).

| State | What the screen shows |
|---|---|
| **Boot** | Dot-matrix `TACTURA` assembles from scattered dots (~800 ms). |
| **Idle** | Time at top in small Doto, centered `READY` and a hint `1–6 GESTURE · SPACE COMMIT` in tiny Space Mono. A slow breathing dot. |
| **Composing** | Row of bin chips (`CH/JH  IY/UH  S/Z`) curved along the upper safe arc. Center: top candidate preview in large Doto with `+N` if more exact matches, or `N POSSIBLE` if only prefix matches. |
| **Committed** | Word large in the center, a thin ring pulses with the voice level while speaking, then the word shrinks to the top line and the app returns to Composing/Idle. |
| **No match** | Red `NO WORD` for 600 ms with a small horizontal shake. |

---

## 12. Telemetry (stretch goal, end of v1)

`SyntheticImu.js` derives fake accel/gyro from the animation so the bottom telemetry strip can show live sparklines in the **same units and axes as the recorder** (m/s², rad/s, ~50 Hz):

$$\text{gyro} = \boldsymbol{\omega}_{\text{watch}} \qquad \text{accel} = R^\top(\mathbf{a}_{\text{world}} - \mathbf{g})$$

with $\mathbf{g} = (0, -9.81, 0)$ in three.js world space (y up), $R$ the watch's world rotation, $\boldsymbol{\omega}$ from the quaternion change between frames expressed in the watch frame, and $\mathbf{a}_{\text{world}}$ from finite differences of the watch position.

- Label the strip **SYNTHETIC** in red-outlined text. These numbers are for intuition only.
- **Never** feed synthetic data into a classifier for evaluation, and never present it as real sensor data.

---

## 13. Launchers (`Start Simulator (Windows).bat`, `Start Simulator (Mac).command`)

Goal: double-click and go, every time, on a fresh clone.

Both launchers must:

1. Change to their own folder (`cd /d "%~dp0"` on Windows, `cd "$(dirname "$0")"` on macOS).
2. Print a short banner.
3. **Check Node.js** (`node -v`, require major ≥ 20). If missing or too old: print a friendly message, open `https://nodejs.org/en/download` in the default browser, and wait for a keypress before closing.
4. **Install dependencies only when needed:** if `node_modules/` is missing, or the hash of `package-lock.json` differs from the one saved in `node_modules/.tactura-install-stamp`, run `npm install` (or `npm ci`), then write the new stamp.
5. Start Vite with `npx vite --open` (port 5173, let Vite pick the next port if busy).
6. Keep the window open and say `Press Ctrl+C to stop the simulator.`
7. On any error, print it clearly and **pause** so the window doesn't vanish.

macOS specifics:

- Commit the `.command` file with the executable bit: `git update-index --chmod=+x "simulator/Start Simulator (Mac).command"`.
- In `README.md`, explain that if macOS blocks the file (Gatekeeper, for example after downloading a ZIP), right-click → **Open** once.

Also add `npm run dev`, `npm run build`, `npm run preview`, `npm test` scripts for developers.

`vite.config.js`: `server.open: true`. Keep `server.host` on localhost for v1 (phone streaming later will need LAN access, note this in a comment).

---

## 14. Build phases and acceptance criteria

Stop after each phase for Russell's review.

### Phase 0: Scaffold and launch
- Folder structure, `package.json`, Vite, three.js, fonts, tokens, empty HUD frame, launchers, README skeleton, `.gitignore`.
- ✅ Double-clicking the launcher on a fresh clone (Windows and macOS) installs once, opens the browser, and shows the dark shell with the dot grid and the top bar.
- ✅ Second launch starts in a few seconds without reinstalling.

### Phase 1: The watch
- Procedural Galaxy Watch 7, materials, lighting, contact shadow, camera rig with keys and mouse, hero angle, reset, annotations, finish switcher.
- ✅ The watch reads as a product render at the hero angle. Orbiting with WASD/arrows feels smooth. 60 fps on an integrated-GPU laptop.

### Phase 2: Gestures
- Keyboard input, gesture tiles (clickable), mannequin, all six animations, edge glow, UI tick sounds.
- ✅ Each key 1 to 6 plays the right animation with the right direction (§10.5) and flashes the right tile. Holding a key does not auto-repeat.

### Phase 3: Pipeline, screen, transcript
- Registry with badges, passthrough classifier, classifier stub, bin mapper with validation, lexicon build script and committed JSON, runtime lexicon filter, placeholder decoder, starter screen app, screen mirror, trace panel, transcript, Space/Backspace/Tab/Esc.
- ✅ `6 3 5 Space` commits **cheese**. `6 4 5` shows **choose** and **juice** with a `COLLISION` tag and Tab cycles them. `Backspace` behaves per §6.3. A nonsense sequence plus Space shows `NO WORD`.
- ✅ `LEX` badge shows 37 (minus exclusions) at top 5k.
- ✅ Breaking the classifier stub on purpose (or pointing a project stage at a missing file) shows a toast, flips the badge, and the sim keeps working.
- ✅ Vitest suite passes.

### Phase 4: Voice
- Kokoro worker, system fallback, mute, voice picker, per-word audio cache, speaking ring.
- ✅ Committed words are spoken with the neural voice after the first load. With the network off on first run, the system voice is used and the badge says so.

### Phase 5: Polish and stretch
- Help overlay, settings panel (finish, lexicon size, crude filter, voice, volumes, toggles for mannequin/annotations/telemetry), reduced motion, synthetic telemetry strip.
- ✅ Russell signs off on the look.

---

## 15. Future roadmap (design for it, do not build it)

- **Phone as the watch:** stream a phone's IMU (strapped to the forearm with an armband, not held in the hand) to the sim over Wi-Fi. Needs HTTPS on the LAN for motion permissions. Browser `devicemotion` gives rotation rate in **deg/s**, so convert to rad/s.
- **Tape deck:** replay real recorder CSVs through the pipeline (the only honest way to exercise Raghav's model in the sim).
- **Real classifier** in the classifier socket (§8.4).
- **Russell's decoder** in the decoder socket.
- **Real Tactura watch UI** as a new `ScreenApp`.
- **Live bin editor:** edit `gesture_bins.json` in the UI and watch vocabulary and collisions update.
- **Segmentation experiments:** push-to-gesture, rhythm, and auto-detect modes.
- **Sharing:** export a session (gesture log + transcript) as JSON, and later a shared online session.

---

## 16. Decision log (seed)

| Date | Decision | Why |
|---|---|---|
| 2026-10-05 | Keyboard input only for v1 (keys 1 to 6 in the Kotlin enum order) | Fastest path to testing UX flow |
| 2026-10-05 | Space commits, Backspace undoes, Tab cycles ties | Word boundary and correction in the sim. The real watch's end-of-word mechanism is still undecided |
| 2026-10-05 | JS + three.js + Vite, self-hosted, double-click launchers | Team knows JS, easy launch on Windows and macOS |
| 2026-10-05 | Procedural watch model first, downloaded GLB allowed if it looks better and fits the aesthetic | Control over look and per-part animation |
| 2026-10-05 | Neural voice (Kokoro, `af_heart`) with system voice fallback | "Make the voice sound good" |
| 2026-10-05 | Lexicon from CMUdict + wordfreq, filtered at runtime by the bin config | No existing word-list file in the repo. Runtime filtering lets bins change freely |
| 2026-10-05 | Sim stand-ins for classifier and decoder, with honesty badges | Sim must run even when project code is broken, and must never pretend |
