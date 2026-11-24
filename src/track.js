/**
 * Procedurally generated closed race track.
 *
 * The centreline is an ellipse distorted by a sum of random sine harmonics,
 * resampled to evenly spaced points. Left/right walls are offset along the
 * normals, and every centreline point gets a "gate" (checkpoint) spanning the
 * road. Generated tracks are validated (no folded walls, no parts of the road
 * touching each other) and regenerated with gentler curves if invalid.
 *
 * Geometry queries (ray casts, collisions) only test wall segments near the
 * car's current gate index, which keeps the simulation fast: O(window) instead
 * of O(all walls) per query.
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  /**
   * Intersection of ray P + t*D with segment A-B.
   * Returns t if it hits with 0 <= t < best, otherwise best.
   * With an unnormalised D and best = 1 this is a segment-segment test.
   */
  function raySeg(px, py, dx, dy, ax, ay, bx, by, best) {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (den > -1e-12 && den < 1e-12) return best;
    const wx = ax - px;
    const wy = ay - py;
    const t = (wx * ey - wy * ex) / den;
    if (t < 0 || t >= best) return best;
    const u = (wx * dy - wy * dx) / den;
    if (u < 0 || u > 1) return best;
    return t;
  }

  class Track {
    constructor(opts = {}) {
      this.seed = opts.seed ?? 1;
      this.width = opts.width ?? 1000;
      this.height = opts.height ?? 640;
      this.n = opts.segments ?? 220;
      this.trackWidth = opts.trackWidth ?? 58;
      this.sensorRange = opts.sensorRange ?? 180;
      this._build();
    }

    _centerline(harmonics, sumAmp) {
      const W = this.width;
      const H = this.height;
      const margin = this.trackWidth / 2 + 18;
      const Rx = (W / 2 - margin) / (1 + sumAmp);
      const Ry = (H / 2 - margin) / (1 + sumAmp);
      // Dense sampling, then resample to n points evenly spaced by arc length.
      const M = this.n * 8;
      const xs = new Float64Array(M + 1);
      const ys = new Float64Array(M + 1);
      const cum = new Float64Array(M + 1);
      for (let i = 0; i <= M; i++) {
        const th = (2 * Math.PI * i) / M;
        let r = 1;
        for (const h of harmonics) r += h.a * Math.sin(h.k * th + h.p);
        xs[i] = W / 2 + Rx * r * Math.cos(th);
        ys[i] = H / 2 + Ry * r * Math.sin(th);
        if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      }
      const total = cum[M];
      const cx = new Float64Array(this.n);
      const cy = new Float64Array(this.n);
      let j = 0;
      for (let i = 0; i < this.n; i++) {
        const target = (total * i) / this.n;
        while (cum[j + 1] < target) j++;
        const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
        cx[i] = xs[j] + (xs[j + 1] - xs[j]) * f;
        cy[i] = ys[j] + (ys[j + 1] - ys[j]) * f;
      }
      return { cx, cy, length: total };
    }

    _build() {
      const rng = new NE.RNG(this.seed * 2654435761);
      let ampScale = 1;
      for (let attempt = 0; attempt < 80; attempt++) {
        const harmonics = [];
        let sumAmp = 0;
        for (let k = 2; k <= 5; k++) {
          const a = rng.range(0.3, 1) * (0.55 / k) * ampScale;
          harmonics.push({ k, a, p: rng.range(0, Math.PI * 2) });
          sumAmp += a;
        }
        const { cx, cy, length } = this._centerline(harmonics, sumAmp);
        this._assign(cx, cy, length);
        if (this._isValid()) return;
        ampScale *= 0.92;
      }
      // Falls through with the last (very gentle, near-elliptical) attempt.
    }

    _assign(cx, cy, length) {
      const n = this.n;
      const hw = this.trackWidth / 2;
      this.cx = cx;
      this.cy = cy;
      this.lx = new Float64Array(n);
      this.ly = new Float64Array(n);
      this.rx = new Float64Array(n);
      this.ry = new Float64Array(n);
      this.tx = new Float64Array(n);
      this.ty = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n;
        const b = (i + 1) % n;
        let tx = cx[b] - cx[a];
        let ty = cy[b] - cy[a];
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        this.tx[i] = tx;
        this.ty[i] = ty;
        // Normal (-ty, tx)
        this.lx[i] = cx[i] - ty * hw;
        this.ly[i] = cy[i] + tx * hw;
        this.rx[i] = cx[i] + ty * hw;
        this.ry[i] = cy[i] - tx * hw;
      }
      this.length = length;
      this.segLen = length / n;
      // Rays on the inside of a bend cover more wall indices than their length suggests, hence the 2x.
      this.rayWindow = Math.ceil((2 * this.sensorRange) / this.segLen) + 4;
      this.collisionWindow = 6;
      this.start = { x: cx[0], y: cy[0], angle: Math.atan2(this.ty[0], this.tx[0]) };
    }

    _polyHits(ax, ay, bx, by, self) {
      const n = this.n;
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        for (let j = self ? i + 2 : 0; j < n; j++) {
          if (self && i === 0 && j === n - 1) continue; // closing neighbours
          const j2 = (j + 1) % n;
          if (raySeg(ax[i], ay[i], ax[i2] - ax[i], ay[i2] - ay[i], bx[j], by[j], bx[j2], by[j2], 1) < 1) return true;
        }
      }
      return false;
    }

    _isValid() {
      if (this._polyHits(this.lx, this.ly, this.lx, this.ly, true)) return false;
      if (this._polyHits(this.rx, this.ry, this.rx, this.ry, true)) return false;
      if (this._polyHits(this.lx, this.ly, this.rx, this.ry, false)) return false;
      // Keep separate parts of the road visibly apart.
      const n = this.n;
      const minGap = this.trackWidth * 1.6;
      const skip = Math.ceil((this.trackWidth * 2.5) / this.segLen);
      for (let i = 0; i < n; i++) {
        for (let j = i + skip; j < n; j++) {
          if (n - (j - i) < skip) continue;
          if (Math.hypot(this.cx[i] - this.cx[j], this.cy[i] - this.cy[j]) < minGap) return false;
        }
      }
      return true;
    }

    /** Distance along unit direction (dx,dy) to the nearest wall, capped at range. */
    castRay(x, y, dx, dy, range, idx, win = this.rayWindow) {
      const n = this.n;
      let best = range;
      for (let o = -win; o <= win; o++) {
        const k = (((idx + o) % n) + n) % n;
        const k2 = k + 1 === n ? 0 : k + 1;
        best = raySeg(x, y, dx, dy, this.lx[k], this.ly[k], this.lx[k2], this.ly[k2], best);
        best = raySeg(x, y, dx, dy, this.rx[k], this.ry[k], this.rx[k2], this.ry[k2], best);
      }
      return best;
    }

    /** Does segment (ax,ay)-(bx,by) cross any wall near index idx? */
    segmentHitsWall(ax, ay, bx, by, idx, win = this.collisionWindow) {
      const n = this.n;
      const dx = bx - ax;
      const dy = by - ay;
      for (let o = -win; o <= win; o++) {
        const k = (((idx + o) % n) + n) % n;
        const k2 = k + 1 === n ? 0 : k + 1;
        if (raySeg(ax, ay, dx, dy, this.lx[k], this.ly[k], this.lx[k2], this.ly[k2], 1) < 1) return true;
        if (raySeg(ax, ay, dx, dy, this.rx[k], this.ry[k], this.rx[k2], this.ry[k2], 1) < 1) return true;
      }
      return false;
    }

    /** Did the movement (px,py)->(x,y) pass through gate g? */
    crossesGate(g, px, py, x, y) {
      return raySeg(px, py, x - px, y - py, this.lx[g], this.ly[g], this.rx[g], this.ry[g], 1) < 1;
    }
  }

  Track.raySeg = raySeg;
  NE.Track = Track;
})(typeof window !== 'undefined' ? window : globalThis);
