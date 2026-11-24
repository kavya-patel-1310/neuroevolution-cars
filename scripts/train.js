#!/usr/bin/env node
/**
 * Headless trainer: evolves drivers without rendering (much faster than the browser),
 * logs per-generation stats to CSV, saves the champion brain, and tests how well the
 * champion generalises to tracks it has never seen.
 *
 * Usage:
 *   node scripts/train.js [--generations 40] [--population 160] [--seed 42]
 *                         [--track 7] [--hidden 8] [--randomize] [--val-tracks 8] [--test-tracks 10]
 *                         [--out models/champion.json] [--log results/history.csv]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['rng', 'nn', 'track', 'car', 'ga', 'sim']) require(path.join(ROOT, 'src', `${f}.js`));
const NE = globalThis.NE;

function parseArgs(argv) {
  const args = {
    generations: 40,
    population: 160,
    seed: 42,
    track: 7,
    hidden: '8',
    randomize: false,
    testTracks: 10,
    valTracks: 8,
    out: 'models/champion.json',
    log: 'results/history.csv',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'randomize') args.randomize = true;
    else if (key in args) args[key] = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  for (const k of ['generations', 'population', 'seed', 'track', 'testTracks', 'valTracks']) args[k] = Number(args[k]);
  args.hidden = String(args.hidden).split(',').map(Number).filter(Boolean);
  return args;
}

/** Drive one brain around an unseen track and report how far it gets. */
function evaluate(brainJson, trackSeed, maxSteps = 4000) {
  const track = new NE.Track({ seed: trackSeed, sensorRange: NE.CAR_DEFAULTS.sensorRange });
  const car = new NE.Car(NE.NeuralNetwork.fromJSON(brainJson), track, { lapsToFinish: 3, maxSteps });
  for (let s = 0; s < maxSteps && car.alive; s++) car.update();
  return {
    trackSeed,
    checkpoints: car.checkpoints,
    laps: car.laps,
    finished: car.finished,
    crashed: car.crashed,
    steps: car.steps,
  };
}

/** Fraction of validation tracks on which the brain completes 3 laps. */
function validationScore(brainJson, seeds) {
  let total = 0;
  for (const s of seeds) {
    const r = evaluate(brainJson, s);
    total += r.finished ? 1 : 0;
  }
  return total / seeds.length;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const sim = new NE.Simulation({
    seed: a.seed,
    trackSeed: a.track,
    populationSize: a.population,
    hidden: a.hidden,
    randomizeTrack: a.randomize,
  });
  console.log(
    `Training ${a.population} cars | net ${sim.layers.join('-')} (${NE.NeuralNetwork.genomeSize(sim.layers)} weights) | ` +
      `seed ${a.seed} | ${a.randomize ? 'random track every generation' : `track ${a.track}`}`
  );
  console.log('gen   best      avg   checkpoints  laps  finished  crashed    val    ms');

  // Validation tracks (seeds 500+) pick the champion; test tracks (seeds 1000+) are never
  // looked at during training, so the final generalisation number is an honest estimate.
  const valSeeds = Array.from({ length: a.valTracks }, (_, i) => 500 + i);
  let champion = null;
  let championVal = -1;
  const t0 = Date.now();
  let firstLap = null;
  for (let g = 0; g < a.generations; g++) {
    const t = Date.now();
    const r = sim.runGeneration();
    if (firstLap === null && r.laps >= 1) firstLap = r.generation;
    // sim.genomes[0] is the elite = best genome of the generation that just ended.
    const candidate = { layers: sim.layers, genome: Array.from(sim.genomes[0]) };
    const val = valSeeds.length ? validationScore(candidate, valSeeds) : r.best;
    r.val = val;
    if (val > championVal || (val === championVal && r.best >= (champion?.fitness ?? -Infinity))) {
      championVal = val;
      champion = { ...candidate, fitness: r.best, generation: r.generation, checkpoints: r.checkpoints, laps: r.laps };
    }
    console.log(
      `${String(r.generation).padStart(3)} ${r.best.toFixed(1).padStart(7)} ${r.avg.toFixed(1).padStart(8)} ` +
        `${String(r.checkpoints).padStart(12)} ${String(r.laps).padStart(5)} ${String(r.finished).padStart(9)} ` +
        `${String(r.crashed).padStart(8)} ${(valSeeds.length ? (val * 100).toFixed(0) + '%' : '-').padStart(6)} ${String(Date.now() - t).padStart(5)}`
    );
  }
  const elapsed = (Date.now() - t0) / 1000;

  const brain = {
    format: 'neuroevolution-cars/brain',
    version: 1,
    ...champion,
    trackSeed: a.randomize ? null : a.track,
    savedAt: new Date().toISOString(),
  };
  const testSeeds = Array.from({ length: a.testTracks }, (_, i) => 1000 + i);
  const tests = testSeeds.map((s) => evaluate(brain, s));
  const passed = tests.filter((t) => t.finished).length;
  brain.training = {
    generations: a.generations,
    population: a.population,
    seed: a.seed,
    track: a.randomize ? 'random' : a.track,
    firstLapGeneration: firstLap,
    validationScore: valSeeds.length ? championVal : null,
    unseenTracksCompleted: `${passed}/${tests.length}`,
  };

  const outPath = path.resolve(ROOT, a.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(brain));
  // Same brain as a script, so the browser can load it even when opened from file://
  fs.writeFileSync(outPath.replace(/\.json$/, '.js'), `window.NE_PRETRAINED = ${JSON.stringify(brain)};\n`);

  const logPath = path.resolve(ROOT, a.log);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const header = 'generation,best_fitness,avg_fitness,leader_checkpoints,leader_laps,finished,crashed,steps,track_seed,val_completion';
  const rows = sim.history.map((r) =>
    [r.generation, r.best.toFixed(3), r.avg.toFixed(3), r.checkpoints, r.laps, r.finished, r.crashed, r.steps, r.trackSeed, (r.val ?? 0).toFixed(3)].join(',')
  );
  fs.writeFileSync(logPath, [header, ...rows].join('\n') + '\n');

  console.log(`\nTrained ${a.generations} generations in ${elapsed.toFixed(1)}s`);
  console.log(`First full lap: ${firstLap ? `generation ${firstLap}` : 'not reached'}`);
  console.log(`Champion: generation ${brain.generation}` + (valSeeds.length ? ` (validation completion ${(championVal * 100).toFixed(0)}%)` : ` (fitness ${brain.fitness.toFixed(1)})`));
  console.log(`Generalisation: completed 3 laps on ${passed}/${tests.length} never-seen tracks`);
  for (const t of tests) {
    console.log(`  track ${t.trackSeed}: ${t.finished ? 'FINISHED' : t.crashed ? 'crashed ' : 'stalled '} after ${t.checkpoints} checkpoints`);
  }
  console.log(`Saved ${path.relative(ROOT, outPath)} and ${path.relative(ROOT, logPath)}`);
}

main();
