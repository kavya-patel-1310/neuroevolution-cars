/**
 * A car driven by a neural network.
 *
 * Inputs (8):  7 ray-cast distance sensors (1 = wall touching, 0 = nothing in range)
 *              + current speed (normalised).
 * Outputs (2): steering in [-1, 1] and throttle/brake in [-1, 1].
 *
 * Fitness = checkpoints passed + fractional progress to the next one,
 * plus a time bonus for cars that finish the target number of laps (rewards speed).
 */
(function (root) {
  const NE = (root.NE = root.NE || {});
  const DEG = Math.PI / 180;

  const CAR_DEFAULTS = {
    maxSpeed: 6,
    accel: 0.25,
    friction: 0.02,
    turnRate: 0.05,
    length: 16,
    width: 8,
    sensorRange: 180,
    sensorAngles: [-90, -55, -25, 0, 25, 55, 90].map((d) => d * DEG),
    stallLimit: 100, // steps without reaching a new checkpoint before the car is removed
    lapsToFinish: 3,
    maxSteps: 2500,
  };

  class Car {
    constructor(brain, track, cfg = {}) {
      this.cfg = { ...CAR_DEFAULTS, ...cfg };
      this.brain = brain;
      this.track = track;
      const ns = this.cfg.sensorAngles.length;
      this.readings = new Float32Array(ns);
      this.input = new Float32Array(ns + 1);
      this.reset();
    }

    reset() {
      const s = this.track.start;
      this.x = s.x;
      this.y = s.y;
      this.angle = s.angle;
      this.speed = 0;
      this.alive = true;
      this.finished = false;
      this.crashed = false;
      this.checkpoints = 0;
      this.nextGate = 1;
      this.steps = 0;
      this.sinceProgress = 0;
      this.fitness = 0;
      this.steer = 0;
      this.throttle = 0;
      this.readings.fill(0);
    }

    get laps() {
      return Math.floor(this.checkpoints / this.track.n);
    }

    get gateIndex() {
      const n = this.track.n;
      return (this.nextGate - 1 + n) % n;
    }

    sense() {
      const c = this.cfg;
      const idx = this.gateIndex;
      for (let i = 0; i < c.sensorAngles.length; i++) {
        const a = this.angle + c.sensorAngles[i];
        const d = this.track.castRay(this.x, this.y, Math.cos(a), Math.sin(a), c.sensorRange, idx);
        this.readings[i] = 1 - d / c.sensorRange;
      }
    }

    corners() {
      const hl = this.cfg.length / 2;
      const hw = this.cfg.width / 2;
      const c = Math.cos(this.angle);
      const s = Math.sin(this.angle);
      const pts = [];
      for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]) {
        pts.push(this.x + lx * c - ly * s, this.y + lx * s + ly * c);
      }
      return pts;
    }

    hitsWall() {
      const p = this.corners();
      const idx = this.gateIndex;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if (this.track.segmentHitsWall(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], idx)) return true;
      }
      return false;
    }

    update() {
      if (!this.alive) return;
      const c = this.cfg;
      const t = this.track;

      // 1. Perceive
      this.sense();
      this.input.set(this.readings);
      this.input[this.readings.length] = this.speed / c.maxSpeed;

      // 2. Think
      const out = this.brain.forward(this.input);
      this.steer = out[0];
      this.throttle = out[1];

      // 3. Act (simple kinematic model)
      this.speed += this.throttle * c.accel;
      this.speed *= 1 - c.friction;
      if (this.speed > c.maxSpeed) this.speed = c.maxSpeed;
      if (this.speed < 0) this.speed = 0;
      this.angle += this.steer * c.turnRate * Math.min(1, this.speed / 2);
      const px = this.x;
      const py = this.y;
      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;
      this.steps++;
      this.sinceProgress++;

      // 4. Score progress
      for (let k = 0; k < 3; k++) {
        if (!t.crossesGate(this.nextGate, px, py, this.x, this.y)) break;
        this.checkpoints++;
        this.nextGate = (this.nextGate + 1) % t.n;
        this.sinceProgress = 0;
      }

      // 5. Termination
      if (this.hitsWall()) {
        this.alive = false;
        this.crashed = true;
      } else if (this.sinceProgress > c.stallLimit) {
        this.alive = false;
      } else if (c.lapsToFinish > 0 && this.checkpoints >= c.lapsToFinish * t.n) {
        this.alive = false;
        this.finished = true;
      }
      this.fitness = this.computeFitness();
    }

    computeFitness() {
      const t = this.track;
      const g = this.nextGate;
      const d = Math.hypot(this.x - t.cx[g], this.y - t.cy[g]);
      const frac = Math.max(0, Math.min(1, 1 - d / t.segLen));
      let f = this.checkpoints + frac;
      if (this.finished) f += (1 - this.steps / this.cfg.maxSteps) * t.n * 0.5;
      return f;
    }
  }

  NE.CAR_DEFAULTS = CAR_DEFAULTS;
  NE.Car = Car;
})(typeof window !== 'undefined' ? window : globalThis);
