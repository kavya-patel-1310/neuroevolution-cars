// Run with: npm test   (uses Node's built-in test runner, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

for (const f of ['rng', 'nn', 'track', 'car', 'ga', 'sim']) require(path.join(__dirname, '..', 'src', `${f}.js`));
const NE = globalThis.NE;

test('RNG is deterministic for a given seed', () => {
  const a = new NE.RNG(123);
  const b = new NE.RNG(123);
  for (let i = 0; i < 100; i++) assert.equal(a.random(), b.random());
  assert.notEqual(new NE.RNG(1).random(), new NE.RNG(2).random());
});

test('Gaussian samples have roughly zero mean and unit variance', () => {
  const r = new NE.RNG(7);
  const xs = Array.from({ length: 20000 }, () => r.gaussian());
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const varc = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(varc - 1) < 0.05, `variance ${varc}`);
});

test('NeuralNetwork genome size and forward pass', () => {
  const layers = [8, 8, 2];
  assert.equal(NE.NeuralNetwork.genomeSize(layers), 8 * 8 + 8 + 8 * 2 + 2);
  const nn = NE.NeuralNetwork.random(layers, new NE.RNG(1));
  const out = nn.forward(new Float32Array(8).fill(0.5));
  assert.equal(out.length, 2);
  for (const v of out) assert.ok(v >= -1 && v <= 1);
  // Same genome => same output
  const clone = NE.NeuralNetwork.fromJSON(nn.toJSON());
  assert.deepEqual(Array.from(clone.forward(new Float32Array(8).fill(0.5))), Array.from(out));
});

test('NeuralNetwork computes a known value', () => {
  // 1 input -> 1 output, weight 2, bias 0.5: tanh(2*1 + 0.5)
  const nn = new NE.NeuralNetwork([1, 1], [2, 0.5]);
  assert.ok(Math.abs(nn.forward([1])[0] - Math.tanh(2.5)) < 1e-6);
  assert.throws(() => new NE.NeuralNetwork([1, 1], [1, 2, 3]));
});

test('GA keeps population size and preserves elites', () => {
  const rng = new NE.RNG(5);
  const ga = new NE.GeneticAlgorithm({ eliteCount: 2 }, rng);
  const genomes = Array.from({ length: 20 }, (_, i) => new Float32Array(10).fill(i));
  const fitness = genomes.map((_, i) => i); // genome 19 is best
  const next = ga.evolve(genomes, fitness);
  assert.equal(next.length, 20);
  assert.deepEqual(Array.from(next[0]), Array.from(genomes[19]));
  assert.deepEqual(Array.from(next[1]), Array.from(genomes[18]));
});

test('Tournament selection favours fitter individuals', () => {
  const ga = new NE.GeneticAlgorithm({ tournamentSize: 4 }, new NE.RNG(9));
  const fitness = Array.from({ length: 100 }, (_, i) => i);
  let sum = 0;
  for (let k = 0; k < 2000; k++) sum += ga.tournament(fitness);
  assert.ok(sum / 2000 > 70, 'average selected index should be well above the median');
});

test('Generated tracks are valid closed loops across many seeds', () => {
  for (let s = 1; s <= 40; s++) {
    const t = new NE.Track({ seed: s });
    assert.ok(t._isValid(), `track ${s} invalid`);
    assert.equal(t.cx.length, t.n);
  }
});

test('Ray casting finds the wall a known distance away', () => {
  const t = new NE.Track({ seed: 3 });
  const { x, y, angle } = t.start;
  // Perpendicular to the road from the centreline the wall is trackWidth/2 away.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const d = t.castRay(x, y, nx, ny, 500, 0);
  assert.ok(Math.abs(d - t.trackWidth / 2) < 1.5, `distance ${d}`);
});

test('A car that floors it without steering eventually crashes, never cheats a lap', () => {
  const t = new NE.Track({ seed: 3 });
  const brain = new NE.NeuralNetwork([8, 2], new Float32Array(18).fill(0).map((_, i) => (i === 17 ? 5 : 0)));
  const car = new NE.Car(brain, t);
  for (let i = 0; i < 2000 && car.alive; i++) car.update();
  assert.equal(car.alive, false);
  assert.equal(car.crashed, true);
  assert.ok(car.checkpoints < t.n);
});

test('Evolution improves fitness within a few generations', () => {
  const sim = new NE.Simulation({ seed: 1, populationSize: 60, maxSteps: 800 });
  const first = sim.runGeneration().best;
  let best = first;
  for (let g = 0; g < 8; g++) best = Math.max(best, sim.runGeneration().best);
  assert.ok(best > first, `best ${best} should beat first generation ${first}`);
});

test('Saved brains round-trip through export / load', () => {
  const sim = new NE.Simulation({ seed: 2, populationSize: 20, maxSteps: 200 });
  sim.runGeneration();
  const brain = JSON.parse(JSON.stringify(sim.exportBest()));
  const sim2 = new NE.Simulation({ seed: 3, populationSize: 20 });
  sim2.loadBrain(brain);
  assert.deepEqual(Array.from(sim2.genomes[0]), brain.genome.map((v) => Math.fround(v)));
  assert.equal(sim2.cars.length, 20);
});
