/**
 * Typing-to-stem gain gate.
 *
 * Typing speed controls reveal duration rather than stem count. Faster typing
 * keeps the current stems open longer until the original mix is nearly restored.
 *
 * Every key extends the open-until time. A single key creates a short reveal;
 * continuous typing joins the windows, and stopping produces a natural release.
 *
 * The gate decides only whether it is open. The fades themselves run on the
 * audio clock, so `value` is a model of the gain the listener hears, kept for
 * the meters and the score.
 */
export class Gate {
  constructor(opts = {}) {
    /**
     * Express the window as a multiple of the user's normal inter-key interval.
     *
     * A fixed 0.14-second window would require seven keys per second to remain
     * continuous, excluding ordinary writing speeds.
     *
     * With a relative window, normal typing stays continuous while clearly slower
     * input becomes intermittent, regardless of the user's baseline speed.
     */
    this.refRate = opts.refRate ?? 3.2;          // Calibrated baseline keys per second.
    this.winMin = opts.winMin ?? 1.05;           // Baseline interval multiplier.
    this.winMax = opts.winMax ?? 1.45;
    this.attack = opts.attack ?? 0.012;          // Time constant: 95 percent open in 36 ms.
    this.release = opts.release ?? 0.11;         // 3 tau is about a 330 ms fade.
    this.value = 0;
    this.target = 0;                             // 1 while held open, else 0.
    this.sustain = 0;                            // Sustained engagement, 0..1.
    this.holdUntil = 0;
  }

  /** Typical inter-key interval in seconds. */
  get refIki() { return 1 / Math.max(0.5, this.refRate); }

  /** Whether a key press is still holding the gate open at `now`. */
  isHeld(now) { return now < this.holdUntil; }

  /**
   * Register a key press; overlapping windows merge naturally.
   *
   * @param minHold Hold at least this long, whatever the typing speed. The
   *   mixer uses it to carry a stem through to the song's next beat.
   */
  strike(now, minHold = 0) {
    const k = this.winMin + this.sustain * (this.winMax - this.winMin);
    const win = Math.max(minHold, Math.min(0.95, Math.max(0.12, this.refIki * k)));
    this.holdUntil = Math.max(this.holdUntil, now + win);
  }

  /** @param rate Current typing rate in keys per second. */
  update(now, dt, rate) {
    // Treat the user's own baseline speed as full drive.
    const drive = Math.min(1, rate / Math.max(0.5, this.refRate));
    this.sustain += (drive - this.sustain) * (1 - Math.exp(-dt / 1.6));
    this.target = this.isHeld(now) ? 1 : 0;
    const tau = this.target ? this.attack : this.release;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / tau));
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  }
}

/**
 * Mixing strategy.
 *
 * Final sound = background * background gain + foreground * typing activity +
 * a quiet touch transient. The background ducks by about 2.5 dB as the
 * foreground rises, keeping overall loudness stable.
 */
/**
 * A mode names only the stems that typing reveals. Everything else the track
 * has becomes background, so a four-stem Demucs set and a two-stem UVR pair
 * both work without listing every combination here.
 */
export const MODES = {
  vocal: {
    label: 'Vocals',
    short: 'Vocals',
    hint: 'The backing plays on its own. Typing reveals the original vocals.',
    foreground: ['vocals'],
    noun: 'vocals',                  // "Vocals in 0:06", "You sang 72% of the vocals"
    verb: 'sang',
    playing: 'Singing',
    scoreLabel: 'Vocals sung',
  },
  instrument: {
    label: 'Instruments',
    short: 'Other',
    hint: 'Rhythm and vocals keep playing. Typing restores melodic instruments.',
    foreground: ['other'],
    noun: 'instruments',
    verb: 'played',
    playing: 'Playing',
    scoreLabel: 'Instruments played',
  },
  drums: {
    label: 'Drums',
    short: 'Drums',
    hint: 'The track starts without drums. Typing brings the beat back in.',
    foreground: ['drums'],
    noun: 'drums',
    verb: 'played',
    playing: 'Playing',
    scoreLabel: 'Drums played',
  },
  bass: {
    label: 'Bass',
    short: 'Bass',
    hint: 'The track starts without bass. Typing brings the low end back in.',
    foreground: ['bass'],
    noun: 'bass',
    verb: 'played',
    playing: 'Playing',
    scoreLabel: 'Bass played',
  },
};

/**
 * The stem that holds a steady level no matter what the typist does, so the
 * track always keeps a foundation. It is only gated when it is itself the
 * stem the listener chose to reveal.
 */
export const ANCHOR_ROLE = 'bass';

/** Which foreground roles a mode can actually drive on this stem set. */
export function foregroundRoles(mode, roles) {
  return (MODES[mode]?.foreground ?? []).filter((r) => roles.includes(r));
}

