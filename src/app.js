/**
 * UI wiring: main loop, controls, keyboard shortcuts, save / load.
 */
(function () {
  const NE = window.NE;
  const $ = (id) => document.getElementById(id);

  const ui = {
    world: $('world'), net: $('net'), chart: $('chart'), badge: $('badge'), meta: $('meta'),
    genTitle: $('genTitle'), stAlive: $('stAlive'), stLeader: $('stLeader'), stBest: $('stBest'),
    stLaps: $('stLaps'), stStep: $('stStep'), stTrack: $('stTrack'),
    btnPause: $('btnPause'), btnTurbo: $('btnTurbo'), btnTrack: $('btnTrack'), btnDemo: $('btnDemo'),
    btnPretrained: $('btnPretrained'), btnSave: $('btnSave'), btnLoad: $('btnLoad'), fileLoad: $('fileLoad'),
    btnReset: $('btnReset'),
    speed: $('speed'), mutRate: $('mutRate'), mutStr: $('mutStr'), pop: $('pop'), hidden: $('hidden'),
    seed: $('seed'), randTrack: $('randTrack'), allSensors: $('allSensors'), showDead: $('showDead'),
    oSpeed: $('oSpeed'), oMutRate: $('oMutRate'), oMutStr: $('oMutStr'), oPop: $('oPop'), oHidden: $('oHidden'),
  };

  const state = { paused: false, turbo: false, message: null, messageUntil: 0 };
  const renderer = new NE.Renderer(ui.world, ui.net, ui.chart);
  let sim = null;

  function createSim(trackSeed = 7) {
    sim = new NE.Simulation({
      seed: Number(ui.seed.value) || 0,
      trackSeed,
      populationSize: Number(ui.pop.value),
      hidden: [Number(ui.hidden.value)],
      randomizeTrack: ui.randTrack.checked,
      ga: { mutationRate: Number(ui.mutRate.value), mutationStrength: Number(ui.mutStr.value) },
    });
    sim.onNewBest = () => {
      ui.btnSave.disabled = false;
      ui.btnDemo.disabled = false;
    };
    state.turbo = false;
    ui.btnSave.disabled = true;
    ui.btnDemo.disabled = true;
    updateMeta();
  }

  function updateMeta() {
    ui.meta.textContent =
      `${sim.cfg.populationSize} cars · ${sim.carCfg.sensorAngles.length} sensors → ` +
      `${sim.layers.join('-')} net · genetic algorithm`;
  }

  function flash(msg, ms = 2200) {
    state.message = msg;
    state.messageUntil = performance.now() + ms;
  }

  // ---- Main loop -----------------------------------------------------------
  function frame() {
    if (!state.paused) {
      if (state.turbo && !sim.demo) {
        const start = performance.now();
        const gen = sim.generation;
        while (performance.now() - start < 28) {
          sim.step();
          if (sim.generation !== gen) {
            state.turbo = false;
            break;
          }
        }
      } else {
        const n = Number(ui.speed.value);
        for (let i = 0; i < n; i++) sim.step();
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    renderer.drawWorld(sim, { showDead: ui.showDead.checked, showAllSensors: ui.allSensors.checked });
    const leader = sim.leader();
    renderer.drawNetwork(leader ? leader.brain : null);
    renderer.drawChart(sim.history);

    if (sim.demo) {
      ui.genTitle.textContent = `champion (gen ${sim.best.generation})`;
      ui.stAlive.textContent = 'replay';
    } else {
      ui.genTitle.textContent = `generation ${sim.generation}`;
      ui.stAlive.textContent = `${sim.aliveCount()} / ${sim.cars.length}`;
    }
    ui.stLeader.textContent = leader ? `${leader.checkpoints} checkpoints · ${leader.speed.toFixed(1)} px/t` : '–';
    ui.stBest.textContent = sim.best.genome
      ? `${sim.best.checkpoints} checkpoints (gen ${sim.best.generation})`
      : '–';
    ui.stLaps.textContent = leader ? `${leader.laps}` : '0';
    ui.stStep.textContent = `${sim.stepCount} / ${sim.demo ? sim.cfg.maxSteps * 2 : sim.cfg.maxSteps}`;
    ui.stTrack.textContent = `#${sim.track.seed}${sim.cfg.randomizeTrack ? ' (random each gen)' : ''}`;

    let badge = null;
    if (state.message && performance.now() < state.messageUntil) badge = state.message;
    else if (state.paused) badge = 'paused';
    else if (state.turbo) badge = `fast-forwarding generation ${sim.generation}…`;
    else if (sim.demo) badge = 'champion replay';
    ui.badge.hidden = !badge;
    if (badge) ui.badge.textContent = badge;

    ui.btnPause.textContent = state.paused ? 'Resume' : 'Pause';
    ui.btnTurbo.classList.toggle('active', state.turbo);
    ui.btnDemo.classList.toggle('active', sim.demo);
    ui.btnDemo.textContent = sim.demo ? 'Back to training' : 'Watch champion';
    ui.btnTurbo.disabled = sim.demo;
  }

  // ---- Actions -------------------------------------------------------------
  const actions = {
    pause() { state.paused = !state.paused; },
    turbo() { if (!sim.demo) { state.turbo = !state.turbo; state.paused = false; } },
    newTrack() {
      const seed = 1 + Math.floor(Math.random() * 1e6);
      sim.setTrack(seed);
      flash(`new track #${seed}`);
    },
    demo() {
      if (!sim.setDemo(!sim.demo)) flash('no champion yet: let a generation finish');
      state.turbo = false;
    },
    reset() {
      createSim(sim.track.seed);
      flash('training reset');
    },
    async save() {
      const brain = sim.exportBest();
      if (!brain) return;
      const filename = `car-brain-gen${brain.generation}.json`;
      const text = JSON.stringify(brain, null, 1);
      // Inside the claude.ai artifact viewer, files are saved through its downloads capability.
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          const downloads = await window.claude.use('downloads');
          if (downloads) {
            await downloads.save({ filename, data: text });
            return;
          }
        } catch (e) {
          flash('save cancelled');
          return;
        }
      }
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    loadObject(obj, label) {
      try {
        sim.loadBrain(obj);
        ui.hidden.value = obj.layers.slice(1, -1)[0] ?? ui.hidden.value;
        ui.oHidden.textContent = ui.hidden.value;
        sim.setDemo(true);
        ui.btnSave.disabled = false;
        ui.btnDemo.disabled = false;
        updateMeta();
        flash(`${label} loaded: watching it drive`);
      } catch (e) {
        flash(`could not load: ${e.message}`, 4000);
      }
    },
  };

  ui.btnPause.onclick = actions.pause;
  ui.btnTurbo.onclick = actions.turbo;
  ui.btnTrack.onclick = actions.newTrack;
  ui.btnDemo.onclick = actions.demo;
  ui.btnReset.onclick = actions.reset;
  ui.btnSave.onclick = actions.save;
  ui.btnLoad.onclick = () => ui.fileLoad.click();
  ui.fileLoad.onchange = () => {
    const f = ui.fileLoad.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { actions.loadObject(JSON.parse(reader.result), f.name); }
      catch (e) { flash('that file is not valid JSON', 4000); }
    };
    reader.readAsText(f);
    ui.fileLoad.value = '';
  };
  if (window.NE_PRETRAINED) {
    ui.btnPretrained.onclick = () => actions.loadObject(window.NE_PRETRAINED, 'pretrained champion');
  } else {
    ui.btnPretrained.disabled = true;
    ui.btnPretrained.title = 'Run `npm run train` to create models/champion.js';
  }

  // Live hyperparameters
  const bindOut = (input, out, fmt) => {
    const f = () => { out.textContent = fmt(input.value); };
    input.addEventListener('input', f);
    f();
  };
  bindOut(ui.speed, ui.oSpeed, (v) => `${v}×`);
  bindOut(ui.mutRate, ui.oMutRate, (v) => Number(v).toFixed(2));
  bindOut(ui.mutStr, ui.oMutStr, (v) => Number(v).toFixed(2));
  bindOut(ui.pop, ui.oPop, (v) => v);
  bindOut(ui.hidden, ui.oHidden, (v) => v);
  ui.mutRate.addEventListener('input', () => { sim.ga.cfg.mutationRate = Number(ui.mutRate.value); });
  ui.mutStr.addEventListener('input', () => { sim.ga.cfg.mutationStrength = Number(ui.mutStr.value); });
  ui.randTrack.addEventListener('change', () => { sim.cfg.randomizeTrack = ui.randTrack.checked; });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); actions.pause(); }
    else if (k === 't') actions.turbo();
    else if (k === 'n') actions.newTrack();
    else if (k === 'c') actions.demo();
    else if (k === 'r') actions.reset();
  });

  createSim(7);
  requestAnimationFrame(frame);
})();
