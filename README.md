# Keysong

English | [简体中文](README.zh-CN.md)

*Your keys sing the song.* Keysong lets anyone play along with the music they love, with no instrument experience needed. Separate a song into stems, and the part you choose, usually the vocals, only sounds while you type. Keep typing and the song sings. Stop and it waits for you.

It is a local Windows 11 desktop app that responds to typing in any application, so writing an email or code performs the song in the background. You can also play it deliberately, tapping along on the beat.

Keysong was called Cadence up to v0.1.0.

[User Guide](docs/user-guide.en.md) | [Development Guide](docs/development.en.md) | [Release Notes](docs/release-notes-v0.2.0.md)

## Highlights

- **Playable from the first second:** a built-in demo, *Ode to Joy* in a four-stem arrangement that Keysong synthesizes itself, so you can try it before preparing any music of your own.
- Typing reveals the stem you choose, whether vocals, drums, bass, or the other instruments, over the rest of the synchronized mix. It opens the moment a key lands.
- **Performance feedback:**
  - A song map shows where the part you play has content and paints gold what you brought in.
  - A status tag tells you when it's your cue and when the song is in a break.
  - A live score measures how much of the part you played.
  - Each track remembers your best take.
- **Beat awareness:** Keysong finds the song's pulse. The keyboard orb pulses on the beat and flares gold when you land on it. Tapping along keeps the part sounding even at one key per beat.
- System-wide keyboard response on Windows 11. Monitoring starts only after **Enable** and stops on **Disable** or app exit.
- Raw key codes are classified in the Electron main process; the renderer receives only `char`, `back`, `enter`, or `space`.
- A fixed `Music Resources/song/files` directory is scanned and watched automatically.
- Play, pause, next, sequence, shuffle, direct playlist selection, and click-to-jump on the song map or progress bar.
- A sound panel for the music volume and the per-key click.
- Portable Windows build with no installer required.

## Quick Start

Keep the executable and resource folder side by side:

```text
Keysong-0.2.0-Windows.exe
Music Resources/
└─ Sample Song/
   ├─ Sample Song_(Vocals).wav
   └─ Sample Song_(Instrumental).wav
```

Run Keysong, select a track, choose **Enable**, and start typing in any application. See the [User Guide](docs/user-guide.en.md) for complete UVR separation and import instructions.

## Privacy Summary

The global keyboard hook must receive operating-system keyboard events to detect activity, but Keysong does not persist typed characters, reconstructed text, clipboard content, or key history. Performance feedback uses only keystroke timing; the only thing it saves is a best score per track. Pausing playback does **not** disable monitoring. Choose **Disable** or exit Keysong when monitoring should stop.

Imported music is read locally and is not uploaded. The sampled piano may make a one-time CDN request through `smplr`; Keysong falls back to a local synthesizer when offline.

## Music Resources

The desktop build scans only direct song folders inside `Music Resources`. Audio files placed directly in the resource root are ignored.

Recommended UVR pair:

```text
Music Resources/Sample Song/Sample Song_(Vocals).wav
Music Resources/Sample Song/Sample Song_(Instrumental).wav
```

Recognized formats:

```text
.mp3 .wav .m4a .aac .ogg .opus .flac .webm .mid .midi
```

Keysong recognizes common English stem labels such as `Vocals`, `Instrumental`, `No Vocals`, `Drums`, `Bass`, and `Other`. Legacy non-English labels remain compatible internally through escaped matching rules, without exposing non-English interface text.

## Development

Requires Node.js 22.12 or later.

```powershell
npm install
npm test             # Unit tests on the Node test runner
npm run dev          # Browser preview with page-local input
npm run desktop      # Build and launch the desktop app
npm run package:win  # Create the sanitized portable Windows package
```

`npm run package:win` excludes developer-local songs from the public package. See the [Development Guide](docs/development.en.md) for architecture, testing, and release details.

## Copyright and License

Only process, play, or redistribute music you own or are authorized to use. Stem separation does not change the copyright status of a recording.

Keysong's source code is released under the [MIT License](LICENSE). The license covers the code only, never the music you play with it. Release builds include `THIRD-PARTY-NOTICES.txt` with the licenses of the open-source packages bundled into the app.
