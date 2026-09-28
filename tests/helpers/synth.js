/**
 * Synthetic test material at the 8 kHz analysis rate: click tracks, a drum
 * groove, and the pieces they are built from. Every source of randomness is
 * seeded, so each run hears exactly the same signal.
 */
export const RATE = 8000;

export function noise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 4294967296) * 2 - 1;
  };
}

export function mix(out, at, burst) {
  const start = Math.round(at * RATE);
  for (let i = 0; i < burst.length && start + i < out.length; i++) out[start + i] += burst[i];
}

export function sound(seconds, shape) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = shape(i / RATE);
  return out;
}

export const click = () => sound(0.006, (t) => (Math.round(t * RATE) % 2 ? -0.8 : 0.8) * Math.exp(-t * 600));

const kick = () => {
  let phase = 0;
  return sound(0.16, (t) => {
    phase += (2 * Math.PI * (45 + 70 * Math.exp(-t * 30))) / RATE;
    return 0.9 * Math.sin(phase) * Math.exp(-t * 18);
  });
};
const snare = (random) => sound(0.14, (t) => 0.5 * random() * Math.exp(-t * 22)
  + 0.3 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30));
const hat = (random) => sound(0.035, (t) => 0.18 * random() * Math.exp(-t * 90));

/** A click on every beat. */
export function clickTrack(bpm, seconds = 30, lead = 0.5) {
  const samples = new Float32Array(seconds * RATE);
  const beats = [];
  for (let t = lead; t < seconds - 0.2; t += 60 / bpm) {
    beats.push(t);
    mix(samples, t, click());
  }
  return { samples, beats };
}

/** Kick on one and three, snare on two and four, hi-hats on every eighth, a pad. */
export function groove(bpm, { seconds = 36, seed = 7 } = {}) {
  const random = noise(seed);
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = 0.01 * random() + 0.05 * Math.sin(2 * Math.PI * 220 * t) + 0.05 * Math.sin(2 * Math.PI * 330 * t);
  }
  const beat = 60 / bpm;
  const beats = [];
  for (let b = 0, t = 1; t < seconds - 0.3; b++, t = 1 + b * beat) {
    beats.push(t);
    mix(samples, t, b % 2 === 0 ? kick() : snare(random));
    mix(samples, t, hat(random));
    mix(samples, t + beat / 2, hat(random));
  }
  return { samples, beats };
}

/** An AudioBuffer stand-in over mono samples. */
export function monoBuffer(samples, sampleRate = RATE) {
  return {
    numberOfChannels: 1,
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    getChannelData: () => samples,
  };
}
