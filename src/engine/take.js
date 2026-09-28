/**
 * One play-through of a track: a take, and how well it went.
 *
 * The mixer knows how far open the gate is; the presence lane knows whether
 * there was anything behind it. Only the two together count, so a typist is
 * never marked down for resting through an instrumental break, and never
 * credited for "revealing" silence.
 */

/** A phrase starting this soon is a cue: type now to catch its first word. */
export const CUE_LEAD = 0.6;

/** A take must have heard this share of the track's content to count as a best. */
export const COMPLETE_SHARE = 0.6;

/** A frame at or above this presence is content, for runs and phrases. */
const PRESENT = 0.5;

export class Take {
  /**
   * @param lane Presence for the stem being played: { values, frameRate, phrases }.
   * @param options.start First audible second; nothing earlier is scored.
   */
  constructor({ values, frameRate, phrases = [] }, { start = 0 } = {}) {
    this.presence = values;
    this.frameRate = frameRate;
    this.phrases = phrases;
    this.start = start;
    this.reveal = new Float32Array(values.length);
    this.from = null;        // First position recorded, in seconds.
    this.furthest = null;    // Furthest position recorded.
    this._last = null;

    let content = 0;
    for (let f = this._frame(start); f < values.length; f++) content += values[f];
    this.content = content;  // All content in the track, in presence-frames.
  }

  _frame(seconds) {
    return Math.min(this.presence.length, Math.max(0, Math.floor(seconds * this.frameRate)));
  }

  /**
   * Record the gate level over the stretch since the previous call.
   *
   * A jump backwards, or forwards by more than a second, is a seek or a
   * restart: it begins a new stretch rather than painting everything between.
   */
  record(pos, level) {
    const last = this._last;
    this._last = pos;
    if (last === null || pos <= last || pos - last > 1) return;
    if (this.from === null) this.from = last;
    if (this.furthest === null || pos > this.furthest) this.furthest = pos;

    const value = Math.min(1, Math.max(0, level));
    const end = this._frame(pos);
    for (let f = this._frame(last); f < end; f++) {
      if (value > this.reveal[f]) this.reveal[f] = value;
    }
  }

  /** Frames heard so far, as [from, to). */
  _heard() {
    if (this.from === null) return [0, 0];
    return [this._frame(Math.max(this.start, this.from)), this._frame(this.furthest)];
  }

  /** Share of the content heard so far that was revealed, or null before a second of it. */
  get score() {
    const [from, to] = this._heard();
    let total = 0;
    let revealed = 0;
    for (let f = from; f < to; f++) {
      total += this.presence[f];
      revealed += this.presence[f] * this.reveal[f];
    }
    return total >= this.frameRate ? revealed / total : null;
  }

  /** Share of the whole track's content this take has heard. */
  get heard() {
    if (!(this.content > 0)) return 0;
    const [from, to] = this._heard();
    let total = 0;
    for (let f = from; f < to; f++) total += this.presence[f];
    return total / this.content;
  }

  /** Whether enough of the track was heard for the score to stand as a best. */
  get complete() {
    return this.score !== null && this.heard >= COMPLETE_SHARE;
  }

  /**
   * Longest unbroken run of revealed content, in seconds. Breaks in the stem
   * neither extend a run nor end one; only content left unrevealed does.
   */
  get longestRun() {
    const [from, to] = this._heard();
    let best = 0;
    let run = 0;
    for (let f = from; f < to; f++) {
      if (this.presence[f] < PRESENT) continue;
      if (this.reveal[f] >= PRESENT) run++;
      else {
        best = Math.max(best, run);
        run = 0;
      }
    }
    return Math.max(best, run) / this.frameRate;
  }

  /**
   * Where `pos` falls among the phrases: inside one, or waiting for the next.
   *
   * @returns {{ phrase: object | null, next: object | null }}
   */
  moment(pos) {
    const { phrases } = this;
    let lo = 0;
    let hi = phrases.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (phrases[mid].start <= pos) lo = mid + 1;
      else hi = mid;
    }
    const previous = phrases[lo - 1];
    if (previous && pos < previous.end) return { phrase: previous, next: phrases[lo] ?? null };
    return { phrase: null, next: phrases[lo] ?? null };
  }
}

/**
 * The best score for each track and stem, kept in Web Storage.
 *
 * Only the track's playlist id and a number are stored: nothing about what
 * was typed. Storage that is full, blocked, or corrupt costs the history and
 * never the take.
 */
export class BestTakes {
  constructor(storage, { key = 'keysong:best-takes', limit = 300 } = {}) {
    this.storage = storage;
    this.key = key;
    this.limit = limit;
  }

  _read() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(this.key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  get(id) {
    const value = this._read()[id];
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Offer a finished take's score.
   *
   * @returns {{ best: number, previous: number | null, improved: boolean }}
   */
  submit(id, score) {
    const all = this._read();
    const previous = Number.isFinite(all[id]) ? all[id] : null;
    const improved = previous === null || score > previous;
    if (!improved) return { best: previous, previous, improved };

    // Re-insert so the newest entries come last and the oldest are dropped first.
    delete all[id];
    all[id] = Math.round(score * 1000) / 1000;
    const ids = Object.keys(all);
    for (const stale of ids.slice(0, Math.max(0, ids.length - this.limit))) delete all[stale];
    try {
      this.storage?.setItem(this.key, JSON.stringify(all));
    } catch {
      // Full or unavailable: the take still happened, it is just not remembered.
    }
    return { best: score, previous, improved };
  }
}