/** A mode needs a foreground stem to reveal and at least one other to reveal against. */
export function modeAvailable(mode, roles) {
  const fg = foregroundRoles(mode, roles);
  return fg.length > 0 && roles.some((r) => !fg.includes(r));
}

/** Every mode this stem set supports, in menu order. */
export function availableModes(roles) {
  return Object.keys(MODES).filter((mode) => modeAvailable(mode, roles));
}

/**
 * Fade lengths handed to the deck, about three time constants each. Opening
 * matches the gate's attack; closing and restoring match its release, so the
 * background comes back exactly as fast as the foreground leaves.
 */
const OPEN_RAMP = 0.036;
const CLOSE_RAMP = 0.33;
const DUCK_RAMP = 0.09;

/**
 * Beat-aware holding. A keystroke up to IN_TIME early belongs to the beat it
 * anticipates, so the hold runs to the beat after; BEAT_GRACE leaves room for
 * the next keystroke to land a little late without the stem dipping first.
 */
const IN_TIME = 0.07;
const BEAT_GRACE = 0.12;
const MAX_BEAT_HOLD = 1.3;

export class Mixer {
  constructor(deck) {
    this.deck = deck;
    this.gate = new Gate();
    this.accent = new Gate({ winMin: 1.6, winMax: 1.6, attack: 0.01, release: 0.5 });
    this.mode = 'vocal';
    this.bgLevel = 0.85;
    this.fgLevel = 1.0;
    this.duck = 0.25;          // Background reaches 75 percent at full foreground.
    this.FG_CAP = 2;           // Maximum simultaneous foreground stems.
    this.anchor = ANCHOR_ROLE; // Never ducked, so the track keeps its foundation.
    this.beats = null;         // A usable BeatGrid, once the track is analysed.
  }

  /** Set the user's baseline typing rate for both gates. */
  setRefRate(rate) {
    this.gate.refRate = rate;
    this.accent.refRate = rate;
  }

  setMode(mode) {
    this.mode = mode;
    // Move straight to the new mix: stems swap sides without dipping to silence.
    this._apply();
  }

  /** Follow the song's pulse, or pass null to go back to typing speed alone. */
  setBeatGrid(grid) {
    this.beats = grid?.usable ? grid : null;
  }

  /**
   * Register a keystroke.
   *
   * @param songPos Where in the song the listener is, in seconds, when the
   *   key lands. With a beat grid it carries the stem through the next beat,
   *   so playing along on the beat keeps it open and letting go releases it
   *   on the beat rather than between two.
   */
  strike(now, kind, songPos = null) {
    const opening = !this.gate.isHeld(now);
    this.gate.strike(now, this._beatHold(songPos));
    // Space and Enter mark boundaries and receive a stronger accent.
    if (kind === 'space' || kind === 'enter') this.accent.strike(now);

    // Open now, on the audio clock, rather than on the next update: waiting
    // for the control loop put up to 66 ms of jitter between key and sound.
    if (opening) {
      this.gate.target = 1;
      this._apply();
    }
  }

  _beatHold(songPos) {
    if (!this.beats || songPos === null) return 0;
    const next = this.beats.next(songPos + IN_TIME);
    return next === null ? 0 : Math.min(MAX_BEAT_HOLD, next - songPos + BEAT_GRACE);
  }

  update(now, dt, rate) {
    const fg = this.gate.update(now, dt, rate);
    const ac = this.accent.update(now, dt, rate);
    return { fg, ac, ...this._apply() };
  }

  /** Send the mix for the gate's current target to the deck. */
  _apply() {
    const open = this.gate.target;
    const roles = this.deck.roles;

    // Everything the mode does not reveal is background, whatever the stem set.
    const fgRoles = foregroundRoles(this.mode, roles).slice(0, this.FG_CAP);
    const bgRoles = roles.filter((r) => !fgRoles.includes(r));

    // Duck the background as the foreground opens, but hold the anchor steady:
    // it plays at a constant level whether or not anyone is typing.
    const bg = this.bgLevel * (1 - this.duck * open);
    for (const r of bgRoles) {
      if (r === this.anchor) this.deck.setGain(r, this.bgLevel, CLOSE_RAMP);
      else this.deck.setGain(r, bg, open ? DUCK_RAMP : CLOSE_RAMP);
    }
    for (const r of fgRoles) this.deck.setGain(r, this.fgLevel * open, open ? OPEN_RAMP : CLOSE_RAMP);

    // Briefly lift background drums for Space or Enter accents.
    const ac = this.accent.value;
    if (bgRoles.includes('drums') && this.anchor !== 'drums' && ac > 0.01) {
      this.deck.setGain('drums', bg * (1 + 0.45 * ac), 0.05);
    }
    return { fgRoles, bgRoles };
  }
}
