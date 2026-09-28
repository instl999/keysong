import { fft } from './keydetect.js';

/**
 * Beat tracking for the feedback layer.
 *
 * Knowing where the song's pulse falls lets the gate hold a revealed stem
 * through to the next beat and release on it, and lets a typist who plays
 * along see when a keystroke lands in time. The method is the dynamic
 * programming tracker of Ellis (2007), in the form librosa made standard:
 *
 * 1. An onset-strength envelope from log-compressed spectral flux.
 * 2. One tempo for the song, from the envelope's autocorrelation, weighted
 *    by a log-normal prior around 120 BPM.
 * 3. The beat sequence that best trades landing on strong onsets against
 *    keeping a steady period.
 *
 * Autocorrelation alone cannot tell the beat from the other levels of the
 * meter: a groove with steady eighth-note hi-hats correlates almost as well at
 * one and a half beats as at one. So the metrical relatives of the best lag
 * are each tracked, and the level whose beats land on the strongest onsets
 * wins. What remains is at worst an octave error, half or double time, which
 * still keeps every beat on the pulse.
 *
 * A grid that is not clearly periodic is reported as unusable rather than
 * guessed at. Every function is pure and works on plain arrays, so the tracker
 * is tested in Node with synthetic signals.
 */

/** Onset envelope frames per second. */
export const ONSET_RATE = 100;

/** 32 ms at the 8 kHz analysis rate: short enough to place a drum hit. */
const FFT_SIZE = 256;

/** Log compression, as in log(1 + γ|X|): quiet attacks still register. */
const COMPRESSION = 100;

/** Fewer beats than this is not a grid worth trusting. */
export const MIN_BEATS = 8;

/**
 * Autocorrelation at the beat period, relative to lag zero, below which the
 * grid is not used. Steady grooves measure 0.3 and up even under heavy noise;
 * noise, sustained pads, and random clicks stay near 0.1 or under.
 */
export const MIN_PERIODICITY = 0.2;

/** Beats this far either side of a keystroke still count as in time. */
export const IN_TIME_SECONDS = 0.07;

/**
 * Metrical relatives of the best lag, tried as the beat period: the best lag
 * may itself be a half, double, dotted, or triplet relative of the beat.
 */
const METRICAL_LEVELS = [1, 0.5, 2, 2 / 3, 4 / 3, 1.5, 0.75];

const tempoPrior = (bpm, centerBpm = 120, spreadOctaves = 1) =>
  Math.exp(-0.5 * (Math.log2(bpm / centerBpm) / spreadOctaves) ** 2);

function onsetPlan(sampleRate, frameRate, size) {
  const hop = Math.max(1, Math.round(sampleRate / frameRate));
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return {
    hop,
    size,
    half: size >> 1,
    window,
    re: new Float64Array(size),
    im: new Float64Array(size),
    previous: new Float64Array(size >> 1),
  };
}

const frameCount = (length, { hop, size }) => (length >= size ? Math.floor((length - size) / hop) + 1 : 0);

