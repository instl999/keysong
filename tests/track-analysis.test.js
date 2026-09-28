import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStems } from '../src/engine/track-analysis.js';
import { RATE, groove, monoBuffer } from './helpers/synth.js';

/**
 * Stands in for OfflineAudioContext. The stems here are already mono at the
 * analysis rate, so "rendering" hands back the source samples it was given.
 */
class PassThroughContext {
  constructor(channels, length) {
    this.length = length;
    this.destination = {};
  }

  createBufferSource() {
    const context = this;
    return {
      buffer: null,
      connect() {},
      start() { context.source = this; },
    };
  }

  async startRendering() {
    const data = this.source.buffer.getChannelData(0).subarray(0, this.length);
    return { getChannelData: () => data };
  }
}

/** A vocal that sings for the first and last thirds of the track. */
function vocal(seconds) {
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    if (t < seconds / 3 || t > (2 * seconds) / 3) samples[i] = 0.3 * Math.sin(2 * Math.PI * 330 * t);
  }
  return samples;
}

test('every stem gets a presence lane, and the beat comes from the rhythm stem', async () => {
  const seconds = 30;
  const buffers = new Map([
    ['vocals', monoBuffer(vocal(seconds))],
    ['instrumental', monoBuffer(groove(110, { seconds }).samples)],
  ]);
  const { lanes, beats, rhythmRole } = await analyzeStems(buffers, { OfflineCtx: PassThroughContext });

  assert.deepEqual(Object.keys(lanes).sort(), ['instrumental', 'vocals']);
  assert.equal(rhythmRole, 'instrumental');
  assert.equal(lanes.vocals.phrases.length, 2, 'the vocal sings twice');
  assert.ok(beats?.usable, 'the groove should give a usable grid');
  assert.ok(Math.abs(beats.bpm - 110) < 1.5, `bpm ${beats.bpm}`);
});

test('a drum stem is preferred for the beat when there is one', async () => {
  const seconds = 20;
  const drums = groove(96, { seconds }).samples;
  const buffers = new Map([
    ['vocals', monoBuffer(vocal(seconds))],
    ['other', monoBuffer(new Float32Array(seconds * RATE))],
    ['drums', monoBuffer(drums)],
    ['bass', monoBuffer(new Float32Array(seconds * RATE))],
  ]);
  const { rhythmRole } = await analyzeStems(buffers, { OfflineCtx: PassThroughContext });
  assert.equal(rhythmRole, 'drums');
});

test('a failed beat analysis still returns the presence lanes', async () => {
  class BrokenContext {
    constructor() { throw new Error('offline rendering unavailable'); }
  }
  const buffers = new Map([['vocals', monoBuffer(vocal(12))], ['instrumental', monoBuffer(groove(100, { seconds: 12 }).samples)]]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { lanes, beats } = await analyzeStems(buffers, { OfflineCtx: BrokenContext });
    assert.equal(beats, null);
    assert.ok(lanes.vocals.values.length > 0);
  } finally {
    console.warn = warn;
  }
});
