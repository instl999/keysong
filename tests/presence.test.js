import test from 'node:test';
import assert from 'node:assert/strict';
import { levelEnvelope, presenceFromLevels, findPhrases, analyzePresence, FRAME_SECONDS } from '../src/engine/presence.js';

const RATE = 8000;

/**
 * A stereo "stem": a tone wherever a segment says so, and faint noise-like
 * bleed everywhere else. Segments are [startSeconds, endSeconds, amplitude].
 */
function stem(seconds, segments, { bleed = 0.0126 } = {}) {
  const length = Math.round(seconds * RATE);
  const left = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    // Deterministic and broadband. The default sits near -44 dBFS RMS, the
    // level separator bleed commonly reaches.
    left[i] = bleed * Math.sin(i * 1.7) * Math.sin(i * 0.31);
    for (const [start, end, amplitude] of segments) {
      if (t >= start && t < end) left[i] += amplitude * Math.sin(2 * Math.PI * 220 * t);
    }
  }
  const right = Float32Array.from(left);
  return {
    numberOfChannels: 2,
    sampleRate: RATE,
    getChannelData: (channel) => (channel === 0 ? left : right),
  };
}

const at = (values, frameRate, seconds) => values[Math.floor(seconds * frameRate)];

test('the level envelope measures RMS per frame', () => {
  const length = RATE;
  const full = new Float32Array(length).fill(0.5);
  const { rms, frameRate } = levelEnvelope([full], RATE, { stride: 1 });
  assert.equal(frameRate, 1 / FRAME_SECONDS);
  assert.equal(rms.length, 20);
  for (const level of rms) assert.ok(Math.abs(level - 0.5) < 1e-6);
});

test('a partial last frame is measured over the samples it has', () => {
  const samples = new Float32Array(RATE * 0.075).fill(0.25);   // One and a half frames.
  const { rms } = levelEnvelope([samples], RATE, { stride: 1 });
  assert.equal(rms.length, 2);
  assert.ok(Math.abs(rms[1] - 0.25) < 1e-6);
});

test('an empty buffer has no frames', () => {
  assert.equal(levelEnvelope([new Float32Array(0)], RATE).rms.length, 0);
  assert.equal(levelEnvelope([], RATE).rms.length, 0);
});

test('content reads as present and separator bleed does not', () => {
  const { values, frameRate } = analyzePresence(stem(10, [[2, 5, 0.3]]));
  assert.equal(at(values, frameRate, 1), 0, 'bleed before the phrase');
  assert.equal(at(values, frameRate, 3.5), 1, 'the phrase itself');
  assert.equal(at(values, frameRate, 8), 0, 'bleed after the phrase');
});

test('a quiet singer is judged against their own loudness', () => {
  // About -26 dBFS: only 18 dB over the bleed, so a bar set by loudness alone
  // would count the bleed as singing too.
  const { values, frameRate } = analyzePresence(stem(10, [[2, 5, 0.07]]));
  assert.equal(at(values, frameRate, 3.5), 1);
  assert.equal(at(values, frameRate, 8), 0);
});

test('soft passages still count when the gaps are digital silence', () => {
  const { values, frameRate } = analyzePresence(stem(12, [[1, 4, 0.3], [6, 9, 0.053]], { bleed: 0 }));
  assert.equal(at(values, frameRate, 2.5), 1, 'the loud phrase');
  assert.equal(at(values, frameRate, 7.5), 1, 'a phrase 15 dB softer');
  assert.equal(at(values, frameRate, 11), 0, 'silence');
});

test('a stem that holds only bleed has no content anywhere', () => {
  const { values, phrases } = analyzePresence(stem(6, [], { bleed: 0.02 }));
  assert.ok(values.every((value) => value === 0));
  assert.deepEqual(phrases, []);
});

test('digital silence has no content', () => {
  const values = presenceFromLevels(new Float32Array(100));
  assert.ok(values.every((value) => value === 0));
});

test('phrases bridge breaths but not real breaks', () => {
  const { phrases } = analyzePresence(stem(20, [
    [1, 3, 0.3], [3.4, 5, 0.3],     // A breath of 0.4 s: one phrase.
    [9, 12, 0.3],                   // Four seconds later: a new phrase.
  ]));
  assert.equal(phrases.length, 2);
  assert.ok(Math.abs(phrases[0].start - 1) < 0.15, `first phrase starts at ${phrases[0].start}`);
  assert.ok(Math.abs(phrases[0].end - 5) < 0.15, `first phrase ends at ${phrases[0].end}`);
  assert.ok(Math.abs(phrases[1].start - 9) < 0.15, `second phrase starts at ${phrases[1].start}`);
});

test('a blip too short to sing along to is not a phrase', () => {
  const frameRate = 20;
  const presence = new Float32Array(200);
  presence.fill(1, 50, 52);             // 100 ms
  presence.fill(1, 100, 140);           // 2 s
  const phrases = findPhrases(presence, frameRate);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].start, 5);
  assert.equal(phrases[0].end, 7);
});

test('a phrase that runs to the end of the stem is closed', () => {
  const presence = new Float32Array(40);
  presence.fill(1, 20);
  assert.deepEqual(findPhrases(presence, 20), [{ start: 1, end: 2 }]);
});
