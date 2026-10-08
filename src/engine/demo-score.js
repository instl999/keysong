/**
 * The built-in demo: "Ode to Joy", Beethoven's melody (1824, public domain),
 * in an original four-stem arrangement that Keysong synthesizes on the spot.
 *
 * It gives a new listener something to play within seconds, before they have
 * separated a song of their own. It also exercises everything the feedback
 * does: two sung verses to type through, an instrumental break to rest in,
 * and a steady beat to tap along to.
 *
 * This module is only the score, as plain data, so it is tested in Node. The
 * sound itself is made by demo.js.
 */

export const DEMO = {
  id: 'demo:ode-to-joy',
  title: 'Ode to Joy',
  composer: 'Built-in demo · melody by Beethoven',
  roles: ['vocals', 'drums', 'bass', 'other'],
};

const BPM = 100;
const BEAT = 60 / BPM;
const BAR_BEATS = 4;
const TAIL_SECONDS = 1.8;   // Room for the last chord and the reverb to ring out.

const C5 = 72;
const D5 = 74;
const E5 = 76;
const F5 = 77;
const G5 = 79;
const G4 = 67;

/** Triads in the fourth octave, plus the bass root two octaves down. */
const CHORDS = {
  C: { tones: [60, 64, 67], root: 36 },
  G: { tones: [55, 59, 62], root: 43 },
  G7: { tones: [55, 59, 62, 65], root: 43 },
  Am: { tones: [57, 60, 64], root: 45 },
  F: { tones: [53, 57, 60], root: 41 },
};

// The melody as [beat, beats, midi], counted from the start of its section.
const OPENING = [
  [0, 1, E5], [1, 1, E5], [2, 1, F5], [3, 1, G5],
  [4, 1, G5], [5, 1, F5], [6, 1, E5], [7, 1, D5],
  [8, 1, C5], [9, 1, C5], [10, 1, D5], [11, 1, E5],
];
const HALF_CADENCE = [[12, 1.5, E5], [13.5, 0.5, D5], [14, 2, D5]];
const FULL_CADENCE = [[12, 1.5, D5], [13.5, 0.5, C5], [14, 2, C5]];
const BRIDGE = [
  [0, 1, D5], [1, 1, D5], [2, 1, E5], [3, 1, C5],
  [4, 1, D5], [5, 0.5, E5], [5.5, 0.5, F5], [6, 1, E5], [7, 1, C5],
  [8, 1, D5], [9, 0.5, E5], [9.5, 0.5, F5], [10, 1, E5], [11, 1, D5],
  [12, 1, C5], [13, 1, D5], [14, 2, G4],
];

const shift = (notes, beats) => notes.map(([beat, length, midi]) => [beat + beats, length, midi]);

/**
 * Sections in order. A chord entry is one chord for the bar, or a pair for
 * its two halves. `drums` names the pattern; `arpeggio` adds the moving
 * figure that keeps the intro, the break, and the outro alive without a voice.
 */
const FORM = [
  { name: 'intro', chords: ['C', 'Am', 'F', 'G'], drums: 'intro', bass: 2, arpeggio: true },
  {
    name: 'verse',
    chords: ['C', 'G7', 'C', ['C', 'G'], 'C', 'G7', 'C', ['G', 'C']],
    melody: [...OPENING, ...HALF_CADENCE, ...shift([...OPENING, ...FULL_CADENCE], 16)],
    drums: 'groove',
  },
  { name: 'break', chords: ['F', 'C', 'F', 'G'], drums: 'groove', arpeggio: true },
  {
    name: 'verse',
    chords: ['G', 'G7', 'G7', ['C', 'G'], 'C', 'G7', 'C', ['G', 'C']],
    melody: [...BRIDGE, ...shift([...OPENING, ...FULL_CADENCE], 16)],
    drums: 'groove',
  },
  { name: 'outro', chords: ['C', 'C'], drums: 'ending', arpeggio: true },
];

function drumBar(pattern, bar, sectionBars, at) {
  const hits = [];
  const hit = (beat, kind, level = 1) => hits.push({ time: at + beat * BEAT, kind, level });
  if (pattern === 'ending' && bar === sectionBars - 1) {
    hit(0, 'kick');
    hit(0, 'crash');
    return hits;
  }
  for (let eighth = 0; eighth < 8; eighth++) hit(eighth / 2, 'hat', eighth % 2 ? 0.6 : 1);
  hit(0, 'kick');
  hit(2, 'kick');
  if (pattern !== 'intro' || bar >= 2) {
    hit(1, 'snare');
    hit(3, 'snare');
    hit(2.5, 'kick', 0.6);
  }
  if (pattern === 'ending' && bar === 0) hit(0, 'crash', 0.7);
  return hits;
}

/**
 * The whole arrangement, in seconds.
 *
 * @returns {{ bpm: number, beat: number, seconds: number,
 *   sections: { name: string, start: number, end: number }[],
 *   chords: { start: number, end: number, name: string, tones: number[], root: number }[],
 *   melody: { time: number, duration: number, midi: number }[],
 *   bass: { time: number, duration: number, midi: number }[],
 *   arpeggio: { time: number, duration: number, midi: number }[],
 *   drums: { time: number, kind: string, level: number }[] }}
 */
export function demoScore() {
  const score = { bpm: BPM, beat: BEAT, sections: [], chords: [], melody: [], bass: [], arpeggio: [], drums: [] };
  let bar = 0;

  for (const section of FORM) {
    const sectionStart = bar * BAR_BEATS * BEAT;
    section.chords.forEach((entry, index) => {
      const at = (bar + index) * BAR_BEATS * BEAT;
      const halves = Array.isArray(entry) ? entry : [entry];
      halves.forEach((name, half) => {
        const beats = BAR_BEATS / halves.length;
        const start = at + half * beats * BEAT;
        score.chords.push({ start, end: start + beats * BEAT, name, ...CHORDS[name] });

        // Bass: root on the beat, an eighth-note push, then the next beat.
        if (index >= (section.bass ?? 0)) {
          const pattern = halves.length === 1 ? [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]] : [[0, 1.5], [1.5, 0.5]];
          for (const [beat, length] of pattern) {
            score.bass.push({ time: start + beat * BEAT, duration: length * BEAT, midi: CHORDS[name].root });
          }
        }
        if (section.arpeggio) {
          const tones = [...CHORDS[name].tones.slice(0, 3), CHORDS[name].tones[0] + 12].map((m) => m + 12);
          const order = [0, 1, 2, 3, 2, 1, 2, 3];
          for (let eighth = 0; eighth < beats * 2; eighth++) {
            score.arpeggio.push({ time: start + (eighth / 2) * BEAT, duration: BEAT / 2, midi: tones[order[eighth % 8]] });
          }
        }
      });
      score.drums.push(...drumBar(section.drums, index, section.chords.length, at));
    });

    for (const [beat, length, midi] of section.melody ?? []) {
      score.melody.push({ time: sectionStart + beat * BEAT, duration: length * BEAT, midi });
    }
    bar += section.chords.length;
    score.sections.push({ name: section.name, start: sectionStart, end: bar * BAR_BEATS * BEAT });
  }

  score.seconds = bar * BAR_BEATS * BEAT + TAIL_SECONDS;
  return score;
}
