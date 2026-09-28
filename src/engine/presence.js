/**
 * Where a stem actually has something to reveal.
 *
 * A separated stem is silent, or close to it, for long stretches: during an
 * intro or a solo a vocal stem holds only the faint bleed the separator left
 * behind. Typing cannot reveal what is not there, so the feedback layer needs
 * this map to tell a break from a missed cue, and to score a performance
 * against what could actually be heard.
 *
 * Everything here works on plain arrays, so it is tested without Web Audio.
 */

/** Level frames are 50 ms: fine enough for syllables, cheap enough to keep. */
export const FRAME_SECONDS = 0.05;

/**
 * RMS level per frame, across every channel.
 *
 * @param channels One Float32Array per channel, all the same length.
 * @param sampleRate Samples per second.
 * @param options.stride Read every nth sample. A level needs far fewer samples
 *   than the waveform has, and a four-minute stereo stem is ten million.
 * @returns {{ rms: Float32Array, frameRate: number }}
 */
export function levelEnvelope(channels, sampleRate, { frame = FRAME_SECONDS, stride = 4 } = {}) {
  const length = channels.length ? channels[0].length : 0;
  const size = Math.max(1, Math.round(sampleRate * frame));
  const frames = Math.ceil(length / size);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * size;
    const end = Math.min(length, start + size);
    let energy = 0;
    let count = 0;
    for (const data of channels) {
      for (let i = start; i < end; i += stride) {
        energy += data[i] * data[i];
        count++;
      }
    }
    rms[f] = count ? Math.sqrt(energy / count) : 0;
  }
  return { rms, frameRate: sampleRate / size };
}

const toDb = (level) => (level > 0 ? 20 * Math.log10(level) : -Infinity);

/**
 * Map a level envelope to presence in 0..1.
 *
 * Levels are judged against the stem itself rather than one fixed threshold,
 * so a whispered ballad vocal and a belted one both read as present while
 * separator bleed reads as absent. Two references set the bar: the stem's
 * loud level, and its noise floor, the level of its quietest tenth. Content
 * must clear the floor by a margin, and anything close to the loud level
 * always counts.
 *
 * @param options.floorDb Anything quieter is never content.
 * @param options.emptyDb A stem whose loud frames stay below this holds only
 *   bleed, and has no content anywhere. Real parts in a mastered song peak
 *   well above it.
 * @param options.belowPeakDb How far under the loud level content may sit.
 * @param options.aboveNoiseDb How far over the noise floor content must sit.
 * @param options.softDb Width of the ramp from absent to present.
 * @param options.holdFrames Bridge this many frames either side of content,
 *   so the gaps between syllables do not flicker.
 */
export function presenceFromLevels(rms, {
  floorDb = -50,
  emptyDb = -36,
  belowPeakDb = 20,
  aboveNoiseDb = 10,
  softDb = 6,
  holdFrames = 2,
} = {}) {
  const n = rms.length;
  const presence = new Float32Array(n);
  const db = Float32Array.from(rms, toDb);

  const audible = db.filter((value) => value > floorDb).sort();
  if (!audible.length) return presence;
  const reference = audible[Math.floor((audible.length - 1) * 0.95)];
  if (reference < emptyDb) return presence;

  const everything = Float32Array.from(db, (value) => Math.max(value, -120)).sort();
  const noise = everything[Math.floor((n - 1) * 0.1)];
  const threshold = Math.max(floorDb,
    Math.min(reference - 10, Math.max(reference - belowPeakDb, noise + aboveNoiseDb)));
  const low = threshold - softDb / 2;
  for (let i = 0; i < n; i++) {
    presence[i] = Math.min(1, Math.max(0, (db[i] - low) / softDb));
  }
  return dilate(presence, holdFrames);
}

/** Running maximum over ±radius frames. */
function dilate(values, radius) {
  if (radius <= 0) return values;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let peak = 0;
    const end = Math.min(values.length - 1, i + radius);
    for (let j = Math.max(0, i - radius); j <= end; j++) {
      if (values[j] > peak) peak = values[j];
    }
    out[i] = peak;
  }
  return out;
}

/**
 * Group present frames into phrases, bridging breaths and dropping blips.
 *
 * @returns {{ start: number, end: number }[]} Seconds, in order.
 */
export function findPhrases(presence, frameRate, { threshold = 0.5, bridge = 0.8, minLength = 0.35 } = {}) {
  const runs = [];
  let start = -1;
  for (let f = 0; f <= presence.length; f++) {
    const on = f < presence.length && presence[f] >= threshold;
    if (on && start < 0) start = f;
    else if (!on && start >= 0) {
      runs.push({ start: start / frameRate, end: f / frameRate });
      start = -1;
    }
  }

  const phrases = [];
  for (const run of runs) {
    const last = phrases.at(-1);
    if (last && run.start - last.end <= bridge) last.end = run.end;
    else phrases.push({ ...run });
  }
  return phrases.filter((phrase) => phrase.end - phrase.start >= minLength);
}

/**
 * Presence and phrases for one stem.
 *
 * @param buffer An AudioBuffer, or anything with numberOfChannels, sampleRate,
 *   and getChannelData().
 */
export function analyzePresence(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const { rms, frameRate } = levelEnvelope(channels, buffer.sampleRate);
  const values = presenceFromLevels(rms);
  return { values, frameRate, phrases: findPhrases(values, frameRate) };
}
