import test from 'node:test';
import assert from 'node:assert/strict';
import { demoScore, DEMO } from '../src/engine/demo-score.js';

const score = demoScore();
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
const chordAt = (time) => score.chords.find((chord) => time >= chord.start - 1e-9 && time < chord.end - 1e-9);
const onBeat = (time) => Math.abs(time / score.beat - Math.round(time / score.beat)) < 1e-9;

test('the demo carries the four stems every mode can reveal', () => {
  assert.deepEqual([...DEMO.roles].sort(), ['bass', 'drums', 'other', 'vocals']);
  assert.ok(DEMO.id.startsWith('demo:'));
});

test('the sections run end to end: intro, verse, break, verse, outro', () => {
  assert.deepEqual(score.sections.map((s) => s.name), ['intro', 'verse', 'break', 'verse', 'outro']);
  for (let i = 1; i < score.sections.length; i++) {
    assert.ok(Math.abs(score.sections[i].start - score.sections[i - 1].end) < 1e-9, 'no gaps between sections');
  }
  assert.ok(score.seconds > score.sections.at(-1).end, 'the last chord has room to ring out');
});

test('every moment of the song has a chord', () => {
  for (let i = 1; i < score.chords.length; i++) {
    assert.ok(Math.abs(score.chords[i].start - score.chords[i - 1].end) < 1e-9);
  }
  assert.equal(score.chords[0].start, 0);
  assert.ok(Math.abs(score.chords.at(-1).end - score.sections.at(-1).end) < 1e-9);
});

test('the melody sings only in the verses, so the break is a real rest', () => {
  const verses = score.sections.filter((s) => s.name === 'verse');
  for (const note of score.melody) {
    const inVerse = verses.some((v) => note.time >= v.start && note.time + note.duration <= v.end + 1e-9);
    assert.ok(inVerse, `note at ${note.time.toFixed(2)} s falls outside the verses`);
  }
  const rest = score.sections.find((s) => s.name === 'break');
  assert.ok(rest.end - rest.start >= 8, 'the break should be long enough to notice');
});

test('the melody is in C major, within a singable range, and never overlaps itself', () => {
  for (const note of score.melody) {
    assert.ok(C_MAJOR.has(note.midi % 12), `${note.midi} is out of key`);
    assert.ok(note.midi >= 67 && note.midi <= 79, `${note.midi} is out of range`);
  }
  for (let i = 1; i < score.melody.length; i++) {
    const previous = score.melody[i - 1];
    assert.ok(previous.time + previous.duration <= score.melody[i].time + 1e-9);
  }
});

test('every melody note on a downbeat belongs to the chord under it', () => {
  const barSeconds = 4 * score.beat;
  for (const note of score.melody) {
    const bar = note.time / barSeconds;
    if (Math.abs(bar - Math.round(bar)) > 1e-9) continue;
    const chord = chordAt(note.time);
    const pitchClasses = chord.tones.map((tone) => tone % 12);
    assert.ok(pitchClasses.includes(note.midi % 12), `${note.midi} over ${chord.name} at ${note.time.toFixed(2)} s`);
  }
});

test('the bass plays chord roots, and the drums keep a steady 100 BPM', () => {
  for (const note of score.bass) assert.equal(note.midi, chordAt(note.time).root);
  assert.equal(score.bpm, 100);
  for (const hit of score.drums.filter((h) => h.kind === 'kick' && h.level === 1)) {
    assert.ok(onBeat(hit.time), `kick at ${hit.time} is off the beat`);
  }
  for (const hit of score.drums.filter((h) => h.kind === 'snare')) assert.ok(onBeat(hit.time));
});

test('the song ends on the home chord', () => {
  assert.equal(score.chords.at(-1).name, 'C');
  assert.equal(score.melody.at(-1).midi % 12, 0, 'the last sung note is C');
});
