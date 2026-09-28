# Keysong Development and Release Guide (English)

[Home](../README.md) | [User Guide](user-guide.en.md)

## 1. Stack and Environment

- Electron 43, Vite 7, and vanilla JavaScript/HTML/CSS
- Tone.js, smplr, and `@tonejs/midi`
- `uiohook-napi` for Windows-wide keyboard events
- electron-builder for the portable Windows target

64-bit Windows 11 is recommended. Node.js 22.12 or later is required (`engines` in `package.json`); the locked Vite needs it, and `npm test` passes a glob, which the test runner accepts from Node 21 on. Keep `package-lock.json` with every dependency change.

## 2. Install and Commands

```powershell
npm install
npm test
npm run midi
npm run dev
npm run build
npm run desktop
npm run package:win
```

| Command | Purpose |
|---|---|
| `npm test` | Runs every `tests/*.test.js` on the Node test runner |
| `npm run midi` | Generates `public/midi/manifest.json` and built-in MIDI assets. Transcriptions in `scripts/scores/*.mjs` are optional; the repository ships none |
| `npm run dev` | Starts the Vite browser preview; keyboard input is page-local |
| `npm run build` | Produces `dist/` |
| `npm run desktop` | Builds and launches the Electron desktop app |
| `npm run package:win` | Excludes local songs with `--no-local`, builds the portable `.exe`, then merges examples and documentation |

The browser preview is useful for fast UI work, but it cannot validate the global hook, external resource root, custom media protocol, or Explorer integration. Verify those paths in Electron.

## 3. Repository Layout

```text
electron/
  main.cjs            Electron lifecycle, global hook, resource scan, IPC
  preload.cjs         Minimal contextBridge surface
scripts/
  build-midi.mjs      Builds the MIDI manifest
  prepare-release.mjs Merges example music resources into release output
src/
  main.js             UI state, transport, engine orchestration, feedback wiring
  styles.css          UI styling
  library/library.js  Local grouping, stem recognition, and cache
  engine/             Playback, gating, analysis, and typing rhythm
    gate.js             Typing gate, stem modes, and the mixer
    presence.js         Where a stem has content, and its phrases
    beats.js            Onset envelope, tempo, and beat tracking
    take.js             Scoring one play-through; best scores
    track-analysis.js   Runs presence and beat analysis for a loaded stem set
  ui/song-map.js      The song map canvas
  shared/             Rules used by both the renderer and the build scripts
tests/                Unit tests for the pure logic, run by the Node test runner
  helpers/synth.js    Seeded synthetic audio: click tracks and drum grooves
Music Resources/
  Sample Song/        User example copied beside release builds
public/midi/           Maintained or generated built-in resources
docs/                  English documentation
```

Do not commit these directories:

```text
node_modules/ dist/ release/
local-midi/ local-audio/ local-stems/
public/midi/local/ public/midi/audio/ public/midi/stems/
public/midi/manifest.json
```

They can contain large generated artifacts or copyrighted user music. Everything under `Music Resources` except `Sample Song` is ignored as well. Still inspect `git status` and the staged diff before every publication.

`public/midi/manifest.json` is generated, not authored. `build-midi.mjs` rewrites it on every `npm run dev`, `npm run build`, and `npm run build:release`, and it names whatever currently sits in `local-midi/`, `local-audio/`, and `local-stems/` — so tracking it would put private song titles into source control even though the media itself is ignored. Every command that runs the app regenerates it first, so nothing depends on a committed copy.

## 4. Runtime Architecture

### Electron Main Process

`electron/main.cjs` is responsible for:

- The single-instance lock and window lifecycle.
- Loading `uiohook-napi` and starting the global hook only after explicit user enablement.
- Classifying raw key codes as `char`, `back`, `enter`, or `space`.
- Ensuring that `Music Resources` exists beside the executable.
- Scanning the fixed “one song folder, then files” layout.
- Watching changes with `fs.watch` and a debounce.
- Registering opaque, hashed `keysong-media://` URLs so absolute paths are not exposed to the renderer.
- Opening the resource directory through Electron `shell.openPath`.

### Preload Security Boundary

