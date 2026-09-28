# Keysong User Guide (English)

[Home](../README.md) | [Development Guide](development.en.md)

## 1. What Keysong Does

Keysong turns typing rhythm into part of a song. It does not restart a sample for every key. Instead, separated tracks share one synchronized timeline: the instrumental keeps playing while typing activity controls the foreground stem. When you stop, the mix settles back toward the instrumental; when you resume, the vocal returns naturally.

The desktop build targets Windows 11. Once enabled, typing in a browser, chat app, document editor, or IDE can drive the music even while Keysong is in the background. With the window in view you can also play deliberately. The song map shows where the next phrase starts, the orb pulses on the beat, and a score tells you how much of the part you played (see [Reading Your Performance](#reading-your-performance)).

Keysong was called Cadence up to v0.1.0.

## 2. Before You Start

- **System:** The current build targets and is tested on 64-bit Windows 11.
- **Distribution:** Keysong is a portable `.exe`; no installer is required. Do not place it in a system directory that requires administrator permission for normal file writes.
- **Audio output:** Make sure Windows is not muted and the correct speakers or headphones are selected.
- **Unsigned build:** Code signing is not configured yet, so Windows SmartScreen may warn about the executable. Run only a build from a source you trust and compare its hash with the value published by the project owner.
- **Global monitoring:** The global keyboard hook starts only after you select **Enable**. Pausing music is not the same as disabling monitoring; use **Disable** or exit Keysong when you want monitoring to stop.

## 3. Launch and Everyday Use

1. Keep `Keysong-version-Windows.exe` and the `Music Resources` folder in the same directory.
2. Run Keysong. If `Music Resources` is missing, the app creates it beside the executable with an example folder and instructions.
3. Select a song in the playlist, or import your own music first.
4. Select **Enable**. Large WAV files may take a few seconds to decode on first playback.
5. Switch to any application and start typing. The input rhythm display indicates activity.
6. Use the player controls to pause/resume, move to the next track, or switch between sequence and shuffle.
7. Select **Disable** when finished. Exiting Keysong also stops the global hook.

### Controls

| Control | Purpose | Important detail |
|---|---|---|
| Enable / Disable | Starts or stops Windows-wide keyboard monitoring | Disable does not remove music files |
| Play / Pause | Controls the current song | Monitoring may remain enabled while paused |
| Next | Selects the next song | Shuffle chooses another random song |
| Sequence / Shuffle | Controls automatic track order | The choice is saved locally |
| Stems mixer | Chooses which stem responds to typing | Gold row follows your typing; teal rows always play |
| Song map | Replaces the progress bar on stem tracks | Shows where the stem you play has content; gold marks what you brought in |
| Playlist item | Selects a song immediately | If playback is active, the new song starts automatically; the best score shows under the title |
| Music Resource | Opens the fixed resource directory | The desktop app watches it for changes |
| `?` | Shows the folder and UVR quick guide | Available by hover, keyboard focus, or click |

<a id="importing-music"></a>
## 4. Importing Music

### 4.1 Required Folder Layout

The desktop app scans only the `Music Resources` folder beside the executable. Each song must have its own direct child folder. Do not place audio files directly in the resource root.

```text
Keysong-0.2.0-Windows.exe
Music Resources/
├─ Sample Song/
│  ├─ Sample Song_(Vocals).wav
│  └─ Sample Song_(Instrumental).wav
└─ Another Song/
   ├─ Another Song_(Vocals).mp3
   └─ Another Song_(Instrumental).mp3
```

Recommended workflow:

1. Select **Music Resource** beside the playlist.
2. Copy the `Sample Song` example folder.
3. Rename the copy to the song title.
4. Put the audio or separated stems inside that folder.
5. Return to Keysong. The playlist normally refreshes within about a second; there is no need to select the folder again.

### 4.2 Supported Files

Recognized extensions:

```text
.mp3 .wav .m4a .aac .ogg .opus .flac .webm .mid .midi
```

WAV or a high-quality MP3 is recommended. Actual codec decoding depends on the media support included with Electron/Chromium. Lossless WAV and FLAC files are much larger and require more memory while loading.

### 4.3 Stem Pairing

The typing-follow effect needs at least two stems: one for typing to reveal, and at least one to reveal it against. A UVR pair is the simplest form:

```text
Song Name_(Vocals).wav
Song Name_(Instrumental).wav
```

Matching is case-insensitive and recognizes common labels:

| Role | Example labels |
|---|---|
| Vocal | `Vocals`, `Vocal`, `Vox` |
| Instrumental | `Instrumental`, `No Vocals`, `Accompaniment`, `Backing` |
| Extra stems | `Drums`, `Bass`, `Other`, `Piano`, `Guitar`, and Chinese equivalents |

Demucs-style folders containing `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav` are fully supported: all four stems load together and each one can be chosen as the stem that responds to typing. A single normal audio file can still be played, but it cannot provide the reveal effect. A folder with only one recognized stem also falls back to normal audio playback.

### 4.4 Choosing Which Stem Responds to Typing

When a track carries stems, a **Stems** mixer appears in the player showing every stem the track has, each with a live level bar. Gold marks the stem that follows your typing; teal marks the stems that play regardless. Select any gold-capable row to change which stem responds.

- The stem you select stays silent until you type, then rises with your rhythm and fades again when you stop.
- Every other stem keeps playing on its own, ducking slightly while the selected stem is open so the overall level stays even.
- **Bass always plays at a constant level**, whatever you type, so the track keeps its foundation. The only exception is when you choose Bass itself as the stem that responds.

Your choice is remembered and reused on any track that has the same stem available. A vocal and instrumental pair shows both rows too, so you can always see which part is waiting on you and which is holding underneath.

### 4.5 Separating an MP3 with Ultimate Vocal Remover

Ultimate Vocal Remover (UVR) is an independent third-party open-source application and is not bundled with Keysong. Obtain it from the [official UVR website](https://ultimatevocalremover.com/) or the [official GitHub repository](https://github.com/Anjok07/ultimatevocalremovergui). Labels can vary between UVR versions; the following is a practical baseline for Keysong:

1. Open UVR and choose the source MP3 under `Select Input`.
2. Under `Select Output`, choose a temporary directory or the matching Keysong song folder.
3. Choose `MDX-Net` as the `Process Method`.
4. `UVR-MDX-NET Inst HQ 3` is a useful starting model. Different songs may work better with another model; this choice is not mandatory.
5. Prefer `WAV` as the output format.
6. Export both sides. Do not select a configuration that produces only `Vocals Only` or only `Instrumental Only`.
7. Select `Start Processing` and wait for completion.
8. Put both outputs in the same song folder and use the recommended names.

Example:

```text
Music Resources/Sample Song/Sample Song_(Vocals).wav
Music Resources/Sample Song/Sample Song_(Instrumental).wav
```

If UVR produces `Vocals` and `No Vocals`, those names may be kept; Keysong recognizes `No Vocals` as the instrumental. Do not trim only one stem. Both files must start at the same point and retain the same speed and duration to remain synchronized.

## 5. How the Typing-Follow Effect Works

- Every stem uses the same playback start and offset.
- Keyboard activity changes a foreground gain gate; it does not restart samples.
- The stem selected in the **Stems** mixer is the one the gate controls. Every other stem plays continuously, and bass holds a steady level throughout.
- The selected stem opens the moment a key lands, fading in over a few hundredths of a second.
- Continuous typing keeps the selected stem present. Stopping produces a short natural fade instead of an abrupt cut.
- When Keysong has found the song's beat, each keystroke keeps the stem open through the next beat. Tapping one key per beat keeps it sounding without a gap, and when you stop, it fades out on the beat rather than between two.
- Space and Enter are treated as structural boundaries and receive a slightly stronger tactile response.
- A vocal stem may already be silent during an intro or instrumental break; typing cannot create vocals that are not present in that part of the source. The status tag says **Break** when that is the case.

These rules need only timing and event category, not the text you type.

<a id="reading-your-performance"></a>
## 6. Reading Your Performance

A second or two after a stem track starts, Keysong has analysed it: where the stem you play has content, and where the song's beats fall. The feedback below then switches on. Until it does, the stems follow your typing as usual.

### The Song Map

On stem tracks the progress bar becomes a map of the whole song. Bars show where the stem you play (the gold row in the mixer) has content. Flat stretches are breaks, where that stem is silent.

- **Ahead of the playhead**, the map previews what is coming, so you can see the next phrase approach.
- **Behind the playhead**, bars turn gold where you brought the part in and stay dim where you missed it.

### The Status Tag

The tag beside **Now playing** says what the part is doing right now:

| Tag | Meaning |
|---|---|
| Singing / Playing | You are typing and the part is sounding. |
| Your cue | The part has content now, or will within about half a second, and it is waiting for you. Start typing. |
| Break | The part is silent here. Typing still opens it, but there is nothing to hear. The line under the song title counts down to the next phrase. |

### The Score

**Vocals sung** (or **Drums played**, and so on) is the share of the part's real content you have revealed so far in this play-through. Resting through a break never lowers it, and typing through silence never raises it.

When a track plays to the end, a message reports your take, for example *You sang 77% of the vocals*. Keysong keeps your best score for each track and stem and shows it in the playlist. Choosing a different stem starts a new take.

### The Beat Ring

When Keysong finds a steady beat, the ring around the keyboard orb pulses on every beat. A keystroke that lands within about 70 ms of a beat flares the ring gold, sounds a slightly brighter click, and appears as a gold bar in the keystroke scope. Off-beat keys appear grey.

Songs without a steady pulse, such as rubato ballads or ambient pieces, show no ring: Keysong shows nothing rather than a wrong beat. Very fast or very slow songs may pulse at half or double speed, which still lands on the beat.

### Tips for Playing

- Watch the map and start typing just before a phrase reaches the playhead.
- Rest during breaks; it costs nothing.
- To play the rhythm, tap one key per beat with the ring. The part stays open between taps.

## 7. Privacy, Permissions, and Network Access

### What Is Processed

- After Enable, the Electron main process receives Windows keyboard events through `uiohook-napi`.
- It classifies an event as a regular key, Backspace/Delete, Enter, or Space.
- Modifier keys themselves are ignored.
- The music renderer receives only the category—not the raw key code, character, clipboard content, or reconstructed text.
- Keyboard history is not written to a file, database, or log and is not uploaded.
- Performance feedback uses the same timing and categories. The only thing it stores is each track's best score: the track's playlist identifier and a percentage, kept in the app's local storage.

### What Keysong Does Not Do

- It does not reconstruct or save typed sentences.
- It does not read password fields, the clipboard, or document contents.
- It does not scan arbitrary disk locations outside `Music Resources`.
- It does not upload imported music.

### Network Behavior

Imported music is read locally. When the sampled piano is initialized, `smplr` may download samples from its CDN. If that request fails or the device is offline, Keysong falls back to a local synthesizer. Normal imported-track playback does not require an upload service.

### Recommendation

A system-wide keyboard hook is a sensitive capability. Run only trusted builds and enable Keysong only on devices you own or are authorized to use. To explicitly stop monitoring, select **Disable** or exit the app—not merely Pause.

## 8. Troubleshooting

### Enable was selected, but there is no music

1. Confirm that the playlist contains a selected song.
2. Select Play. Browser audio engines require an intentional user interaction before sound can start.
3. Check the Windows volume mixer, Keysong mute state, and output device.
4. Allow large files—especially multi-hundred-megabyte WAV files—to finish decoding.
5. Try Next to distinguish a single-file problem from a general audio problem.

### Typing in another application has no effect

1. Confirm that the top status says global input is enabled.
2. Ctrl, Alt, Shift, and Windows keys alone are intentionally ignored.
3. Some elevated applications isolate input from a normal-permission process. Prefer running both applications at the same privilege level; running Keysong as administrator for everyday use is not recommended.
4. Disable and enable again, or exit and restart Keysong.

### Files exist under Music Resource but do not appear

- Confirm the layout is `Music Resources/song-name/file`, not files directly in the root.
- Confirm the extension is supported.
- Make sure the file is no longer a partial download and copying has completed.
- If two stems do not pair, use the recommended `(Vocals)` and `(Instrumental)` labels.
- Wait for the automatic refresh. Restart Keysong if the watcher did not update.

### Instrumental plays, but vocals do not follow typing

- Look at the status tag. **Break** means the vocal stem is silent at this point in the song; the song map shows where it returns.
- Check that the vocal file plays independently in a normal media player.
- Confirm both files resolve to the same song title.
- Make sure UVR did not create an almost-silent vocal output. If the song map shows no bars at all, the stem has no content Keysong can detect.
- Move to a section that actually contains vocals; an intro or instrumental break may be silent by design.

### The beat ring never appears

Beat feedback needs a steady pulse. Songs with rubato, sparse percussion, or an ambient texture fall back to following typing speed alone, and the rest of the feedback still works. The ring also stays still while the Keysong window is minimized or covered, because the window is not drawn then; scoring continues in the background.

### Stems drift or start out of sync

- Use two files from the same UVR processing run.
- Do not trim, time-stretch, or prepend silence to just one file.
- Both stems must share the same start point and sample length. Re-run separation from the original source when necessary.

### Automatic refresh fails or a file is locked

- Wait until copying is finished.
- Close UVR if it is still writing the output.
- Avoid read-only, protected, or incompletely synchronized cloud locations.
- Select **Music Resource** and verify that Keysong opens the directory you are editing.

## 9. Updating, Moving, and Removing Keysong

### Update

1. Exit the old version.
2. Back up `Music Resources`.
3. Replace the old `.exe` while keeping the resource folder beside it.
4. Launch the new version and verify the playlist.

Upgrading from Cadence 0.1.0: the `Music Resources` folder is unchanged. Preferences are stored under the new name, so playback order, the chosen stem, and the typing-speed calibration start fresh once. The calibration relearns within a minute of typing.

### Move to Another Computer or Directory

Copy both the `.exe` and the complete `Music Resources` folder. Keep paired stems together and preserve their relative layout.

### Remove

Keysong is portable. Exit it and delete the `.exe`; delete `Music Resources` separately only if you no longer need the music. A few interface preferences, such as playback order, and your best scores are stored by Electron/Chromium in the current Windows user's application-data directory and are not removed automatically with the portable file.

## 10. Music Rights

Keysong, UVR, and other separation tools do not grant rights to a recording. Confirm that you have permission to play, modify, and distribute the original recording, MIDI, and separated stems. Do not commit copyrighted songs or stems to the source repository. The project's `.gitignore` excludes common local-music and build directories, but always inspect the staged file list before publishing.
