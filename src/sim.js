/**
 * Simulation: owns the track, the population of cars and the evolution loop.
 * Rendering-free, so the same code runs in the browser and in Node (scripts/train.js).
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  const SIM_DEFAULTS = {
    seed: 42,
    trackSeed: 7,
    populationSize: 160,
    hidden: [8],
    maxSteps: 2500,
    randomizeTrack: false,
    car: {},
    ga: {},
  };

  class Simulation {
    constructor(cfg = {}) {
      this.cfg = { ...SIM_DEFAULTS, ...cfg };
      this.rng = new NE.RNG(this.cfg.seed);
      this.carCfg = { ...NE.CAR_DEFAULTS, ...this.cfg.car, maxSteps: this.cfg.maxSteps };
      this.layers = [this.carCfg.sensorAngles.length + 1, ...this.cfg.hidden, 2];
      this.ga = new NE.GeneticAlgorithm(this.cfg.ga, this.rng);
      this.track = this._makeTrack(this.cfg.trackSeed);
      this.generation = 1;
      this.history = [];
      this.best = { fitness: -Infinity, genome: null, generation: 0, checkpoints: 0, laps: 0, trackSeed: null };
      this.demo = false;
      this.totalSteps = 0;
      this.genomes = Array.from({ length: this.cfg.populationSize }, () =>
        NE.NeuralNetwork.random(this.layers, this.rng).genome
      );
      this._spawn();
    }

    _makeTrack(seed) {
      return new NE.Track({ seed, sensorRange: this.carCfg.sensorRange });
    }

    _spawn() {
      this.cars = this.genomes.map(
        (g) => new NE.Car(new NE.NeuralNetwork(this.layers, g), this.track, this.carCfg)
      );
      this.stepCount = 0;
    }

    /** Advance one tick. Returns true when a generation just ended. */
    step() {
      if (this.demo) return this._stepDemo();
      let alive = 0;
      for (const c of this.cars) {
        c.update();
        if (c.alive) alive++;
      }
      this.stepCount++;
      this.totalSteps++;
      if (alive === 0 || this.stepCount >= this.cfg.maxSteps) {
        this._endGeneration();
        return true;
      }
      return false;
    }

    /** Run headless until the current generation ends. */
    runGeneration() {
      while (!this.step()) {}
      return this.history[this.history.length - 1];
    }

    _endGeneration() {
      const f = this.cars.map((c) => c.fitness);
      let bi = 0;
      for (let i = 1; i < f.length; i++) if (f[i] > f[bi]) bi = i;
      const bc = this.cars[bi];
      const avg = f.reduce((a, b) => a + b, 0) / f.length;
      const rec = {
        generation: this.generation,
        best: f[bi],
        avg,
        checkpoints: bc.checkpoints,
        laps: bc.laps,
        finished: this.cars.filter((c) => c.finished).length,
        crashed: this.cars.filter((c) => c.crashed).length,
        steps: this.stepCount,
        trackSeed: this.track.seed,
      };
      this.history.push(rec);
      if (f[bi] > this.best.fitness) {
        this.best = {
          fitness: f[bi],
          genome: Float32Array.from(bc.brain.genome),
          generation: this.generation,
          checkpoints: bc.checkpoints,
          laps: bc.laps,
          trackSeed: this.track.seed,
        };
        if (this.onNewBest) this.onNewBest(this.best);
      }
      this.genomes = this.ga.evolve(this.genomes, f, this.cfg.populationSize);
      if (this.cfg.randomizeTrack) this.track = this._makeTrack(1 + this.rng.int(1e9));
      this.generation++;
      this._spawn();
      if (this.onGeneration) this.onGeneration(rec);
    }

    leader() {
      let best = null;
      for (const c of this.cars) if (c.alive && (!best || c.fitness > best.fitness)) best = c;
      if (!best) for (const c of this.cars) if (!best || c.fitness > best.fitness) best = c;
      return best;
    }

    aliveCount() {
      let n = 0;
      for (const c of this.cars) if (c.alive) n++;
      return n;
    }

    /** Swap to a new track and restart the current generation on it (no evolution step). */
    setTrack(seed) {
      this.cfg.trackSeed = seed;
      this.track = this._makeTrack(seed);
      if (this.demo) this._spawnDemo();
      else this._spawn();
    }

    restartGeneration() {
      if (this.demo) this._spawnDemo();
      else this._spawn();
    }

    // ---- Champion replay -------------------------------------------------
    setDemo(on) {
      if (on && !this.best.genome) return false;
      this.demo = on;
      if (on) this._spawnDemo();
      else this._spawn();
      return true;
    }

    _spawnDemo() {
      const cfg = { ...this.carCfg, lapsToFinish: 0 };
      this.cars = [new NE.Car(new NE.NeuralNetwork(this.layers, this.best.genome), this.track, cfg)];
      this.stepCount = 0;
    }

    _stepDemo() {
      const c = this.cars[0];
      c.update();
      this.stepCount++;
      if (!c.alive || this.stepCount >= this.cfg.maxSteps * 2) {
        c.reset();
        this.stepCount = 0;
      }
      return false;
    }

    // ---- Persistence -----------------------------------------------------
    exportBest() {
      if (!this.best.genome) return null;
      return {
        format: 'neuroevolution-cars/brain',
        version: 1,
        layers: this.layers,
        genome: Array.from(this.best.genome),
        fitness: this.best.fitness,
        generation: this.best.generation,
        checkpoints: this.best.checkpoints,
        laps: this.best.laps,
        trackSeed: this.best.trackSeed,
        savedAt: new Date().toISOString(),
      };
    }

    /** Seed the population from a saved brain: one exact copy + mutated offspring. */
    loadBrain(obj) {
      if (!obj || !Array.isArray(obj.layers) || !obj.genome) throw new Error('Not a brain file');
      if (obj.layers[0] !== this.layers[0] || obj.layers[obj.layers.length - 1] !== 2) {
        throw new Error(`Brain topology ${obj.layers.join('-')} does not fit ${this.layers[0]} inputs / 2 outputs`);
      }
      const nn = NE.NeuralNetwork.fromJSON(obj);
      this.layers = obj.layers.slice();
      this.cfg.hidden = this.layers.slice(1, -1);
      this.genomes = [Float32Array.from(nn.genome)];
      while (this.genomes.length < this.cfg.populationSize) {
        this.genomes.push(this.ga.mutate(Float32Array.from(nn.genome)));
      }
      this.best = {
        fitness: obj.fitness ?? 0,
        genome: Float32Array.from(nn.genome),
        generation: obj.generation ?? 0,
        checkpoints: obj.checkpoints ?? 0,
        laps: obj.laps ?? 0,
        trackSeed: obj.trackSeed ?? null,
      };
      this.demo = false;
      this._spawn();
    }
  }

  NE.SIM_DEFAULTS = SIM_DEFAULTS;
  NE.Simulation = Simulation;
})(typeof window !== 'undefined' ? window : globalThis);
