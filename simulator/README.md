# Tactura Watch Simulator

A 3D web simulator of a Samsung Galaxy Watch 7 for testing the feel and flow of the Tactura gesture-to-speech pipeline without the physical watch. The full build spec is in [SPEC.md](SPEC.md).

> **Status: Phase 5 (polish), v1 feature-complete.** Gestures flow through the full pipeline (classifier → phoneme bin → word lookup) onto the watch screen, the trace panel and the transcript, and committed words are spoken with a neural voice. Try `6 3 5 Space` (cheese) or `6 4 5` then `Tab` (choose / jews / juice). Press `?` for every control, and `⚙` (top right) for settings. The bottom strip shows **synthetic** accel/gyro derived from the animation.

## Launch

You need **Node.js 20.19+ or 22.12+** (any current LTS from [nodejs.org](https://nodejs.org/en/download) works). Install it once. The launcher checks for it and opens the download page if it's missing or too old.

| Platform | Do this |
|---|---|
| Windows | Double-click `Start Simulator (Windows).bat` |
| macOS | Double-click `Start Simulator (Mac).command` |

The first launch installs dependencies (about a minute). Later launches start in a few seconds. Your browser opens automatically, usually at http://localhost:5173 (Vite picks the next free port if 5173 is busy). To stop the simulator, press **Ctrl+C** in the terminal window or close it.

**macOS blocked the file?** If macOS says the `.command` file can't be opened (Gatekeeper, common after downloading a ZIP), **right-click it → Open** once, then confirm. After that a double-click works. If it says the file isn't executable, run `chmod +x "Start Simulator (Mac).command"` once in Terminal.

## Developer scripts

Run these inside `simulator/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest unit tests |

The launchers call `tools/ensure-deps.mjs`, which runs `npm ci` only when `node_modules/` is missing or `package-lock.json` changed since the last install (tracked in `node_modules/.tactura-install-stamp`).

## Controls

| Key | Action |
|---|---|
| `1` to `6` | Fire gesture (Flick Up, Flick Down, Twist Right, Twist Left, Shake, Double Tap). Holding a key fires once. Tiles in the left rail are clickable too |
| `Space` | Commit the current buffer as a word. With no exact match: `NO WORD`, and the buffer stays |
| `Backspace` | Remove the last gesture, or the last word if the buffer is empty |
| `Tab` / `Shift+Tab` | Cycle candidates when several words match (otherwise Tab moves focus as usual) |
| `Esc` | Close the help or settings if open, otherwise clear the buffer |
| `R` | Clear all text at once: the buffer and every committed word |
| `W A S D`, arrow keys | Orbit the camera (A/D yaw, W/S pitch) |
| Mouse drag / scroll | Orbit and zoom |
| `C` | Reset camera to the hero angle |
| `M` | Mute or unmute voice |
| `[` / `]` | Collapse the left / right rail |
| `?` or `H` | Help overlay: every control on a keyboard diagram. While it's open, other keys do nothing |

Shortcuts are ignored while typing in a text field, and while Ctrl/Cmd/Alt is held so browser shortcuts keep working. Gesture keys use physical key positions, so they work on any keyboard layout.

## Settings

`⚙` in the top bar opens the settings drawer. Everything is remembered per browser; `RESET` at the bottom restores the defaults.

| Section | Setting | Default |
|---|---|---|
| Watch | Case finish: Silver, Green, Cream | Silver |
| View | Arm: with it on, the watch lies face up on a forearm and the camera looks from the wearer's side; off, the watch stands upright like a product shot | On |
| | Callouts: the numbered labels on the keys, display, IMU and sensors | On |
| | Telemetry: the synthetic strip in the dock | On |
| Lexicon | Size: top 5k, 20k or 50k words (the `LEX` badge and the matches update at once) | 5k |
| | Crude words: hidden or shown | Hidden |
| Voice | Heart, Bella, Emma, Michael | Heart |
| | Speech on or muted (same as `M`), and its volume | On, 90% |
| Sound | UI ticks volume (gesture, commit, `NO WORD`) | 35% |

With `prefers-reduced-motion` set in the OS, the sim skips the boot assembly, camera easing and glides, the screen's word pop and `NO WORD` shake, and UI sweeps. State changes stay instant. Gestures still animate, since the motion is what they show.

## Telemetry (synthetic)

The bottom strip plots six channels, each in its own tile: accelerometer X/Y/Z (m/s²) and gyroscope X/Y/Z (rad/s), the last 3 seconds at 50 Hz, in the recorder's axes (X toward 3 o'clock, Y toward 12, Z out of the screen). Hover a tile to read a past sample.

**These numbers are made up from the animation** ([SyntheticImu.js](src/telemetry/SyntheticImu.js): gyro is the watch's angular velocity, accel is Rᵀ(a − g)). They're there to build intuition, like seeing that a Twist Right spikes gyro X and swings gravity into accel Y. They are not sensor data: never train or evaluate a classifier on them. The strip is labeled `SYNTHETIC` for that reason.

## Voice

Committed words are spoken (never single gestures). The `VOICE` badge says which engine is talking:

| Badge | Meaning |
|---|---|
| `STANDBY` | Nothing loaded yet. The neural voice starts loading on your first key press or click |
| `LOADING 42%` | Downloading [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) from Hugging Face. Words are spoken by the system voice meanwhile |
| `NEURAL` | Kokoro is speaking, in a Web Worker (WebGPU fp32 if your browser has WebGPU, otherwise WASM q8) |
| `SYSTEM` | The neural voice couldn't load (e.g. no internet on the first run), so the browser's own voice speaks. Reload with internet to try again |
| `MUTED` | `M` was pressed |

**First run needs internet** and downloads about **311 MB** with WebGPU (**88 MB** without). The browser caches it, so later runs work offline and the voice is ready about 10 seconds after your first key press. On an Intel Arc laptop GPU a new word takes about 0.5–1 s to synthesize, but the sim prepares the current best match while you type, so pressing Space usually speaks at once. Each word is synthesized only once per voice.

Test switch: `?break=voice` makes the voice's code unreachable, like a first run with no internet, to see the `SYSTEM` fallback.

The viewport's bottom-right readout shows drawn frames per second. It reads `IDLE` when nothing is moving: the 3D view only redraws when something changes, so an idle sim costs no GPU time.

## The pipeline and its badges

```
key 1–6 → RawInput → segment → classify → GestureEvent → bin mapper → BinToken
        → buffer → decode → DecodeResult → watch screen, trace, transcript   (Space commits)
```

Each stage is a socket with a **stand-in** that ships with the sim and an optional **project** implementation. The top-bar badges say which one is running; hover or click a badge for the reason.

| Badge | Now | Meaning |
|---|---|---|
| `CLS` | `STAND-IN` | Passthrough: keyboard input is already labeled, so it reports that gesture with confidence 1.0. It recognizes nothing |
| `BINS` | `LOADED` | `src/config/gesture_bins.json`, the team's real assignment (white = project, not a stand-in) |
| `LEX` | `26` | Spellable words at top 5k after filtering (see below) |
| `DEC` | `STAND-IN` | Placeholder dictionary lookup, ranked by word frequency. No language model |
| any | `ERROR` (red) | A project implementation is configured but failed to load or threw; the stand-in covered for it and the sim kept running |

### Plugging in a real stage

Edit `STAGES` in [src/pipeline/Pipeline.js](src/pipeline/Pipeline.js) and set the stage's `project` loader. That's the whole change.

- **Classifier (Raghav):** [RandomForestClassifier.js](src/pipeline/classifier/RandomForestClassifier.js) documents the exact feature contract of `recording_features()` on the ML branch, and the two ways to run the model (ONNX in the browser, or a local Python helper).
- **Decoder (Russell):** [Decoder.js](src/pipeline/decoder/Decoder.js) explains the input and output with examples. `decode(tokens)` may return a Promise.

To see the fallback path work, add a test switch to the URL. It does nothing unless present.

| URL | What happens |
|---|---|
| `?break=classifier` | The classifier points at the random-forest stub, whose `init()` throws → `CLS: ERROR`, the passthrough takes over |
| `?break=decoder` | The decoder points at a file that doesn't exist → `DEC: ERROR`, the lookup takes over |
| `?break=classifier-runtime` | A classifier that loads, then throws on every gesture → `CLS: ERROR` after the first gesture |

### Lexicon

`public/data/lexicon_base.json` (1.9 MB, committed) holds CMUdict pronunciations for wordfreq's top 50,000 English words, **not** filtered by the bins. The sim filters it at startup against `gesture_bins.json`, so editing the bins changes the vocabulary without rebuilding anything. It drops single letters, the words in `tools/lexicon_exclude.txt` (acronyms, letter names) and, by default, crude words (`src/config/lexicon.js`). At top 5k that leaves 26 of the 37 spellable entries.

To rebuild it (only if you change the builder; the sim never needs Python):

```
cd simulator
python -m venv tools/.venv
tools/.venv/Scripts/pip install -r tools/requirements.txt     # macOS: tools/.venv/bin/pip
tools/.venv/Scripts/python tools/build_lexicon.py             # macOS: tools/.venv/bin/python
npm test                                                      # checks the spec's 37 / 26 / 6 numbers
```

## Layout

```
simulator/
  Start Simulator (Windows).bat, Start Simulator (Mac).command   launchers
  index.html, vite.config.js, package.json
  public/data/       lexicon_base.json (generated, committed)
  tools/             ensure-deps.mjs (launcher helper), build_lexicon.py, requirements.txt,
                     lexicon_exclude.txt
  src/
    main.js          boot sequence and wiring
    config/          gestures.js (ids, keys, glyphs), gesture_bins.json (spec §8.5), lexicon.js
    config/          … and settings.js (settings defaults, validation, per-browser save)
    core/            eventBus, store, clock, keyboard helpers, prefs
    input/           InputSource (interface), KeyboardInput (keys 1–6 + tiles), CameraKeys, ComposeKeys
    pipeline/        types.js, registry.js (load + fallback), Pipeline.js (STAGES), Composer.js (buffer,
                     transcript, Space/Backspace/Tab/Esc), classifier/, mapper/, decoder/, lexicon/
    scene/           SceneRoot (renderer, post, render-on-demand), CameraRig, lighting,
                     WristMannequin (arm rig), GestureAnimator, Annotations, SoftBloomPass,
                     watch/ (WatchModel, geometry, materials)
    screen/          WatchScreen (480 × 480 canvas host), ScreenApp (interface), apps/TacturaStarterApp
    voice/           VoiceEngine (tiers, cache, prefetch, level), kokoro.worker.js, webSpeech.js
    telemetry/       SyntheticImu (accel/gyro derived from the animation)
    ui/              Hud, uiSounds, components/ (… HelpOverlay, SettingsPanel, TelemetryStrip),
                     styles/ (tokens.css, base.css, hud.css)
  tests/             Vitest: core, gesture clips, lexicon, decoder, bin mapper, registry, composer, voice,
                     synthetic IMU
```

SPEC.md §5 has the full target structure.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-05 | Keyboard input only for v1 (keys 1 to 6 in the Kotlin enum order) | Fastest path to testing UX flow |
| 2026-10-05 | Space commits, Backspace undoes, Tab cycles ties | Word boundary and correction in the sim. The real watch's end-of-word mechanism is still undecided |
| 2026-10-05 | JS + three.js + Vite, self-hosted, double-click launchers | Team knows JS, easy launch on Windows and macOS |
| 2026-10-05 | Procedural watch model first, downloaded GLB allowed if it looks better and fits the aesthetic | Control over look and per-part animation |
| 2026-10-05 | Neural voice (Kokoro, `af_heart`) with system voice fallback | "Make the voice sound good" |
| 2026-10-05 | Lexicon from CMUdict + wordfreq, filtered at runtime by the bin config | No existing word-list file in the repo. Runtime filtering lets bins change freely |
| 2026-10-05 | Sim stand-ins for classifier and decoder, with honesty badges | Sim must run even when project code is broken, and must never pretend |
| 2026-10-05 | Minimum Node is **20.19+ or 22.12+**, not just "20". The launchers check that exact range | Vite 8 requires it. Node 20 itself reached end-of-life in April 2026, so the README points people at the current LTS |
| 2026-10-05 | Vitest **4.x**, not 5.x | Vitest 5 dropped Node 20, which would break the Node 20 support above |
| 2026-10-05 | Both launchers call one shared `tools/ensure-deps.mjs` for the install-stamp check, and install with `npm ci` | One implementation for Windows and macOS; `npm ci` installs exactly the committed lockfile |
| 2026-10-05 | `simulator/.gitattributes` pins launcher line endings (CRLF `.bat`, LF `.command`) | A `.command` with CRLF fails in bash, and an LF `.bat` can misbehave in cmd, whatever each teammate's `core.autocrlf` is |
| 2026-10-05 | Badges have a fourth look, `pending` (dim), shown as `OFFLINE` before a stage exists and as `LOADING` while it loads | Honesty: a stage that isn't built must not read as a stand-in or as running |
| 2026-10-05 | Small `FPS · DPR · GL` readout in the viewport corner (not in the §6.2 layout) | Makes the 60 fps acceptance check visible. Easy to hide behind a setting in Phase 5 |
| 2026-10-05 | Boot wordmark and terminal banner use a hand-drawn 5×7 dot glyph table (`src/ui/dotMatrix.js`) instead of sampling the Doto font | Individual dots can animate, and the same table renders the ASCII banner. All other display text uses Doto |
| 2026-10-05 | Extra `tests/core.test.js` for the event bus and store | So `npm test` is meaningful from Phase 0 |
| 2026-10-05 | **Presentation frame:** at rest the watch stands upright (12 o'clock up, face toward the hero camera) and the camera orbits the vertical axis, like a product shot. Read physically, the camera is the wearer looking down at a face-up wrist | Keeps 12 o'clock at the top of the screen while orbiting, and puts the contact shadow on a floor below the watch. Phase 5's synthetic IMU will use gravity along world −Z, so the rest reading matches the recordings' face-up `(0.3, 0.6, 9.7)` |
| 2026-10-05 | **Reflections come from a small code-built studio** (dark room plus softbox panels through PMREMGenerator) instead of three's `RoomEnvironment` | Same technique, still no HDR file. RoomEnvironment's evenly bright grey room washed the AMOLED blacks to grey and made the aluminum read flat white |
| 2026-10-05 | Bloom clamps radiance in its bright-pass and runs at half resolution (`SoftBloomPass`); strength 0.09, threshold 1.4 | Specular glints reach 50+ and flooded the frame with glow. Half resolution cut bloom's cost with no visible change |
| 2026-10-05 | 4× MSAA only below device pixel ratio 1.75 | On an Intel Arc iGPU at DPR 2, MSAA alone took the frame rate from 200 to 55 fps, and 1:1 crops looked the same without it |
| 2026-10-05 | The 3D view renders on demand: only when the camera, an animation, or a texture changes | An idle sim costs no GPU time. Measured on Intel Arc iGPU with continuous redraw: 226 fps at DPR 1, 156 at 1.25, 116 at 1.5, 240 at 2 |
| 2026-10-05 | Key and rim lights ride with the camera; the studio reflections stay fixed in the world | Every orbit angle stays lit like a studio shot, while reflections still slide across the metal as you orbit |
| 2026-10-05 | The strap is a closed loop around a wrist-sized cross-section (about 61 × 40 mm) | Reads as worn, and the Phase 2 forearm passes through it. Consequence: the sensor dome faces into the loop, so it's visible through the strap's side opening, not straight from behind |
| 2026-10-05 | Display material is boosted 1.5× | Post-processing tone-maps the whole frame (ACES), which would otherwise dim the AMOLED whites to ~90% grey. Blacks stay pure black |
| 2026-10-05 | The watch screen shows a built-in standby clock, and the HUD screen mirror is wired now (spec lists it for Phase 3) | A dark screen would undercut the product-render look. The standby face is the screen's "no app" state; `APP: NONE` stays honest until the Tactura app mounts in Phase 3 |
| 2026-10-05 | Clock colon drawn as two dots instead of Doto's `:` glyph | At weight 900 and 118 px, Doto's colon read as a smudge |
| 2026-10-05 | The IMU callout anchors below the clock digits rather than at the exact case center | Its marker sat on top of the time. The IMU's real board position isn't known anyway |
| 2026-10-05 | Finish picker lives in the viewport's top-right until the Phase 5 settings panel; the choice is remembered in localStorage | Phase 1 needs a finish switcher before settings exist |
| 2026-10-05 | Camera readout (`YAW / PITCH / DIST`) under the viewport label, and a controls hint along the bottom edge (hidden below 1280 px wide) | Makes the hero angle and orbit state legible. The hint stands in for the Phase 5 help overlay |
| 2026-10-05 | **Shake is a rapid left-right roll about the forearm axis (X)**, not "side to side about Y" as §10.5 says. Kept ±12°, 3.5 cycles, ~450 ms, decaying; the envelope is normalized so the strongest swing reaches the full ±12° | Russell: "like twisting your hand very fast left and right, I believe". There's no Shake recording yet, so revisit once one exists. The profile peaks near 10 rad/s on gyro_x, in the range of the real twists |
| 2026-10-05 | **With the arm shown, the watch lies face up on a level forearm** and the camera sits where the wearer's eyes would be. With the arm hidden, the Phase 1 upright product view stays. The `ARM` toggle animates between them | In the upright view, physical "up" points at the camera, so Flick Up came toward you and Flick Down appeared to rise on screen. Face up matches the recordings' rest pose: Flick Up rises, Double Tap dips down |
| 2026-10-05 | Arm-mode hero: from the elbow side and above (yaw −22°, pitch 40°, distance 4.8), orbiting a point over the wrist. The spec's hero (keys visible) applies with the arm hidden | A real hand is ~185 mm long; the product hero cropped it and flicks didn't read. In this view the side keys face away |
| 2026-10-05 | The arm is drawn "ghost" style: near-black body, light rim at the silhouette, sparse hairline sections, separate fingers | Spec allows matte grey or hairline wireframe. Solid matte grey read as a foam paddle and competed with the watch |
| 2026-10-05 | Twist timing: 180 ms eased out-stroke, 60 ms hold, underdamped spring return (overshoot ≈ 5%). Unit tests lock the recorded constraints | Main stroke peaks ≈ 10.6 rad/s (recordings: 8–17) and the return stroke ≈ 71% of it (recordings: 60–75%) |
| 2026-10-05 | A gesture fired mid-animation hands over from the current pose over 200 ms | No snapping, and back-to-back twists stay near real twist speeds (~20 rad/s vs 17 recorded) |
| 2026-10-05 | Edge glow is a thin red ring on the case's upper shoulder, peaking HDR-bright so the bloom catches it | Reads as "the rim lit up". ACES tone mapping shifts the brightest moment slightly toward orange-red |
| 2026-10-05 | Double Tap's glass ripple bends the glass normals and adds a faint light ring at the wavefront | The dark studio leaves almost no reflection to distort, so the normal ripple alone was invisible |
| 2026-10-05 | Tile clicks emit `RawInput` with `source: 'mouse'`; keys emit `'keyboard'` | Matches §8.1's source list and keeps the two honest in the trace later |
| 2026-10-05 | `pipeline/types.js` and `config/gesture_bins.json` exist from Phase 2 | Input already emits `RawInput`, and the tiles show each bin's phonemes. Bin validation comes with the BinMapper in Phase 3 |
| 2026-10-05 | Phase 2 wiring: an input event drives the animation, tile flash and tick directly | Phase 3 inserts the pipeline (classifier → bin mapper → decoder) between input and the trace/screen; the animation keeps showing the physical input |
| 2026-10-05 | Lexicon JSON rows carry a 4th field, the wordfreq `rank`, plus top-level `topN` and the tool versions (`cmudict` 1.1.3, `wordfreq` 3.1.1, pinned) | The 5k / 20k / 50k size setting needs each word's rank. The build reproduces the spec's sanity numbers exactly: 37 / 26 / 6 at top 5k, 114 at 20k, 217 at 50k |
| 2026-10-05 | The lexicon builder runs in a venv inside `simulator/tools/.venv` (gitignored) | Keeps `cmudict` and `wordfreq` out of everyone's global Python |
| 2026-10-05 | After filtering, top 5k has **26** words and 3 collisions: see/sea, peace/piece, choose/**jews**/juice | The spec's "+ one more" on choose/juice is "jews", a real word, so it stays. §6.4's "9 words start with Double Tap" is really 6 (choose, cheap, cheese, jews, juice, chip) |
| 2026-10-05 | `tools/lexicon_exclude.txt` holds acronyms and letter names spellable at 5k–50k; crude words are a separate list in `src/config/lexicon.js`, filtered by default. The app reads the exclude file directly (Vite `?raw` import) | One source of truth, no copy into `public/` |
| 2026-10-05 | **A project stage that fails to load shows `ERROR` (red)**, not `STAND-IN` as in §8.3's pseudocode. A stage that throws at runtime also flips to `ERROR` and stays there until reload | So the badge visibly flips (§14 acceptance), and a broken project stage can't be mistaken for "none configured" |
| 2026-10-05 | `?break=classifier`, `?break=decoder`, `?break=classifier-runtime` URL test switches | Demonstrates the fallback acceptance criteria without editing code. Inactive unless in the URL |
| 2026-10-05 | `decode()` may return a Promise; stages may have an async `init()` | Leaves room for a heavier real decoder or a model that loads |
| 2026-10-05 | `BINS` badge is white (project): it's the team's real assignment. `LEX` is muted: the sim's own vocabulary for the placeholder decoder | Honesty badges mean what they say |
| 2026-10-05 | Tab is only taken over when more than one word matches; Space is swallowed on keyup as well, and tiles drop focus after a click | Tab keeps working for keyboard focus otherwise, and Space can never "click" a focused tile instead of committing |
| 2026-10-05 | Until the voice exists, the commit ring does one soft pulse instead of following a voice level | Phase 4 drives it with the real output level |
| 2026-10-05 | Composing screen extras: under `N POSSIBLE`, a dim preview of the top 3 words; `NO MATCH` when no word starts with the buffer; a hint line (`SPACE COMMIT · ⌫ UNDO`) | Shows where the buffer is heading and how to get out of a dead end |
| 2026-10-05 | Trace rows lead with the phonemes, then the bin name, and show the input source and classifier confidence (`KEY 1.00`) | Phonemes survive truncation, and the confidence makes the passthrough's "1.00" visibly not a real measurement |
| 2026-10-05 | A toast identical to one already showing refreshes it instead of stacking | A stage failing on every gesture would otherwise bury the screen in copies |
| 2026-10-05 | **kokoro-js is loaded at runtime** from jsDelivr (its self-contained `dist/kokoro.web.js`, pinned to 1.2.1), not npm-installed | The npm package pulls in `onnxruntime-node` (287 MB) and `onnxruntime-web` (138 MB) that the browser never uses, which would make everyone's first double-click install minutes longer. The neural voice needs internet on first use anyway (the model comes from Hugging Face and the ONNX runtime from jsDelivr), and the browser caches all of it. Vendoring the bundle instead would commit GPL espeak-ng code into the repo. If jsDelivr is unreachable, the system voice speaks |
| 2026-10-05 | Before the first key press or click the badge reads `VOICE: STANDBY`, not `LOADING` as in §6.1's boot example | §9 says to load lazily after the first interaction, so nothing is loading at boot |
| 2026-10-05 | WebGPU uses fp32 as §9 specifies: a 311 MB first download (WASM q8 is 88 MB). Measured on this machine: 15 s download, 8.5–11.6 s to start from cache, 0.5–1.1 s per new word | Spec choice kept; the README warns about the size |
| 2026-10-05 | **Speculative synthesis:** the word Space would commit right now (top match, or the one Tab selected) is synthesized in the background while you type | Measured: speech starts 0 ms after Space instead of 0.5–1.9 s. Cheap, since the vocabulary is tiny |
| 2026-10-05 | Words are synthesized as "word." (trailing period) and leading silence is trimmed | Natural falling intonation for a single word, and no dead air before it |
| 2026-10-05 | The watch's speaking ring follows the real output level for the neural voice. The Web Speech voice can't be measured, so it gets a gentle synthetic flicker while speaking. The ring breathes faintly while a word is being synthesized and holds until speech ends (max 4.5 s) | Honest where measurable; never frozen while waiting |
| 2026-10-05 | The male option is `am_michael` | Kokoro's best-rated US male voice (C+) |
| 2026-10-05 | `VOICE: NEURAL` is white (project), `SYSTEM` and `MUTED` muted, `NONE` red | The voice engine is the real speaker stage (§8.2: "Same"); the system voice is its fallback |
| 2026-10-05 | A newer committed word cuts off the one still speaking. If synthesis fails for one word, that word uses the system voice (with a toast); if loading fails, the system voice is used until reload | Responsive, and never silent without saying why |
| 2026-10-05 | `?break=voice` test switch | Demonstrates the Phase 4 acceptance check (no internet on first run → system voice, badge says so) without unplugging anything |
| 2026-10-05 | **The settings drawer replaces the viewport's corner chips** (finish, `ARM`, voice, mute), and the `⚙` button sits in the top bar next to `?`. Saved choices from Phases 1–4 aren't carried over (the keys changed), so those reset once | One place for every setting, and the viewport is clean for the render. Mute stays on `M` |
| 2026-10-05 | Changing the lexicon size or crude filter rebuilds the vocabulary in place: the `LEX` badge, the current matches and the watch screen update without a reload, with a toast giving the new count | Lets you compare 5k / 20k / 50k while typing a word |
| 2026-10-05 | **Synthetic IMU frame:** the numbers come from the gesture motion in a fixed physical frame (watch face up on a level forearm), not from the watch's pose in the 3D scene. §12 reads gravity as three.js −Y in the watch's world rotation | In the upright product view (arm off), world −Y would put gravity on the watch's −Y and make the rest reading disagree with the recordings' `(0.3, 0.6, 9.7)`. This way rest reads `(0, 0, 9.81)` in both views, and the camera never affects it. Supersedes the "gravity along world −Z" note from Phase 1 |
| 2026-10-05 | **Telemetry as six small tiles** (one channel each, shared ±20 scale, hairline zero line, hover readout), not the two combined `accel ~~~ gyro ~~~` lines in the §6.2 sketch | Three overlaid lines per plot need three colors, and the design has one accent reserved for events and errors. One channel per tile keeps every line labeled in text, with no color legend |
| 2026-10-05 | Telemetry samples are resampled to 50 Hz from the render frames, and the strip only redraws when a value moves | Matches the recorder's rate; an idle sim still costs nothing |
| 2026-10-05 | The help overlay is a keyboard diagram: keys the sim uses are lit with their action, the rest are drawn dim. It's modal: while it's open only `Esc`, `?`, `H` and `Tab` do anything | Pressing `5` to "see what it does" with the help open shouldn't fire a gesture behind it |
| 2026-10-05 | `Esc` closes the help or the settings first; only with both closed does it clear the buffer | Closing a panel shouldn't throw away a half-typed word |
| 2026-10-05 | Reduced motion keeps gesture animations | §7.4 asks to drop sweeps and easing. The gesture motion is the content (it shows the user what to do), so it stays |
| 2026-10-05 | The `FPS · DPR · GL` readout stays visible (no setting to hide it) | It's small and dim, and it's useful when testing the sim on new hardware. Easy to add a toggle if it bothers anyone |
| 2026-10-05 | **`R` clears all text** (buffer and transcript at once); camera reset moves from `R` (§6.3) to `C` | Russell's request: a one-key way to start over, next to Backspace's one-at-a-time undo. `C` for camera |
