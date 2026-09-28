/**
 * The song map: the revealed stem's content across the whole track, painted
 * gold wherever the typist brought it in.
 *
 * Ahead of the playhead it previews what is coming, so the next phrase can be
 * seen approaching; behind it, it is the record of the take. Breaks in the
 * stem shrink to a flat line, which is why typing there changes nothing.
 */
const BAR = 2;
const STEP = 3;

export class SongMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.take = null;
    this.start = 0;
    this.end = 0;
    this.position = 0;
    this._width = 0;
    this._height = 0;
    this._colors = null;
    new ResizeObserver(() => this._resize()).observe(canvas);
  }

  /** Show a take across [start, end] seconds of the track, or hide the map with null. */
  show(take, { start = 0, end = 0 } = {}) {
    this.take = take;
    this.start = start;
    this.end = end;
    this.canvas.hidden = !take;
    this._resize();
  }

  _resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this._width = width;
    this._height = height;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.g.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  _palette() {
    if (!this._colors) {
      const style = getComputedStyle(this.canvas);
      const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
      this._colors = {
        live: read('--live', '#e7bd4f'),
        ahead: read('--map-ahead', 'rgba(236, 234, 225, .26)'),
        behind: read('--map-behind', 'rgba(236, 234, 225, .1)'),
        head: read('--ink', '#eceae1'),
      };
    }
    return this._colors;
  }

  draw(position = this.position) {
    this.position = position;
    const { take, g } = this;
    const width = this._width;
    const height = this._height;
    if (!take || !width || !height) return;

    const colors = this._palette();
    g.clearRect(0, 0, width, height);
    const count = Math.max(1, Math.floor(width / STEP));
    const span = Math.max(0.001, this.end - this.start);
    const { presence, reveal, frameRate } = take;
    const middle = height / 2;

    for (let i = 0; i < count; i++) {
      const from = this.start + (i / count) * span;
      const to = this.start + ((i + 1) / count) * span;
      const first = Math.floor(from * frameRate);
      const last = Math.min(presence.length, Math.max(first + 1, Math.ceil(to * frameRate)));
      let peak = 0;
      let weight = 0;
      let lit = 0;
      for (let f = first; f < last; f++) {
        const value = presence[f];
        if (value > peak) peak = value;
        weight += value;
        lit += value * reveal[f];
      }

      const barHeight = Math.max(2, peak * (height - 2));
      const x = i * STEP;
      const y = middle - barHeight / 2;
      g.fillStyle = to <= position ? colors.behind : colors.ahead;
      g.fillRect(x, y, BAR, barHeight);
      const share = weight > 0 ? lit / weight : 0;
      if (share > 0.02) {
        g.globalAlpha = Math.min(1, share);
        g.fillStyle = colors.live;
        g.fillRect(x, y, BAR, barHeight);
        g.globalAlpha = 1;
      }
    }

    const head = Math.round(((position - this.start) / span) * count * STEP);
    g.fillStyle = colors.head;
    g.fillRect(Math.min(width - 2, Math.max(0, head)), 0, 2, height);
  }
}
