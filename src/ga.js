/**
 * Genetic algorithm over flat weight vectors (neuroevolution).
 *
 *  - Elitism:      the top `eliteCount` genomes survive unchanged.
 *  - Selection:    tournament selection (pick k at random, keep the fittest).
 *  - Crossover:    uniform crossover with probability `crossoverRate`.
 *  - Mutation:     each gene mutates with probability `mutationRate`:
 *                  usually a Gaussian nudge (sigma = `mutationStrength`),
 *                  occasionally a full reset to catch up on lost diversity.
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  const GA_DEFAULTS = {
    eliteCount: 4,
    tournamentSize: 4,
    crossoverRate: 0.5,
    mutationRate: 0.1,
    mutationStrength: 0.35,
    resetChance: 0.05,
  };

  class GeneticAlgorithm {
    constructor(cfg = {}, rng) {
      this.cfg = { ...GA_DEFAULTS, ...cfg };
      this.rng = rng || new NE.RNG(1);
    }

    rank(fitness) {
      return fitness.map((_, i) => i).sort((a, b) => fitness[b] - fitness[a]);
    }

    tournament(fitness) {
      let best = -1;
      for (let k = 0; k < this.cfg.tournamentSize; k++) {
        const i = this.rng.int(fitness.length);
        if (best < 0 || fitness[i] > fitness[best]) best = i;
      }
      return best;
    }

    crossover(a, b) {
      const c = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) c[i] = this.rng.random() < 0.5 ? a[i] : b[i];
      return c;
    }

    mutate(g) {
      const { mutationRate, mutationStrength, resetChance } = this.cfg;
      for (let i = 0; i < g.length; i++) {
        if (this.rng.random() < mutationRate) {
          if (this.rng.random() < resetChance) g[i] = this.rng.gaussian();
          else g[i] += this.rng.gaussian() * mutationStrength;
        }
      }
      return g;
    }

    /** Produce the next generation from current genomes and their fitness scores. */
    evolve(genomes, fitness, size = genomes.length) {
      const order = this.rank(fitness);
      const next = [];
      const elites = Math.min(this.cfg.eliteCount, size, genomes.length);
      for (let i = 0; i < elites; i++) next.push(Float32Array.from(genomes[order[i]]));
      while (next.length < size) {
        const p1 = genomes[this.tournament(fitness)];
        const child =
          this.rng.random() < this.cfg.crossoverRate
            ? this.crossover(p1, genomes[this.tournament(fitness)])
            : Float32Array.from(p1);
        next.push(this.mutate(child));
      }
      return next;
    }
  }

  NE.GA_DEFAULTS = GA_DEFAULTS;
  NE.GeneticAlgorithm = GeneticAlgorithm;
})(typeof window !== 'undefined' ? window : globalThis);
