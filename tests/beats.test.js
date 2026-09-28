import test from 'node:test';
import assert from 'node:assert/strict';
import {
  onsetEnvelope, onsetEnvelopeAsync, estimateTempo, findBeats, BeatGrid, MIN_BEATS,
} from '../src/engine/beats.js';
import { RATE, noise, mix, sound, click, clickTrack, groove } from './helpers/synth.js';

/** Seconds from t to the nearest of the given times. */
const distance = (t, times) => Math.min(...times.map((x) => Math.abs(t - x)));

test('the onset envelope peaks where the clicks are', () => {
  const { samples, beats } = clickTrack(120, 10);
  const { envelope, frameRate, delay } = onsetEnvelope(samples, RATE);
  assert.equal(frameRate, 100);
  const threshold = 0.5 * Math.max(...envelope);
  const peaks = [];
  for (let f = 1; f < envelope.length - 1; f++) {
    if (envelope[f] > threshold && envelope[f] >= envelope[f - 1] && envelope[f] > envelope[f + 1]) {
      peaks.push(f / frameRate + delay);
    }
  }
  assert.equal(peaks.length, beats.length);
  for (const peak of peaks) assert.ok(distance(peak, beats) < 0.015, `peak at ${peak} is off the grid`);
});

test('the chunked envelope matches the one-shot envelope', async () => {
  const { samples } = clickTrack(100, 12);
  const whole = onsetEnvelope(samples, RATE);
  const chunked = await onsetEnvelopeAsync(samples, RATE, { chunkFrames: 97 });
  assert.equal(chunked.envelope.length, whole.envelope.length);
  assert.deepEqual(chunked.envelope, whole.envelope);
  assert.equal(chunked.delay, whole.delay);
});

test('tempo comes from the autocorrelation of the envelope', () => {
  const tempo = estimateTempo(onsetEnvelope(clickTrack(120).samples, RATE).envelope);
  assert.ok(Math.abs(tempo.bpm - 120) < 1, `estimated ${tempo.bpm}`);
  assert.ok(tempo.periodicity > 0.5);
});

test('a click track yields a usable grid on the clicks', async () => {
  const { samples, beats } = clickTrack(120);
  const grid = await findBeats(onsetEnvelope(samples, RATE));
  assert.ok(grid.usable);
  assert.ok(Math.abs(grid.bpm - 120) < 1, `bpm ${grid.bpm}`);
  assert.equal(grid.times.length, beats.length);
  for (const t of grid.times) assert.ok(distance(t, beats) < 0.03, `beat at ${t} missed the clicks`);
});

test('a drum groove is tracked on its quarter notes', async () => {
  const { samples, beats } = groove(100);
  const grid = await findBeats(onsetEnvelope(samples, RATE));
  assert.ok(grid.usable);
  assert.ok(Math.abs(grid.bpm - 100) < 1, `bpm ${grid.bpm}`);
  const onBeat = [...grid.times].filter((t) => distance(t, beats) < 0.03).length;
  assert.ok(onBeat / grid.times.length > 0.95, `${onBeat} of ${grid.times.length} beats on the pulse`);
});

test('across tempos the grid is the pulse or an octave of it, never a dotted or triplet level', async () => {
  for (const bpm of [66, 92, 118, 142, 170]) {
    const { samples, beats } = groove(bpm, { seed: bpm });
    const grid = await findBeats(onsetEnvelope(samples, RATE));
    assert.ok(grid.usable, `${bpm} BPM should be usable`);
    const ratio = grid.bpm / bpm;
    assert.ok([0.5, 1, 2].some((octave) => Math.abs(ratio - octave) < 0.02),
      `${bpm} BPM tracked at ${grid.bpm.toFixed(1)}`);

    // Beats at double time land on the eighth notes between beats as well.
    const pulse = ratio > 1.5 ? beats.flatMap((t) => [t, t + 30 / bpm]) : beats;
    const onPulse = [...grid.times].filter((t) => distance(t, pulse) < 0.03).length;
    assert.ok(onPulse / grid.times.length > 0.95, `${bpm} BPM: ${onPulse} of ${grid.times.length} on the pulse`);
  }
});

test('noise, a sustained pad, and random clicks are not usable grids', async () => {
  const random = noise(3);
  let level = 0.2;
  const hiss = sound(30, (t) => {
    if (Math.round(t * RATE) % 400 === 0) level = 0.05 + 0.15 * (random() + 1);
    return level * random();
  });
  const pad = sound(30, (t) => 0.1 * Math.min(1, (t % 2.7) / 0.8) * Math.sin(2 * Math.PI * 220 * t));
  const scattered = new Float32Array(30 * RATE);
  const pick = noise(11);
  for (let t = 0.3; t < 29.8; t += 0.05 + 0.6 * (pick() + 1) / 2) mix(scattered, t, click());

  for (const [name, samples] of [['noise', hiss], ['pad', pad], ['random clicks', scattered]]) {
    const grid = await findBeats(onsetEnvelope(samples, RATE));
    assert.ok(!grid?.usable, `${name} should not produce a usable grid`);
  }
});

test('silence and very short input do not throw', async () => {
  assert.equal(await findBeats(onsetEnvelope(new Float32Array(RATE * 5), RATE)), null);
  assert.equal(await findBeats(onsetEnvelope(new Float32Array(100), RATE)), null);
});

test('grid lookups find the surrounding beats', () => {
  const grid = new BeatGrid(Float64Array.from({ length: 10 }, (_, i) => 1 + i * 0.5), { bpm: 120, periodicity: 0.9 });
  assert.equal(grid.indexAt(0.5), -1);
  assert.equal(grid.indexAt(1), 0);
  assert.equal(grid.indexAt(1.74), 1);
  assert.equal(grid.next(0.2), 1);
  assert.equal(grid.next(1.2), 1.5);
  assert.equal(grid.next(5.5), null);
  assert.ok(Math.abs(grid.offset(1.54) - 0.04) < 1e-9, 'late is positive');
  assert.ok(Math.abs(grid.offset(1.96) + 0.04) < 1e-9, 'early is negative');
  assert.ok(grid.inTime(2.05));
  assert.ok(!grid.inTime(2.25));
});

test('a grid is usable only when long and regular enough', () => {
  const times = (n) => Float64Array.from({ length: n }, (_, i) => i * 0.5);
  assert.ok(new BeatGrid(times(MIN_BEATS), { bpm: 120, periodicity: 0.5 }).usable);
  assert.ok(!new BeatGrid(times(MIN_BEATS - 1), { bpm: 120, periodicity: 0.5 }).usable);
  assert.ok(!new BeatGrid(times(40), { bpm: 120, periodicity: 0.05 }).usable);
});
