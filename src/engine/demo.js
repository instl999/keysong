import { demoScore } from './demo-score.js';

/**
 * Synthesizes the demo's four stems with an OfflineAudioContext each: a sung
 * lead for the vocals, drums, bass, and chords. The demo ships as a score of
 * a few kilobytes instead of megabytes of audio.
 *
 * Each part is a handful of long-lived voices whose pitch and level are
 * automated note by note, not a node per note. An offline graph processes
 * every connected node for the whole song, even before it starts, so a node
 * per note made rendering take fifteen seconds; voices make it a fraction of
 * one. Every part but the pad plays one note at a time, so nothing is lost.
 *
 * Levels are set so the four stems summed stay below full scale, as the
 * stems of a mastered song do. Every source of noise is seeded, so the demo
 * renders identically every time.
 */

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const QUIET = 0.0001;   // Exponential ramps cannot reach zero.

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function noiseBuffer(ctx, seconds, seed) {
  const random = seeded(seed);
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return buffer;
}

/** Route `input` to the destination dry, and through a small room at `mix`. */
function withRoom(ctx, input, { seconds, mix, seed }) {
  input.connect(ctx.destination);
  const impulse = noiseBuffer(ctx, seconds, seed);
  const data = impulse.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] *= (1 - i / data.length) ** 4;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = mix;
  input.connect(reverb);
  reverb.connect(wet);
  wet.connect(ctx.destination);
}

function oscillator(ctx, type, destination) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.connect(destination);
  osc.start(0);
  return osc;
}

/** A gain that starts silent, for a voice's envelope. */
function silentGain(ctx, destination) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(destination);
  return gain;
}

/**
 * When each note of a one-note-at-a-time line must be silent again: after
 * its release, but never later than just before the next note begins.
 */
function releaseEnds(notes, release) {
  return notes.map((note, i) => {
    const end = note.time + note.duration * 0.9;
    const next = notes[i + 1]?.time ?? Infinity;
    return { end, silent: Math.max(end + 0.01, Math.min(end + release, next - 0.004)) };
  });
}

/** The lead: a filtered saw over a sine, with a singer's delayed vibrato. */
function renderVocals(ctx, melody) {
  const voice = ctx.createBiquadFilter();
  voice.type = 'lowpass';
  voice.frequency.value = 2400;
  voice.Q.value = 0.7;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1100;
  presence.Q.value = 1.4;
  presence.gain.value = 5;
  voice.connect(presence);
  withRoom(ctx, presence, { seconds: 1.8, mix: 0.2, seed: 11 });

  const amp = silentGain(ctx, voice);
  const sawLevel = ctx.createGain();
  sawLevel.gain.value = 0.15;
  sawLevel.connect(amp);
  const sineLevel = ctx.createGain();
  sineLevel.gain.value = 0.12;
  sineLevel.connect(amp);
  const saw = oscillator(ctx, 'sawtooth', sawLevel);
  const sine = oscillator(ctx, 'sine', sineLevel);
  const depth = ctx.createGain();
  depth.gain.value = 0;
  oscillator(ctx, 'sine', depth).frequency.value = 5.2;
  depth.connect(saw.detune);
  depth.connect(sine.detune);

  const ends = releaseEnds(melody, 0.12);
  melody.forEach((note, i) => {
    const { end, silent } = ends[i];
    const attack = Math.min(0.05, (end - note.time) / 2);
    for (const osc of [saw, sine]) osc.frequency.setValueAtTime(midiHz(note.midi), note.time);
    amp.gain.setValueAtTime(0, note.time);
    amp.gain.linearRampToValueAtTime(1, note.time + attack);
    amp.gain.setValueAtTime(1, end);
    amp.gain.linearRampToValueAtTime(0, silent);
    // Vibrato settles in after the attack, as a singer's does. In cents.
    depth.gain.setValueAtTime(0, note.time);
    depth.gain.linearRampToValueAtTime(Math.min(14, 35 * (end - note.time)), Math.min(end, note.time + 0.4));
  });
  return ctx.startRendering();
}

