/**
 * Seeded pseudo-random number generator (mulberry32) + Gaussian sampling.
 * Every random decision in the project goes through this, so any training
 * run can be reproduced exactly from its seed.
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class RNG {
    constructor(seed = Date.now()) {
      this.seed = seed >>> 0;
      this._next = mulberry32(this.seed);
      this._spare = null;
    }
    random() {
      return this._next();
    }
    range(min, max) {
      return min + (max - min) * this._next();
    }
    int(n) {
      return Math.floor(this._next() * n);
    }
    /** Standard normal sample (Marsaglia polar method). */
    gaussian() {
      if (this._spare !== null) {
        const s = this._spare;
        this._spare = null;
        return s;
      }
      let u, v, s;
      do {
        u = this._next() * 2 - 1;
        v = this._next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const m = Math.sqrt((-2 * Math.log(s)) / s);
      this._spare = v * m;
      return u * m;
    }
  }

  NE.RNG = RNG;
})(typeof window !== 'undefined' ? window : globalThis);