/** Fold frames [from, to) of the signal into the envelope. */
function fluxFrames(samples, plan, out, from, to) {
  const { hop, size, half, window, re, im, previous } = plan;
  for (let f = from; f < to; f++) {
    const pos = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[pos + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < half; k++) {
      const magnitude = Math.log1p(COMPRESSION * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const rise = magnitude - previous[k];
      if (rise > 0) flux += rise;
      previous[k] = magnitude;
    }
    // The first frame has nothing to rise from, so its "flux" is just level.
    out[f] = f === 0 ? 0 : flux;
  }
}

/**
 * Seconds from the start of frame f's window to the attack it reports. The
 * flux jumps as soon as an attack enters the window, in its last hop, rather
 * than when it reaches the centre. Measured on synthetic clicks and drums.
 */
function onsetDelay(sampleRate, { hop, size }) {
  return (size - hop) / sampleRate;
}

/**
 * Onset strength at ONSET_RATE frames per second.
 *
 * @param samples Mono samples, ideally at the 8 kHz analysis rate.
 * @returns {{ envelope: Float32Array, frameRate: number, delay: number }}
 *   `delay` converts a frame index to seconds: t = f / frameRate + delay.
 */
export function onsetEnvelope(samples, sampleRate, { frameRate = ONSET_RATE } = {}) {
  const plan = onsetPlan(sampleRate, frameRate, FFT_SIZE);
  const frames = frameCount(samples.length, plan);
  const envelope = new Float32Array(frames);
  fluxFrames(samples, plan, envelope, 0, frames);
  return { envelope, frameRate: sampleRate / plan.hop, delay: onsetDelay(sampleRate, plan) };
}

/** The same envelope, yielding between chunks so the window keeps painting. */
export async function onsetEnvelopeAsync(samples, sampleRate, { frameRate = ONSET_RATE, chunkFrames = 1500 } = {}) {
  const plan = onsetPlan(sampleRate, frameRate, FFT_SIZE);
  const frames = frameCount(samples.length, plan);
  const envelope = new Float32Array(frames);
  for (let from = 0; from < frames; from += chunkFrames) {
    fluxFrames(samples, plan, envelope, from, Math.min(frames, from + chunkFrames));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { envelope, frameRate: sampleRate / plan.hop, delay: onsetDelay(sampleRate, plan) };
}

/**
 * The song's tempo, from the autocorrelation of its onset envelope.
 *
 * @returns {{ bpm: number, period: number, periodicity: number, at: (lag: number) => number } | null}
 *   `period` is in envelope frames and may be fractional; `periodicity` is the
 *   autocorrelation there, relative to lag zero, and `at` reads it at any lag
 *   in range.
 */
export function estimateTempo(envelope, frameRate = ONSET_RATE, { minBpm = 60, maxBpm = 200 } = {}) {
  const n = envelope.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n || 1;

  // Remove the mean so the autocorrelation measures periodicity, not loudness.
  const x = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = envelope[i] - mean;
    energy += x[i] * x[i];
  }
  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(n - 2, Math.ceil((60 * frameRate) / minBpm));
  if (!(energy > 0) || maxLag <= minLag) return null;

  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += x[i] * x[i - lag];
    ac[lag] = sum / energy;
  }

  let bestLag = -1;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = ac[lag];
    if (!(value > 0) || value < ac[lag - 1] || value < ac[lag + 1]) continue;
    const score = value * tempoPrior((60 * frameRate) / lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  // Place the peak between frames on the parabola through it and its neighbours.
  const a = ac[bestLag - 1];
  const b = ac[bestLag];
  const c = ac[bestLag + 1];
  const curve = a - 2 * b + c;
  const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
  const period = bestLag + shift;

  // Read the strongest correlation within a frame of a lag, so a period that
  // falls between frames is not undersold.
  const at = (lag) => {
    const centre = Math.round(lag);
    let value = 0;
    for (let l = Math.max(minLag - 1, centre - 1); l <= Math.min(maxLag + 1, centre + 1); l++) {
      value = Math.max(value, ac[l]);
    }
    return value;
  };
  return { bpm: (60 * frameRate) / period, period, periodicity: b, at };
}

/**
 * The beat sequence that best balances strong onsets against a steady period.
 *
 * @param period Beat period in envelope frames.
 * @param options.tightness How hard the tracker resists deviating from the
 *   period. librosa's default, which suits music with a steady pulse.
 * @returns {Int32Array} Beat positions, in envelope frames.
 */
export function trackBeats(envelope, period, { tightness = 100 } = {}) {
  const n = envelope.length;
  const none = new Int32Array(0);
  if (!n || !(period > 1)) return none;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (envelope[i] - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, n - 1));
  if (!(std > 0)) return none;

  // Local score: the normalised envelope, smoothed a thirty-second of a beat.
  const sigma = period / 32;
  const radius = Math.max(1, Math.ceil(4 * sigma));
  const kernel = new Float64Array(2 * radius + 1);
  for (let i = -radius; i <= radius; i++) kernel[i + radius] = Math.exp(-0.5 * (i / sigma) ** 2);
  const local = new Float64Array(n);
  let peak = 0;
  for (let t = 0; t < n; t++) {
    let sum = 0;
    const end = Math.min(n - 1, t + radius);
    for (let j = Math.max(0, t - radius); j <= end; j++) sum += envelope[j] * kernel[j - t + radius];
    local[t] = sum / std;
    if (local[t] > peak) peak = local[t];
  }

  // Cumulative score, and where each frame's best previous beat was.
  const shortest = Math.max(1, Math.round(period / 2));
  const longest = Math.max(shortest, Math.round(period * 2));
  const penalty = new Float64Array(longest + 1);
  for (let d = shortest; d <= longest; d++) penalty[d] = -tightness * Math.log(d / period) ** 2;

  const cumulative = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const firstOnset = 0.01 * peak;
  let started = false;
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let from = -1;
    for (let d = shortest; d <= longest; d++) {
      const previous = t - d;
      const value = (previous >= 0 ? cumulative[previous] : 0) + penalty[d];
      if (value > best) {
        best = value;
        from = previous;
      }
    }
    cumulative[t] = local[t] + best;
    // Nothing before the first real onset may start a chain of beats.
    if (!started && local[t] < firstOnset) continue;
    started = true;
    backlink[t] = from;
  }

  // The last beat is the last local maximum of the cumulative score that is
  // not much weaker than a typical one.
  const maxima = [];
  for (let t = 1; t < n - 1; t++) {
    if (cumulative[t] > cumulative[t - 1] && cumulative[t] >= cumulative[t + 1]) maxima.push(t);
  }
  if (!maxima.length) return none;
  const ranked = maxima.map((t) => cumulative[t]).sort((p, q) => p - q);
  const median = ranked[ranked.length >> 1];
  let last = -1;
  for (let i = maxima.length - 1; i >= 0 && last < 0; i--) {
    if (2 * cumulative[maxima[i]] > median) last = maxima[i];
  }
  if (last < 0) return none;

  const chain = [last];
  while (backlink[chain.at(-1)] >= 0) chain.push(backlink[chain.at(-1)]);
  chain.reverse();

  // Trim beats at either end that land on nothing, such as the silence before
  // the song starts and after it ends.
  const strength = chain.map((t) => local[t]);
  const smooth = strength.map((_, i) => 0.5 * (strength[i - 1] ?? 0) + strength[i] + 0.5 * (strength[i + 1] ?? 0));
  const rms = Math.sqrt(smooth.reduce((sum, value) => sum + value * value, 0) / smooth.length);
  const keep = smooth.map((value) => value > 0.5 * rms);
  const first = keep.indexOf(true);
  const end = keep.lastIndexOf(true);
  return first < 0 ? none : Int32Array.from(chain.slice(first, end + 1));
}