function renderDrums(ctx, hits) {
  const bus = ctx.createGain();
  bus.connect(ctx.destination);

  // Noise voices: one looping noise source each, filtered and gated per hit.
  const noise = noiseBuffer(ctx, 1.5, 23);
  const noiseVoice = (type, frequency, offset) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = silentGain(ctx, bus);
    source.connect(filter);
    filter.connect(amp);
    source.start(0, offset);
    return amp.gain;
  };
  const voices = {
    snare: noiseVoice('highpass', 1400, 0.1),
    hat: noiseVoice('highpass', 7500, 0.6),
    crash: noiseVoice('highpass', 4800, 1.1),
  };
  const kickAmp = silentGain(ctx, bus);
  const kick = oscillator(ctx, 'sine', kickAmp);
  const toneAmp = silentGain(ctx, bus);
  oscillator(ctx, 'triangle', toneAmp).frequency.value = 185;

  // A hit decays fully unless the same voice strikes again first.
  const strike = (gain, time, level, decay, next) => {
    gain.setValueAtTime(level, time);
    gain.exponentialRampToValueAtTime(QUIET, time + Math.min(decay, next - time - 0.004));
  };
  const nextOf = (kind, index) => hits.slice(index + 1).find((h) => h.kind === kind)?.time ?? Infinity;

  hits.forEach(({ time, kind, level }, index) => {
    const next = nextOf(kind, index);
    if (kind === 'kick') {
      kick.frequency.setValueAtTime(140, time);
      kick.frequency.exponentialRampToValueAtTime(44, time + 0.14);
      kickAmp.gain.setValueAtTime(QUIET, time);
      kickAmp.gain.exponentialRampToValueAtTime(0.34 * level, time + 0.004);
      kickAmp.gain.exponentialRampToValueAtTime(QUIET, time + Math.min(0.42, next - time - 0.004));
    } else if (kind === 'snare') {
      strike(voices.snare, time, 0.2 * level, 0.2, next);
      strike(toneAmp.gain, time, 0.14 * level, 0.1, next);
    } else if (kind === 'hat') {
      strike(voices.hat, time, 0.05 * level, 0.05, next);
    } else if (kind === 'crash') {
      strike(voices.crash, time, 0.1 * level, 1.4, next);
    }
  });
  return ctx.startRendering();
}

/** A round bass: sine with a quieter octave above, plucked and low-passed. */
function renderBass(ctx, notes) {
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 700;
  tone.connect(ctx.destination);
  const amp = silentGain(ctx, tone);
  const octaveLevel = ctx.createGain();
  octaveLevel.gain.value = 0.25;
  octaveLevel.connect(amp);
  const root = oscillator(ctx, 'sine', amp);
  const octave = oscillator(ctx, 'triangle', octaveLevel);

  const ends = releaseEnds(notes, 0.06);
  notes.forEach((note, i) => {
    const { end, silent } = ends[i];
    root.frequency.setValueAtTime(midiHz(note.midi), note.time);
    octave.frequency.setValueAtTime(midiHz(note.midi) * 2, note.time);
    amp.gain.setValueAtTime(0, note.time);
    amp.gain.linearRampToValueAtTime(0.2, note.time + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.13, Math.min(end, note.time + 0.15));
    amp.gain.setValueAtTime(0.13, end);
    amp.gain.linearRampToValueAtTime(0, silent);
  });
  return ctx.startRendering();
}

/** A soft pad on every chord, and a plucked arpeggio where nobody sings. */
function renderOther(ctx, chords, arpeggio) {
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 1500;
  withRoom(ctx, warm, { seconds: 2.4, mix: 0.3, seed: 31 });

  // The pad: one voice per chord tone, gliding legato from chord to chord.
  const lanes = Math.max(...chords.map((chord) => chord.tones.length));
  for (let lane = 0; lane < lanes; lane++) {
    const amp = silentGain(ctx, warm);
    const pair = [-6, 6].map((cents) => {
      const osc = oscillator(ctx, 'sawtooth', amp);
      osc.detune.value = cents;
      return osc;
    });
    let sounding = false;
    chords.forEach((chord, i) => {
      const midi = chord.tones[lane];
      const next = chords[i + 1];
      if (midi === undefined) return;
      for (const osc of pair) osc.frequency.setTargetAtTime(midiHz(midi), chord.start, 0.015);
      if (!sounding) {
        amp.gain.setValueAtTime(0, chord.start);
        amp.gain.linearRampToValueAtTime(0.03, chord.start + 0.25);
        sounding = true;
      }
      // Fade out where this lane has nothing to play next, or the song ends.
      if (!next || next.tones[lane] === undefined || next.start - chord.end > 0.01) {
        amp.gain.setValueAtTime(0.03, chord.end);
        amp.gain.linearRampToValueAtTime(0, chord.end + 0.35);
        sounding = false;
      }
    });
  }

  const arp = silentGain(ctx, warm);
  const triangle = oscillator(ctx, 'triangle', arp);
  arpeggio.forEach((note, i) => {
    const next = arpeggio[i + 1]?.time ?? Infinity;
    triangle.frequency.setValueAtTime(midiHz(note.midi), note.time);
    arp.gain.setValueAtTime(0, note.time);
    arp.gain.linearRampToValueAtTime(0.13, note.time + 0.005);
    arp.gain.exponentialRampToValueAtTime(QUIET, note.time + Math.min(0.35, next - note.time - 0.004));
  });
  return ctx.startRendering();
}

/**
 * Render the demo's stems.
 *
 * @param sampleRate Match the playback context, so nothing is resampled.
 * @returns {Promise<Map<string, AudioBuffer>>} Keyed by stem role.
 */
export async function renderDemo(sampleRate, OfflineCtx = globalThis.OfflineAudioContext) {
  const score = demoScore();
  const length = Math.ceil(score.seconds * sampleRate);
  const context = () => new OfflineCtx(1, length, sampleRate);
  const [vocals, drums, bass, other] = await Promise.all([
    renderVocals(context(), score.melody),
    renderDrums(context(), score.drums),
    renderBass(context(), score.bass),
    renderOther(context(), score.chords, score.arpeggio),
  ]);
  return new Map([['vocals', vocals], ['drums', drums], ['bass', bass], ['other', other]]);
}
