import test from 'node:test';
import assert from 'node:assert/strict';
import { Take, BestTakes, COMPLETE_SHARE } from '../src/engine/take.js';

const FRAME_RATE = 20;

/** A presence lane from [startSeconds, endSeconds] spans of content. */
function lane(seconds, spans) {
  const values = new Float32Array(seconds * FRAME_RATE);
  for (const [start, end] of spans) values.fill(1, start * FRAME_RATE, end * FRAME_RATE);
  const phrases = spans.map(([start, end]) => ({ start, end }));
  return { values, frameRate: FRAME_RATE, phrases };
}

/** Play from `from` to `to` in 66 ms ticks, with the gate at level(t). */
function play(take, from, to, level) {
  for (let t = from; t <= to + 1e-9; t += 0.066) take.record(t, level(t));
}

test('revealing every word scores one, and revealing none scores zero', () => {
  const full = new Take(lane(10, [[0, 10]]));
  play(full, 0, 10, () => 1);
  assert.ok(full.score > 0.99, `score ${full.score}`);

  const silent = new Take(lane(10, [[0, 10]]));
  play(silent, 0, 10, () => 0);
  assert.equal(silent.score, 0);
});

test('resting through a break costs nothing', () => {
  const take = new Take(lane(12, [[0, 4], [8, 12]]));
  play(take, 0, 12, (t) => (t < 4 || t >= 8 ? 1 : 0));
  assert.ok(take.score > 0.97, `score ${take.score}`);
});

test('revealing silence earns nothing', () => {
  const take = new Take(lane(12, [[0, 4], [8, 12]]));
  play(take, 0, 12, (t) => (t >= 4 && t < 8 ? 1 : 0));
  assert.ok(take.score < 0.03, `score ${take.score}`);
});

test('the score is the revealed share of the content heard so far', () => {
  const take = new Take(lane(20, [[0, 20]]));
  play(take, 0, 10, (t) => (t < 5 ? 1 : 0));
  assert.ok(Math.abs(take.score - 0.5) < 0.03, `score ${take.score}`);
});

test('there is no score before a second of content has been heard', () => {
  const take = new Take(lane(10, [[2, 10]]));
  play(take, 0, 2.5, () => 1);
  assert.equal(take.score, null);
  play(take, 2.5, 3.5, () => 1);
  assert.ok(take.score > 0.9);
});

test('a jump backwards or a long skip does not paint the frames it passed', () => {
  const take = new Take(lane(30, [[0, 30]]));
  play(take, 10, 12, () => 1);
  take.record(2, 1);          // Restarted near the top.
  take.record(2.05, 1);
  take.record(20, 1);         // Skipped far ahead.
  take.record(20.05, 1);
  const painted = take.reveal.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  assert.ok(painted <= 2.2 * FRAME_RATE, `${painted} frames painted`);
});

test('frames before the first audible second are never scored', () => {
  const take = new Take(lane(10, [[0, 10]]), { start: 4 });
  play(take, 0, 10, (t) => (t >= 4 ? 1 : 0));
  assert.ok(take.score > 0.99, `score ${take.score}`);
});

test('a take is complete once most of the track has been heard', () => {
  const take = new Take(lane(20, [[0, 20]]));
  play(take, 0, 20 * (COMPLETE_SHARE - 0.1), () => 1);
  assert.equal(take.complete, false);
  play(take, 20 * (COMPLETE_SHARE - 0.1), 20 * (COMPLETE_SHARE + 0.1), () => 1);
  assert.equal(take.complete, true);
  assert.ok(take.heard > COMPLETE_SHARE && take.heard < 1);
});

test('the longest run spans breaks but ends at a missed word', () => {
  const take = new Take(lane(30, [[0, 10], [15, 25]]));
  // Miss 3.0-3.5, then reveal everything else, straight across the break.
  play(take, 0, 30, (t) => (t >= 3 && t < 3.5 ? 0 : 1));
  const run = take.longestRun;
  assert.ok(Math.abs(run - 16.5) < 0.2, `longest run ${run}`);
});

test('moments place a position inside a phrase or before the next', () => {
  const take = new Take(lane(30, [[2, 5], [9, 12]]));
  assert.deepEqual(take.moment(1), { phrase: null, next: { start: 2, end: 5 } });
  assert.deepEqual(take.moment(3), { phrase: { start: 2, end: 5 }, next: { start: 9, end: 12 } });
  assert.deepEqual(take.moment(7), { phrase: null, next: { start: 9, end: 12 } });
  assert.deepEqual(take.moment(20), { phrase: null, next: null });
});

/** In-memory Web Storage. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

test('only a better take replaces the best', () => {
  const bests = new BestTakes(memoryStorage());
  assert.equal(bests.get('song|vocal'), null);
  assert.deepEqual(bests.submit('song|vocal', 0.6), { best: 0.6, previous: null, improved: true });
  assert.deepEqual(bests.submit('song|vocal', 0.5), { best: 0.6, previous: 0.6, improved: false });
  assert.deepEqual(bests.submit('song|vocal', 0.8), { best: 0.8, previous: 0.6, improved: true });
  assert.equal(bests.get('song|vocal'), 0.8);
});

test('the oldest bests are dropped past the limit', () => {
  const bests = new BestTakes(memoryStorage(), { limit: 3 });
  for (const id of ['a', 'b', 'c', 'd']) bests.submit(id, 0.5);
  assert.equal(bests.get('a'), null);
  assert.equal(bests.get('d'), 0.5);
});

test('corrupt or unavailable storage costs the history, never the take', () => {
  const corrupt = new BestTakes(memoryStorage({ 'keysong:best-takes': '{not json' }));
  assert.equal(corrupt.get('x'), null);
  assert.equal(corrupt.submit('x', 0.7).improved, true);

  const full = new BestTakes({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } });
  assert.deepEqual(full.submit('x', 0.7), { best: 0.7, previous: null, improved: true });

  const missing = new BestTakes(undefined);
  assert.equal(missing.get('x'), null);
  assert.equal(missing.submit('x', 0.4).improved, true);
});

test('only an id and a number are stored', () => {
  const storage = memoryStorage();
  new BestTakes(storage).submit('resource:Song/Song|vocal', 0.72345);
  assert.deepEqual(JSON.parse(storage.data['keysong:best-takes']), { 'resource:Song/Song|vocal': 0.723 });
});