`electron/preload.cjs` exposes a minimal interface under `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Input categories are allow-listed. The renderer has no direct Node.js access and does not receive raw key codes.

### Renderer and Library

`src/main.js` owns enablement and loading state, transport controls, sequence/shuffle, playlist behavior, drag-and-drop, and UI updates. The stem mixer is rendered by `renderMixer()` and metered by `updateMeters()`, which reads the gains the `Mixer` actually applied rather than recomputing them. Desktop input arrives through preload; the browser preview uses only page-local `keydown` events. The performance feedback is wired up here too; see [Performance Feedback](#8-performance-feedback).

A mouse click leaves focus on the clicked control, and the next Space typed into the window would press it again, so pointer clicks release focus. Keyboard activation, which reports a click count of zero, keeps it.

`src/library/library.js` normalizes built-in MIDI, normal audio, selected browser folders, dropped files, and desktop resources into playable entries. Stems are grouped by directory and cleaned title. Any set the mixer can drive becomes a typing entry, from a two-stem UVR pair to a four-stem Demucs split; a set with nothing to reveal against falls back to normal audio.

## 5. Keyboard Privacy Data Flow

```text
Windows keydown
  -> uiohook-napi (raw event in main process)
  -> keyKind() (immediate classification)
  -> IPC sends only { kind }
  -> TypingSensor stores timestamp + category
  -> gain gate, tactile feedback, beat judgment, take scoring
```

Non-negotiable constraints:

- Do not send `event.keycode` or modifier state to the renderer.
- Do not record characters, reconstruct text, or persist input events.
- Enable starts the hook; Disable and app exit stop it.
- Pause intentionally does not equal Disable. The UI and documentation must keep this distinction explicit.

The performance feedback stays inside the same boundary. Beat judgments and scores use keystroke times only. What persists is a best score per track and stem: the playlist id and a number, in Web Storage under `keysong:best-takes`.

Any feature that changes this boundary is a security- and privacy-sensitive change and requires focused review. `tests/ipc-contract.test.js` pins the key channel to a `{ kind }`-only payload and fails when the main, preload, and renderer channel names drift apart.

## 6. Music Resource Contract

### Root Resolution

- Development: `Music Resources` under the project root.
- Windows portable build: `PORTABLE_EXECUTABLE_DIR/Music Resources`.
- Other packaged layouts: `Music Resources` beside `process.execPath`.
- Tests may isolate the root with `KEYSONG_MUSIC_ROOT`.

### Scan and Security Rules

- Only direct child directories of `Music Resources` are scanned; each is one song container.
- Only allow-listed extensions are read.
- Absolute file paths are never returned over IPC. The main process creates hashed tokens and `keysong-media://file/<token>` URLs.
- The protocol handler revalidates that every resolved file remains under the music root.

### Stem Recognition

`library.js` strips extensions, normalizes titles, and detects role labels. A Vocal + Instrumental pair becomes a full stem entry; an incomplete set falls back to normal audio.

All role rules live in one table, `src/shared/stem-roles.js`, which both the renderer and `scripts/build-midi.mjs` import. Add labels there and nowhere else.

Two properties of that table are load-bearing:

- **Row order.** The instrumental patterns are tested before the vocal patterns because `no_vocals` contains `vocals`. Reversing them files a Demucs instrumental as the vocal stem and silently drops the real vocals.
- **The `titleProne` column.** Words that also appear in ordinary song titles — `piano`, `guitar`, `backing` — are matched only inside a parenthesized UVR marker, never against a bare filename, so `Piano Man.mp3` stays a song rather than becoming an `other` stem. Separator tools write canonical bare names, so nothing real is missed.

`tests/stem-roles.test.js` and `tests/library.test.js` lock both properties down. Run `npm test` after any edit to the table.

## 7. Playback Model

The core model is synchronized stems plus an input-controlled gain gate—not one sample start per key:

```text
final output = background stems × background coefficient
             + foreground stem × typing activity
             + anchor stem × constant level
             + subtle per-key tactile transient
```

### Choosing the Foreground Stem

A mode in `gate.js` names only the stems that typing reveals. Everything else the track carries becomes background automatically, so a two-stem UVR pair and a four-stem Demucs split both work without enumerating combinations.

