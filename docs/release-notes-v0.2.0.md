# Keysong v0.2.0 Release Notes

Cadence is now **Keysong**. *Your keys sing the song.*

## Performance Feedback

Typing used to open and close the chosen stem without knowing what the song was doing. Now the feedback follows the music:

- **Instant response.** A keystroke opens the stem the moment it lands. It used to wait for the next update of a 15 Hz control loop, up to 66 ms later.
- **Song map.** On stem tracks the progress bar shows where the part you play has content. It previews the next phrase and paints gold what you brought in.
- **Status tag.** **Singing**/**Playing** while you perform, **Your cue** when the part is waiting for you, and **Break** with a countdown when there is nothing to reveal.
- **Score and bests.** A live score measures the share of the part's real content you revealed. Resting through breaks never costs anything. Finished tracks report your take and keep a best per track and stem, shown in the playlist.
- **Beat awareness.** Keysong finds the song's beat. The keyboard orb pulses on it and flares gold when a key lands in time. Holding through the next beat means one tap per beat keeps a part sounding, and a stopped part releases on the beat. Songs without a steady pulse keep the previous behavior.
- **Livelier touch.** The per-key click varies slightly on every key instead of repeating one sample, and brightens on the beat.
- Switching the revealed stem crossfades instead of dropping the whole mix to silence for a moment.

Only keystroke timing is used. The only new stored data is a best score per track: its playlist id and a number.

## Easier to Start, Easier to Control

- **Built-in demo.** *Ode to Joy* is always in the playlist: Beethoven's public-domain melody in a four-stem arrangement that Keysong synthesizes in about two seconds. New users can play right away, and a short guide under it explains how to add their own songs.
- **Sound panel.** The speaker button sets the music volume and switches the key click off for those who only want the music.
- **Jump anywhere.** Click the song map or progress bar to move to that point, for example to practise a phrase or skip an intro.
- **Mini player.** One click shrinks Keysong to a small window that stays on top, showing the song map, your cue, and your score while you type in another app.
- **Clearer interface.** Drawn icons replace the text symbols on the playback buttons, best scores appear as a gold badge in the playlist, and the small labels now meet the WCAG AA contrast minimum.

## Security Updates

- Electron 43.4.1 → 43.7.9, which fixes a high-severity advisory: a compromised renderer could poison the sandboxed preload code cache (GHSA-qmv3-fv6v-rmhq).
- Patch updates to build and development tools with high-severity advisories: undici, brace-expansion, source-map-js, http-cache-semantics, js-yaml, fast-uri, and @xmldom/xmldom.
- One moderate advisory remains in electron-builder's dependency chain (sprintf-js). Its only fix downgrades electron-builder, and it affects build tooling, not the app.

## Fixes

- `npm test` failed on Node.js 21 and later, including the documented 22.12, and every build command failed on a fresh clone because of the missing `scripts/scores/` folder. Both work again. Node.js 22.12 or later is now declared as required.
- Typing into the Keysong window right after clicking **Enable** turned monitoring off at the first Space, and after clicking a playlist entry, every Space reloaded the track. Mouse clicks no longer leave focus on the control.
- Choosing the track that is already loaded no longer decodes it again.

## Renamed

The executable is `Keysong-0.2.0-Windows.exe`. Keep it beside your existing `Music Resources` folder, which is unchanged. Preferences are stored under the new name, so playback order, the chosen stem, and the typing-speed calibration start fresh once. For developers, the `CADENCE_*` environment variables are now `KEYSONG_*`.

## Known Limitations

- The primary tested target is 64-bit Windows 11.
- Windows code signing is not configured, so SmartScreen may display a warning.
- Beat tracking is tuned for music with a steady pulse. Very fast or slow songs may be tracked at half or double speed.
- No commercial music is bundled; users must add music they own or are authorized to use.

## License

Keysong is now open source under the MIT License. Release builds include `THIRD-PARTY-NOTICES.txt` with the licenses of the bundled open-source packages.