/**
 * How strongly a beat sequence lands on onsets: the envelope's peak within two
 * frames of each beat, averaged, over the envelope's mean. Measured on the raw
 * envelope, so sequences tracked at different periods compare fairly.
 */
export function beatSalience(envelope, frames) {
  if (!frames.length || !envelope.length) return 0;
  let mean = 0;
  for (let i = 0; i < envelope.length; i++) mean += envelope[i];
  mean /= envelope.length;
  if (!(mean > 0)) return 0;

  let onBeats = 0;
  for (const frame of frames) {
    let peak = 0;
    const end = Math.min(envelope.length - 1, frame + 2);
    for (let j = Math.max(0, frame - 2); j <= end; j++) peak = Math.max(peak, envelope[j]);
    onBeats += peak;
  }
  return onBeats / frames.length / mean;
}

/** Beat times for a song, and how far to trust them. */
export class BeatGrid {
  /**
   * @param times Beat times in seconds, ascending.
   */
  constructor(times, { bpm = 0, periodicity = 0 } = {}) {
    this.times = times;
    this.bpm = bpm;
    this.period = bpm > 0 ? 60 / bpm : 0;
    this.periodicity = periodicity;
  }

  /** Long enough, and regular enough, to act on. */
  get usable() {
    return this.times.length >= MIN_BEATS && this.periodicity >= MIN_PERIODICITY;
  }

  /** Index of the last beat at or before t, or -1 when t precedes them all. */
  indexAt(t) {
    const { times } = this;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  /** The first beat after t, or null past the last one. */
  next(t) {
    const i = this.indexAt(t) + 1;
    return i < this.times.length ? this.times[i] : null;
  }

  /** Signed seconds from the nearest beat to t: negative is early, positive late. */
  offset(t) {
    const i = this.indexAt(t);
    const late = i >= 0 ? t - this.times[i] : Infinity;
    const early = i + 1 < this.times.length ? this.times[i + 1] - t : Infinity;
    return late <= early ? late : -early;
  }

  /** Whether t lands close enough to a beat to count as playing in time. */
  inTime(t) {
    const window = Math.min(IN_TIME_SECONDS, this.period * 0.12);
    return Math.abs(this.offset(t)) <= window;
  }
}

/**
 * Tempo and beats from an onset envelope. Each metrical level is a full
 * tracking pass, so the event loop gets a turn between them.
 *
 * @returns {Promise<BeatGrid | null>} Null when the envelope has no
 *   periodicity at all.
 */
export async function findBeats({ envelope, frameRate = ONSET_RATE, delay = 0 }, { minBpm = 60, maxBpm = 200 } = {}) {
  const tempo = estimateTempo(envelope, frameRate, { minBpm, maxBpm });
  if (!tempo) return null;

  let best = null;
  for (const level of METRICAL_LEVELS) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const period = tempo.period * level;
    const bpm = (60 * frameRate) / period;
    if (bpm < minBpm || bpm > maxBpm) continue;
    // A level the signal does not repeat at would only be tracked by
    // alternating long and short gaps between strong hits.
    if (tempo.at(period) < 0.5 * tempo.periodicity) continue;
    const frames = trackBeats(envelope, period);
    const score = beatSalience(envelope, frames) * tempoPrior(bpm);
    if (!best || score > best.score) best = { score, frames, bpm, period };
  }
  if (!best) return null;

  const times = Float64Array.from(best.frames, (frame) => frame / frameRate + delay);
  return new BeatGrid(times, { bpm: best.bpm, periodicity: tempo.at(best.period) });
}