`availableModes(roles)` returns every mode a stem set supports, and drives two things: whether `library.js` treats the set as a typing entry at all, and which buttons the picker shows. A set that supports no mode—a lone stem with nothing to reveal against—falls back to normal audio. The listener's choice is stored in `keysong:stemMode` and reused on any track that can honour it.

`ANCHOR_ROLE` is the stem that holds a constant level regardless of typing, so the track always keeps a foundation. It defaults to `bass` and is exempt from the background duck. It is gated only when it is itself the stem the listener chose to reveal.

All stems share an AudioContext timeline, start time, and offset. Key events update the activity model and tactile layer; stem gains move smoothly. This prevents fast typing from turning vocals into repeated fragments.

The input sensor retains timestamps and four event categories and derives musical features such as rate, interval variation, correction rate, and paragraph boundaries. Space and Enter receive a slightly stronger tactile accent without revealing typed text.

### Opening on the Audio Clock

The `Gate` decides only whether it is open; the fades run as `AudioParam` automation. A keystroke that opens a closed gate sends the open mix to the deck immediately, instead of waiting for the 15 Hz control loop, which used to add up to 66 ms of jitter between key and sound. The control loop still drives releases, the background duck, and the Space/Enter drum accent. `Gate.value` models the gain the listener hears, for the meters and the score. `StemDeck.setGain()` drops requests that repeat the fade already under way, because the mixer restates its whole mix on every update.

### Holding Through the Beat

With a usable `BeatGrid`, `Mixer.strike()` holds the gate at least until the next beat plus a grace of 120 ms. A keystroke up to 70 ms early counts toward the beat it anticipates. The effect: tapping once per beat keeps a stem open at any typing speed, and letting go releases on the beat. Without a grid, holds follow typing speed alone, as before.

<a id="8-performance-feedback"></a>
## 8. Performance Feedback

### Analysis Pipeline

`analyzeStems()` in `track-analysis.js` runs once a stem track has started playing, yielding between steps, and its result is cached per playlist id:

1. **Presence** (`presence.js`): an RMS envelope per stem in 50 ms frames, mapped to 0..1 against the stem's own loud level and noise floor. Separator bleed reads as absent, and quiet singers still read as present. Frames group into phrases: breaths under 0.8 s are bridged, and blips under 0.35 s are dropped.
2. **Beats** (`beats.js`): the rhythm stem (drums, else instrumental) is rendered to 8 kHz mono. A log-compressed spectral-flux envelope at 100 frames per second gives the tempo from its autocorrelation, under a log-normal prior at 120 BPM. The beats come from the Ellis/librosa dynamic-programming tracker. Autocorrelation cannot tell the beat from other metrical levels, so the relatives of the best lag (½, 2, ⅔, 4⁄3, 1.5, ¾) are each tracked and the level whose beats land on the strongest onsets wins. Levels the signal does not actually repeat at are excluded. What remains is at worst a half- or double-time octave error.
3. **Confidence**: a grid is used only with at least 8 beats and an autocorrelation of 0.2 or more at its period. Steady grooves measure 0.3 and up even under heavy noise; noise, pads, and random clicks stay near 0.1. `BeatGrid.usable` is false otherwise and the beat features stay off.

### Takes and the Status

`Take` (`take.js`) records the gate level against the presence lane of the revealed stem on every control-loop tick. It records there, not per animation frame, because the typist is usually in another window where frames stop. The score is revealed content over heard content. `moment(pos)` places the playhead inside a phrase or before the next one, which drives the status tag: on, cue (content now or within `CUE_LEAD`, gate closed), or break. A take that heard at least `COMPLETE_SHARE` of the track's content can become a best.

### Drawing

`SongMap` redraws about ten times a second from the take's arrays. The beat ring is triggered from `requestAnimationFrame` by comparing the heard position, the deck position minus `outputLatency` and `baseLatency`, against the grid. Both are visual only and pause with the window. Scoring never depends on them.

## 9. Build and Release

```powershell
npm ci
npm run build
npm run package:win
```

Primary output:

```text
release/
  Keysong-<version>-Windows.exe
  Music Resources/
    Sample Song/
```

The release build first runs `scripts/build-midi.mjs --no-local`, which removes only generated local-media copies under `public/midi` and never touches the original `local-*` files. `scripts/prepare-release.mjs` then copies documentation and the example music resource.

