/**
 * First feedback layer: an immediate tactile response for every key press.
 *
 * A quiet 20-60 ms transient confirms each key press. The second feedback layer
 * aggregates stem gating over a window, so one key may not cause an audible
 * change; this layer keeps slow typing responsive.
 *
 * A synthesized transient avoids media dependencies, keeps latency predictable,
 * and stays harmonically neutral.
 *
 * Identical clicks in quick succession read as a machine gun rather than as
 * touch, so every hit draws a different slice of noise and varies its pitch
 * and level slightly, the way no two real key presses sound the same.
 */
const NOISE_SECONDS = 0.5;

export class Touch {
  /** @param output Where clicks go: the app's volume stage, or the speakers. */
  constructor(ctx, output = ctx.destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.05;
    this.out.connect(output);
    this.enabled = true;     // The listener can switch clicks off.
    this._noise = this._makeNoise();
    this._last = 0;
  }

  _makeNoise() {
    const n = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
    return buf;
  }

  /**
   * @param accent Use a stronger response for Space or Enter.
   * @param inTime The key landed on the song's beat: answer a little brighter.
   */
  hit({ accent = false, inTime = false } = {}) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;   // Use the native clock without look-ahead.
    if (t - this._last < 0.02) return;   // Rate-limit extreme bursts.
    this._last = t;

    const vary = (spread) => 1 + (Math.random() * 2 - 1) * spread;
    const dur = accent ? 0.055 : 0.03;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (accent ? 320 : 1400) * (inTime ? 1.25 : 1) * vary(0.12);
    bp.Q.value = accent ? 1.2 : 2.4;

    const g = ctx.createGain();
    const peak = (accent ? 1 : 0.55) * (inTime ? 1.3 : 1) * vary(0.15);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp); bp.connect(g); g.connect(this.out);
    const offset = Math.random() * (NOISE_SECONDS - dur - 0.03);
    src.start(t, offset); src.stop(t + dur + 0.02);
  }
}
