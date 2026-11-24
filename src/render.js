/**
 * Canvas rendering: the track + cars, the leader's live neural network, and the
 * per-generation fitness chart. Pure drawing, no simulation logic.
 */
(function (root) {
  const NE = (root.NE = root.NE || {});

  const C = {
    bg: '#0a0b0e',
    road: '#16181e',
    edge: 'rgba(196, 202, 212, 0.55)',
    gate: 'rgba(255, 255, 255, 0.035)',
    car: 'rgba(122, 146, 255, 0.85)',
    dead: 'rgba(255, 93, 108, 0.32)',
    leader: '#ffd166',
    green: '#3ddc97',
    red: '#ff5d6c',
    amber: '#f5b942',
    blue: '#6c8cff',
    text: '#8b919c',
    textBright: '#e6e9ee',
  };
  const INPUT_LABELS = ['L90', 'L55', 'L25', 'FWD', 'R25', 'R55', 'R90', 'SPD'];
  const OUTPUT_LABELS = ['steer', 'gas'];

  function fit(canvas) {
    const dpr = root.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function pathLoop(ctx, xs, ys) {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.closePath();
  }

  class Renderer {
    constructor(world, net, chart) {
      this.world = world;
      this.net = net;
      this.chart = chart;
    }

    drawWorld(sim, opts = {}) {
      const { ctx, w, h } = fit(this.world);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      const t = sim.track;
      const s = Math.min(w / t.width, h / t.height) * 0.98;
      ctx.save();
      ctx.translate((w - t.width * s) / 2, (h - t.height * s) / 2);
      ctx.scale(s, s);
      this._drawTrack(ctx, t);

      const leader = sim.leader();
      if (opts.showDead) for (const c of sim.cars) if (!c.alive) this._drawCar(ctx, c, C.dead);
      for (const c of sim.cars) {
        if (!c.alive || c === leader) continue;
        if (opts.showAllSensors) this._drawSensors(ctx, c, 0.12);
        this._drawCar(ctx, c, C.car);
      }
      if (leader) {
        if (opts.showSensors !== false) this._drawSensors(ctx, leader, 0.9);
        ctx.shadowColor = C.leader;
        ctx.shadowBlur = 12;
        this._drawCar(ctx, leader, leader.alive ? C.leader : C.dead);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    _drawTrack(ctx, t) {
      ctx.lineJoin = 'round';
      pathLoop(ctx, t.cx, t.cy);
      ctx.strokeStyle = C.road;
      ctx.lineWidth = t.trackWidth;
      ctx.stroke();

      ctx.strokeStyle = C.gate;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < t.n; i += 4) {
        ctx.moveTo(t.lx[i], t.ly[i]);
        ctx.lineTo(t.rx[i], t.ry[i]);
      }
      ctx.stroke();

      ctx.strokeStyle = C.edge;
      ctx.lineWidth = 1.2;
      pathLoop(ctx, t.lx, t.ly);
      ctx.stroke();
      pathLoop(ctx, t.rx, t.ry);
      ctx.stroke();

      // Chequered start / finish line
      const squares = 8;
      const dx = (t.rx[0] - t.lx[0]) / squares;
      const dy = (t.ry[0] - t.ly[0]) / squares;
      const ux = t.tx[0] * 3;
      const uy = t.ty[0] * 3;
      for (let i = 0; i < squares; i++) {
        for (let r = 0; r < 2; r++) {
          ctx.fillStyle = (i + r) % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)';
          const x = t.lx[0] + dx * i + ux * (r - 1);
          const y = t.ly[0] + dy * i + uy * (r - 1);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + dx, y + dy);
          ctx.lineTo(x + dx + ux, y + dy + uy);
          ctx.lineTo(x + ux, y + uy);
          ctx.fill();
        }
      }
    }

    _drawCar(ctx, car, color) {
      const L = car.cfg.length;
      const W = car.cfg.width;
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      ctx.fillStyle = color;
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.fillStyle = 'rgba(10,11,14,0.55)';
      ctx.fillRect(L / 2 - 5, -W / 2 + 1.5, 2.5, W - 3); // windscreen
      ctx.restore();
    }

    _drawSensors(ctx, car, alpha) {
      const c = car.cfg;
      ctx.lineWidth = 1;
      for (let i = 0; i < c.sensorAngles.length; i++) {
        const r = car.readings[i];
        const d = (1 - r) * c.sensorRange;
        const a = car.angle + c.sensorAngles[i];
        const x = car.x + Math.cos(a) * d;
        const y = car.y + Math.sin(a) * d;
        const hue = 140 - 140 * r; // green (far) -> red (close)
        ctx.strokeStyle = `hsla(${hue}, 80%, 62%, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        if (r > 0) {
          ctx.fillStyle = `hsla(${hue}, 85%, 65%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawNetwork(nn) {
      const { ctx, w, h } = fit(this.net);
      ctx.clearRect(0, 0, w, h);
      if (!nn) return;
      const L = nn.layers;
      const padX = 40;
      const padY = 14;
      const pos = L.map((n, l) => {
        const x = padX + ((w - padX * 2) * l) / (L.length - 1);
        const gap = (h - padY * 2) / Math.max(1, n);
        return Array.from({ length: n }, (_, i) => [x, padY + gap * (i + 0.5)]);
      });
      for (let l = 1; l < L.length; l++) {
        for (let j = 0; j < L[l]; j++) {
          for (let i = 0; i < L[l - 1]; i++) {
            const wt = nn.weight(l, i, j);
            const signal = Math.abs(nn.activations[l - 1][i]);
            const a = Math.min(1, Math.abs(wt) / 2) * (0.15 + 0.6 * signal);
            ctx.strokeStyle = wt > 0 ? `rgba(61,220,151,${a})` : `rgba(255,93,108,${a})`;
            ctx.lineWidth = 0.4 + Math.min(2, Math.abs(wt));
            ctx.beginPath();
            ctx.moveTo(pos[l - 1][i][0], pos[l - 1][i][1]);
            ctx.lineTo(pos[l][j][0], pos[l][j][1]);
            ctx.stroke();
          }
        }
      }
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      for (let l = 0; l < L.length; l++) {
        for (let i = 0; i < L[l]; i++) {
          const v = nn.activations[l][i];
          const [x, y] = pos[l][i];
          const r = Math.min(7, (h - padY * 2) / L[l] / 2.4);
          ctx.fillStyle = '#0d0f13';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          const base = v >= 0 ? '245,185,66' : '108,140,255';
          ctx.fillStyle = `rgba(${base},${0.15 + 0.85 * Math.abs(v)})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (l === 0) {
            ctx.fillStyle = C.text;
            ctx.textAlign = 'right';
            ctx.fillText(INPUT_LABELS[i] ?? `in${i}`, x - r - 4, y);
          } else if (l === L.length - 1) {
            ctx.fillStyle = C.textBright;
            ctx.textAlign = 'left';
            ctx.fillText(OUTPUT_LABELS[i] ?? `out${i}`, x + r + 4, y - 6);
            ctx.fillStyle = C.text;
            ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(2), x + r + 4, y + 6);
          }
        }
      }
    }

    drawChart(history) {
      const { ctx, w, h } = fit(this.chart);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      if (!history.length) {
        ctx.fillStyle = C.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('waiting for generation 1 to finish…', w / 2, h / 2);
        return;
      }
      const data = history.slice(-36);
      const max = Math.max(...data.map((d) => d.best), 1);
      const padL = 4;
      const padB = 16;
      const padT = 14;
      const bw = (w - padL * 2) / data.length;
      const y = (v) => h - padB - (v / max) * (h - padB - padT);
      data.forEach((d, i) => {
        const x = padL + i * bw;
        ctx.fillStyle = d.laps > 0 ? C.green : 'rgba(61,220,151,0.45)';
        ctx.fillRect(x + bw * 0.12, y(d.best), bw * 0.76, h - padB - y(d.best));
      });
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = padL + i * bw + bw / 2;
        if (i) ctx.lineTo(x, y(d.avg));
        else ctx.moveTo(x, y(d.avg));
      });
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(`gen ${data[0].generation}`, padL, h - 3);
      ctx.textAlign = 'right';
      ctx.fillText(`gen ${data[data.length - 1].generation}`, w - padL, h - 3);
      ctx.fillText(`max ${max.toFixed(0)}`, w - padL, 10);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.green;
      ctx.fillText('■ best', padL, 10);
      ctx.fillStyle = C.amber;
      ctx.fillText('— avg', padL + 50, 10);
    }
  }

  NE.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