That copy is restricted to the folders named in `RELEASE_SONG_FOLDERS` — currently just `Sample Song`, mirroring the `.gitignore` allow-list. Copying all of `Music Resources` would put whatever the developer has been testing with into the public package, which is exactly what the README promises does not happen. Every other song folder is reported and skipped:

```text
  [music-resource] excluded 1 local song folder(s): My Test Song
```

The script does not delete anything already sitting in `release/`, because that directory is build output rather than something it owns. It does warn when it finds song folders there that it did not put there:

```text
  [music-resource] WARNING: release\win-unpacked\Music Resources still contains My Test Song.
  [music-resource] Delete release/ and package again before publishing.
```

Treat that warning as blocking. Delete `release/` and package again rather than publishing the artifact.

The executable is currently unsigned. Before a public release:

1. Configure a trusted Windows code-signing certificate.
2. Generate a SHA-256 checksum and publish it with release notes.
3. Push source to GitHub without committing `release/` or user music.
4. Attach the `.exe` as a GitHub Release asset; it may exceed the normal Git blob size limit.
5. Choose and add an explicit `LICENSE`. The repository is already public without one, so nobody else may use the code yet.

## 10. Verification Checklist

### Static and Build Checks

```powershell
npm test
node --check electron/main.cjs
node --check electron/preload.cjs
npm run build
```

`npm test` runs the Node test runner over `tests/*.test.js`, with no extra
dependency to install. It covers the pure logic where mistakes are quiet rather
than loud: stem-role recognition, playlist grouping, MIDI salience ranking, key
detection, the typing feature window, the gain gate and its beat holding,
presence detection, the beat tracker, take scoring, and the IPC contract
between the main process, the preload, and the renderer. The beat tracker is
tested on seeded synthetic click tracks and drum grooves from 60 to 198 BPM,
and must reject noise, sustained pads, and random clicks. Run it before every
release and after any change to `src/shared/stem-roles.js`.

Set `KEYSONG_SLOW_TESTS=1` to include the 130,000-note MIDI parsing test.

### Desktop Smoke Test

- The final portable build starts with a single app instance.
- Music Resource opens the directory beside the `.exe`.
- The example folder exists and the `?` help is complete.
- Adding a real UVR pair automatically creates one stem playlist entry.
- The entry decodes and supports play, pause, and next.
- With Enable active, typing in another normal-permission app drives the music.
- Within a few seconds of a stem track starting, the song map appears, the tag moves between Singing, Your cue, and Break, and the score updates, also while another app has focus.
- On a track with a steady beat, the orb ring pulses in time; on a beatless track it stays still.
- A track played to the end reports the take, and the playlist shows the best.
- Typing into the Keysong window right after clicking Enable or a playlist entry neither disables monitoring nor reloads the track.
- Disable stops the response, and app exit leaves no Keysong process behind.
- Sequence/shuffle, direct playlist selection, and offline synth fallback work.

### Security Regression

- IPC still carries only an allow-listed `kind`.
- The custom media protocol cannot read outside `Music Resources`.
- External navigation and new windows remain blocked.
- The renderer retains `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.

## 11. Common Development Problems

### `uiohook-napi` fails to load

Check that the Node/Electron architecture matches the locked dependency. The project unpacks the native module through `asarUnpack` and pins its version in `package.json`. Re-test the packaged executable after every Electron or native-module upgrade.

### Browser preview works, desktop audio does not

Browser and Electron paths differ for `file://`, the custom scheme, and audio permissions. Test with `npm run desktop` and keep the relative `base: './'` in `vite.config.js`.

### Local songs unexpectedly appear in a build

`npm run midi` reads `local-midi`, `local-audio`, and `local-stems` for development previews. Always use `npm run package:win` for a public package: it invokes `--no-local` and clears generated copies under `public/midi`. Do not publish the output of an ordinary local `npm run build` as the release artifact.

## 12. Licensing and Third-Party Components

The repository is public but has no project-level `LICENSE`; do not assume an open-source grant. The publisher should choose a license and review attribution and license requirements for Electron, Tone.js, smplr, uiohook, UVR models, and bundled assets. Recording, MIDI transcription, and separated-stem rights must be confirmed independently.
