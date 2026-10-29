// Regras da simulação: lotes, filas, workers Dataflow, autoscaling, testes dbt e o incidente.
// Lê o modelo de domínio e as posições do layout. Não desenha nada.
import { rnd, rint, dist } from './util.js';
import { SOURCES, LAYERS, CONSUMERS, CONFIG } from './model.js';
import {
  SOURCE_POS, CONSUMER_POS, SPOTS, SPAWN, SPEED, TRUCK, KICK, FX,
  sourcePath, machineGeom, queuePoint, consumerPath, GATE_PASS, penPos, route,
} from './layout.js';

export const S = {
  t: 0, speed: 1, paused: false, warming: false,
  batches: [], workers: [], trucks: [], pen: [], floaters: [], events: [],
  outcomes: [], lat: [], servedLog: [], thrHist: [], hist: [], tests: [],
  nextBatch: 1001, nextWorker: 1, lastUp: -99, idleFor: 0, hotfix: false, inc: null,
  scanGB: 0, scanUSD: 0, dqPass: 0, dqFail: 0, gateFlash: 0, gateOk: true, rr: 0, sampleAt: 0,
  rowsToday: 0, dups: 0, testFiltered: 0, dlq: 0, filesToday: 0, ingestLog: [],
  sel: null, hover: null, track: null, trackPinned: false, trackDoneAt: null, eventsDirty: true,
};

export const SRC = {};
export const SRCS = SOURCES.map(s => {
  const rt = { ...s, ...SOURCE_POS[s.id], path: sourcePath(s.id), rateMul: 1, drift: false, status: 'ok',
    sent: 0, served: 0, quarTotal: 0, lastServedCreated: null, nextAt: rnd(0, 2), flash: 0 };
  SRC[s.id] = rt; return rt;
});
export const HALL = {};
export const HALLS = LAYERS.map(l => { const h = { ...l, queue: [], processed: 0, procTime: 0, rowsIn: 0, rowsOut: 0 }; HALL[l.id] = h; return h; });
HALLS.forEach(h => {
  h.machines = [0, 1, 2].map(i => ({ i, hall: h, ...machineGeom(h.id, i), worker: null, batch: null, prog: 0, dur: 1 }));
  h.machines.forEach(m => {
    if (h.id === 'raw') { m.out = [...m.outStart, queuePoint('stg')]; m.dest = { type: 'queue', hall: HALL.stg }; }
    if (h.id === 'stg') { m.out = [...m.outStart, GATE_PASS[0]]; m.dest = { type: 'gate' }; }
  });
});
export const CONS = CONSUMERS.map(c => ({ ...c, ...CONSUMER_POS[c.id], received: 0, last: null, lastCreated: null, flash: 0 }));

const WARMUP = 70;
const simBase = Date.now() - WARMUP * 60000;
export const minutesSinceMidnight = () => { const d = new Date(simBase + S.t * 60000); return d.getHours() * 60 + d.getMinutes(); };
export const clockAt = t => { const d = new Date(simBase + t * 60000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function log(level, msg) {
  S.events.unshift({ t: S.t, level, msg }); if (S.events.length > 40) S.events.pop(); S.eventsDirty = true;
}
export const p90 = arr => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]; };

function moveAlong(e, dt, speed) {
  let rem = speed * dt;
  while (rem > 0 && e.pi < e.path.length) {
    const p = e.path[e.pi], dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d <= rem) { e.x = p.x; e.y = p.y; e.pi++; rem -= d; }
    else { e.x += dx / d * rem; e.y += dy / d * rem; rem = 0; }
  }
  return e.pi >= e.path.length;
}

/* ---------- lotes ---------- */
function emit(s) {
  if (s.sprite === 'truck') { S.trucks.push({ src: s, x: TRUCK.start, state: 'in', wait: 0 }); return; }
  if (s.id === 'pubsub') S.dlq += rint(0, 2) + (s.rateMul > 1 ? rint(2, 6) : 0); // JSON malformado vai para a dead letter
  createBatch(s);
}
function createBatch(s) {
  const rows = rint(s.rows[0], s.rows[1]);
  S.batches.push({
    id: 'B-' + (S.nextBatch++), src: s, rows, bad: s.drift, layer: 'raw', state: 'belt',
    path: s.path, pi: 1, x: s.out.x, y: s.out.y, dest: { type: 'queue', hall: HALL.raw }, times: { created: S.t },
  });
  s.sent++; s.flash = 0.5;
  if (s.id === 'gcs') S.filesToday++;
}
function arrive(b) {
  const d = b.dest;
  if (d.type === 'queue') { d.hall.queue.push(b); b.state = 'queued'; }
  else if (d.type === 'gate') runTests(b);
  else if (d.type === 'consumer') serve(b, d.c);
}
function runTests(b) {
  S.gateFlash = 0.35; S.gateOk = !b.bad;
  S.tests.push(!b.bad); if (S.tests.length > 20) S.tests.shift();
  if (b.bad) { S.dqFail++; toQuarantine(b); return; }
  S.dqPass++;
  b.path = GATE_PASS; b.pi = 1; b.dest = { type: 'queue', hall: HALL.mart }; b.state = 'belt';
}
function kick(b, to, d, h, done) { b.state = 'kick'; b.k = { sx: b.x, sy: b.y, tx: to.x, ty: to.y, t: 0, d, h, done }; }
function toQuarantine(b) {
  S.pen.push(b);
  b.red = true; b.src.quarTotal++;
  kick(b, penPos(S.pen.length - 1), 0.9, KICK.quar, () => { b.state = 'quar'; });
  puff(b.x, b.y - 10 * FX, '#d93025');
  S.outcomes.push(false); trimOutcomes();
  if (S.inc && !S.inc.done && S.inc.m.quar == null) {
    mark('quar');
    log('crit', `Contrato do <code>stg_orders</code> falhou no lote ${b.id}: <code>amount</code> não é NUMERIC. Lote isolado em <code>raw.orders_quarantine</code>.`);
  }
}
function replayOne(b) {
  S.pen.splice(S.pen.indexOf(b), 1);
  const q = queuePoint('stg');
  kick(b, { x: q.x, y: q.y + KICK.replayDy }, 1.1, KICK.replay, () => {
    b.bad = false; b.red = false; b.replayed = true; b.layer = 'raw'; b.state = 'queued'; HALL.stg.queue.push(b);
  });
}
function serve(b, c) {
  b.state = 'served'; b.gone = true; b.times.served = S.t; b.consumer = c;
  c.received++; c.last = S.t; c.lastCreated = b.times.created; c.flash = 0.4;
  if (c.id === 'looker') { const gb = 2 + (b.rowsOut ?? b.rows) / 400000; S.scanGB += gb; S.scanUSD += gb / 1024 * CONFIG.scanPerTB; }
  const s = b.src; s.served++; s.lastServedCreated = Math.max(s.lastServedCreated ?? -1, b.times.created);
  S.servedLog.push({ t: S.t, rows: b.rowsOut ?? b.rows });
  const lat = S.t - b.times.created;
  S.lat.push(lat); if (S.lat.length > 12) S.lat.shift();
  if (!b.replayed) { S.outcomes.push(lat <= CONFIG.slaMin); trimOutcomes(); }
}
function trimOutcomes() { while (S.outcomes.length > 20) S.outcomes.shift(); }

/* ---------- trabalho nas máquinas ---------- */
function startJob(m, b) {
  m.batch = b; m.prog = 0; m.dur = m.hall.dur * (0.75 + Math.min(1.2, b.rows / 2.4e6));
  b.state = 'proc'; b.m = m; if (m.worker) m.worker.lastJob = S.t;
}
function finishJob(m, w) {
  const b = m.batch, h = m.hall; m.batch = null;
  b.layer = h.id; b.times[h.id] = S.t; b.state = 'belt'; b.m = null;
  if (h.id === 'mart') { const c = CONS[S.rr++ % CONS.length]; b.path = consumerPath(m, c.cy); b.dest = { type: 'consumer', c }; }
  else { b.path = m.out; b.dest = m.dest; }
  b.x = b.path[0].x; b.y = b.path[0].y; b.pi = 1;
  h.processed++; h.procTime += m.dur;
  if (h.id === 'raw') { h.rowsIn += b.rows; h.rowsOut += b.rows; S.rowsToday += b.rows; S.ingestLog.push({ t: S.t, rows: b.rows }); }
  else if (h.id === 'stg') {
    const dups = Math.round(b.rows * rnd(...h.dupRate)), tst = Math.round(b.rows * rnd(...h.testRate));
    b.dups = dups; b.filtered = tst; b.rowsOut = b.rows - dups - tst;
    h.rowsIn += b.rows; h.rowsOut += b.rowsOut; S.dups += dups; S.testFiltered += tst;
  } else { h.rowsIn += b.rowsOut ?? b.rows; h.rowsOut += b.rowsOut ?? b.rows; }
  if (w) { w.done++; w.lastJob = S.t; }
}

/* ---------- workers Dataflow (empilhadeiras) ---------- */
function walk(w, to, goal, onArrive) { w.path = route(w, to); w.pi = 0; w.state = 'walk'; w.goal = goal; w.onArrive = onArrive; }
function freeSpot(w) { if (w.spot) { w.spot.occ = null; w.spot = null; } }
function release(w) { if (w.machine) { w.machine.worker = null; w.machine = null; } }
function goIdle(w) {
  release(w); freeSpot(w);
  const free = SPOTS.filter(s => !s.occ);
  const sp = free[0] || SPOTS[0];
  sp.occ = w; w.spot = sp;
  walk(w, sp, 'pool', () => { w.state = 'pool'; w.poolSince = S.t; w.face = 1; });
}
function sendToMachine(w, m) {
  freeSpot(w); release(w);
  m.worker = w; w.machine = m;
  walk(w, m.spot, 'machine', () => { w.state = 'work'; w.face = 1; });
}
function spawnWorker() {
  const n = S.nextWorker++;
  const w = { id: n, name: 'worker-' + String(n).padStart(2, '0'), x: SPAWN.x, y: SPAWN.y, face: -1, anim: Math.random() * 3,
    state: 'spawn', spawnT: 1.6, fade: 0, done: 0, born: S.t, lastJob: S.t, path: [], pi: 0 };
  S.workers.push(w);
  sparkle(w.x, w.y - 30 * FX);
  return w;
}
function retire(w) {
  release(w); freeSpot(w);
  walk(w, SPAWN, 'leave', () => { w.state = 'sink'; w.fade = 1; });
}
function updateWorker(w, dt) {
  w.anim += dt;
  if (w.state === 'spawn') { w.spawnT -= dt; if (w.spawnT <= 0) goIdle(w); return; }
  if (w.state === 'sink') { w.fade -= dt * 1.5; if (w.fade <= 0) w.gone = true; return; }
  if (w.state === 'walk') {
    const px = w.x;
    if (moveAlong(w, dt, SPEED.walk)) w.onArrive();
    else if (Math.abs(w.x - px) > 0.01) w.face = w.x > px ? 1 : -1;
    return;
  }
  if (w.state === 'work') {
    const m = w.machine;
    if (!m) { w.state = 'hallIdle'; return; }
    if (!m.batch) {
      if (m.hall.queue.length) startJob(m, m.hall.queue.shift());
      else if (S.t - w.lastJob > 3) { release(w); w.state = 'hallIdle'; }
    } else { m.prog += dt; if (m.prog >= m.dur) finishJob(m, w); }
    return;
  }
  if (w.state === 'hallIdle' && S.t - w.lastJob > 6) goIdle(w);
}
function assign() {
  for (const h of HALLS) {
    let pending = h.queue.length - h.machines.filter(m => m.worker && !m.batch).length;
    for (const m of h.machines) {
      if (pending <= 0) break;
      if (m.worker) continue;
      const cands = S.workers.filter(w => w.state === 'hallIdle' || w.state === 'pool' || (w.state === 'walk' && w.goal === 'pool'));
      if (!cands.length) return;
      const cost = w => (S.t - w.lastJob) + dist(w, m.spot) / SPEED.walk;
      cands.sort((a, b) => cost(a) - cost(b));
      sendToMachine(cands[0], m); pending--;
    }
  }
}
export const backlog = () => HALLS.reduce((a, h) => a + h.queue.length, 0);
export const activeWorkers = () => S.workers.filter(w => !w.gone && w.goal !== 'leave' && w.state !== 'sink');
function autoscale(dt) {
  const bl = backlog(), n = activeWorkers().length;
  if (bl >= CONFIG.scaleUpBacklog && n < CONFIG.maxWorkers && S.t - S.lastUp > CONFIG.scaleUpCooldown) {
    spawnWorker(); S.lastUp = S.t;
    log('info', `Dataflow autoscaling: +1 worker (fila total ${bl}) → ${n + 1}/${CONFIG.maxWorkers}. Cold start em andamento.`);
    if (S.inc && !S.inc.done && S.inc.m.scale == null) mark('scale');
  }
  const idle = S.workers.filter(w => w.state === 'pool' && S.t - w.poolSince > 3);
  if (idle.length >= 1 && n > CONFIG.minWorkers && bl <= 1) {
    S.idleFor += dt;
    if (S.idleFor > CONFIG.scaleDownAfter) {
      const w = idle.sort((a, b) => a.poolSince - b.poolSince)[0];
      retire(w); S.idleFor = 0;
      log('info', `Dataflow autoscaling: −1 worker ocioso (${w.name}) → ${n - 1}/${CONFIG.maxWorkers}`);
    }
  } else S.idleFor = Math.max(0, S.idleFor - dt * 2);
}

/* ---------- caminhões do GCS ---------- */
function updateTrucks(dt) {
  for (const t of S.trucks) {
    if (t.state === 'in') { t.x = Math.min(TRUCK.park, t.x + SPEED.truck * dt); if (t.x >= TRUCK.park) { t.state = 'unload'; t.wait = 0.9; createBatch(t.src); } }
    else if (t.state === 'unload') { t.wait -= dt; if (t.wait <= 0) t.state = 'out'; }
    else { t.x -= SPEED.truck * dt; if (t.x < TRUCK.leave) t.gone = true; }
  }
  S.trucks = S.trucks.filter(t => !t.gone);
}

/* ---------- incidente roteirizado ---------- */
export const INC_STEPS = [
  ['spike', 'Pico de tráfego'], ['drift', 'Schema drift'], ['scale', 'Autoscaling'], ['quar', 'Quarentena'],
  ['fix', 'Hotfix'], ['replay', 'Replay'], ['normal', 'Normalizado'],
];
function mark(k) { if (S.inc) S.inc.m[k] = S.t; }
export function startIncident() {
  if (S.inc && !S.inc.done) return;
  const p = SRC.pubsub;
  S.inc = { t0: S.t, m: {}, done: false };
  S.hotfix = false;
  mark('spike');
  p.rateMul = 6; p.status = 'spike'; p.nextAt = S.t + 0.2;
  log('warn', 'Deploy no serviço de pedidos: Pub/Sub <code>orders-events</code> com 6× o volume normal');
}
function updateIncident() {
  const I = S.inc; if (!I || I.done) return;
  const e = S.t - I.t0, p = SRC.pubsub;
  if (I.m.drift == null && e >= 0.5) {
    p.drift = true; p.schema = 'v7'; p.status = 'drift'; mark('drift');
    log('crit', 'O mesmo deploy mudou o schema para v7 sem aviso: <code>amount</code> agora chega como STRING');
  }
  if (I.m.fix == null && I.m.quar != null && S.t - I.m.quar >= 5) {
    S.hotfix = true; p.drift = false; p.schema = 'v7 + cast'; p.status = 'spike'; mark('fix');
    log('ok', 'Hotfix em produção: <code>SAFE_CAST(amount AS NUMERIC)</code> no <code>stg_orders</code>. Lotes antigos ainda chegam inválidos e serão reprocessados.');
  }
  if (!I.spikeOver && I.m.fix != null && S.t - I.m.fix >= 1) { p.rateMul = 1; p.status = 'ok'; I.spikeOver = true; log('info', 'Tráfego do Pub/Sub voltou ao normal'); }
  if (I.m.replay == null && I.m.fix != null && S.t - I.m.fix >= 3) {
    mark('replay'); I.replaying = true; I.replayNext = S.t;
    log('info', `Replay de ${S.pen.length} lotes de <code>raw.orders_quarantine</code> de volta para o staging`);
  }
  if (I.replaying) {
    const ready = S.pen.filter(b => b.state === 'quar');
    if (ready.length && S.t >= I.replayNext) { replayOne(ready[ready.length - 1]); I.replayNext = S.t + 0.3; }
    if (!S.pen.length && !S.batches.some(b => b.bad)) I.replaying = false;
  }
  const recent = S.outcomes.slice(-8);
  if (I.m.replay != null && !I.replaying && I.m.normal == null && e > 30 && backlog() <= 4 && !S.batches.some(b => b.replayed)
      && recent.length === 8 && recent.every(Boolean) && p90(S.lat) < 48) {
    mark('normal'); I.done = true;
    if (I.m.scale == null) I.m.scale = I.m.replay;
    log('ok', `Pipeline normalizado em ${Math.round(e)} min: fila zerada, quarentena vazia, lotes novos dentro do SLA. O % da janela sobe conforme os atrasados saem dela.`);
  }
}

/* ---------- efeitos ---------- */
function puff(x, y, c) { for (let i = 0; i < 8; i++) S.floaters.push({ kind: 'dot', x, y, vx: rnd(-60, 60) * FX, vy: rnd(-90, -20) * FX, life: 0.6, max: 0.6, c }); }
function sparkle(x, y) { for (let i = 0; i < 10; i++) S.floaters.push({ kind: 'dot', x, y, vx: rnd(-50, 50) * FX, vy: rnd(-110, -30) * FX, life: 0.9, max: 0.9, c: '#f9ab00' }); }

/* ---------- passo ---------- */
export function step(dt) {
  S.t += dt;
  for (const s of SRCS) {
    s.flash = Math.max(0, s.flash - dt);
    if (S.t >= s.nextAt) {
      emit(s);
      const lam = s.rate * s.rateMul;
      s.nextAt = S.t + Math.max(s.rateMul > 1 ? 0.55 : 0.8, rnd(0.5, 1.5) / lam);
    }
  }
  updateTrucks(dt);
  for (const b of S.batches) {
    if (b.state === 'belt') { if (moveAlong(b, dt, SPEED.belt)) arrive(b); }
    else if (b.state === 'kick') {
      const k = b.k; k.t += dt; const u = Math.min(1, k.t / k.d);
      b.x = k.sx + (k.tx - k.sx) * u; b.y = k.sy + (k.ty - k.sy) * u - k.h * 4 * u * (1 - u);
      if (u >= 1) { b.x = k.tx; b.y = k.ty; k.done(); }
    }
  }
  S.batches = S.batches.filter(b => !b.gone);
  for (const w of S.workers) updateWorker(w, dt);
  S.workers = S.workers.filter(w => !w.gone);
  assign();
  if (!S.warming) autoscale(dt);
  updateIncident();
  S.gateFlash = Math.max(0, S.gateFlash - dt);
  CONS.forEach(c => { c.flash = Math.max(0, c.flash - dt); });
  for (const f of S.floaters) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 220 * FX * dt; f.life -= dt; }
  S.floaters = S.floaters.filter(f => f.life > 0);
  if (S.t >= S.sampleAt) {
    S.sampleAt = S.t + 1;
    while (S.servedLog.length && S.servedLog[0].t < S.t - 15) S.servedLog.shift();
    const thr = S.servedLog.reduce((a, x) => a + x.rows, 0) / 15;
    S.thrHist.push(thr); if (S.thrHist.length > 60) S.thrHist.shift();
    const last = S.hist[S.hist.length - 1];
    while (S.ingestLog.length && S.ingestLog[0].t < S.t - 15) S.ingestLog.shift();
    const mx = metrics();
    S.hist.push({ t: S.t, thr, rps: mx.rps, backlog: mx.backlog, ingest: S.ingestLog.reduce((a, x) => a + x.rows, 0) / 15, pass: S.dqPass - (last ? last.passTot : 0), fail: S.dqFail - (last ? last.failTot : 0),
      passTot: S.dqPass, failTot: S.dqFail, workers: activeWorkers().length });
    if (S.hist.length > 60) S.hist.shift();
  }
  const tb = S.track;
  if (tb && (tb.state === 'served' || tb.state === 'quar') && S.trackDoneAt == null) S.trackDoneAt = S.t;
  if (!tb || (S.trackDoneAt != null && S.t - S.trackDoneAt > (S.trackPinned ? 10 : 4))) {
    const cand = [...S.batches].reverse().find(b => b.state === 'belt' && b.layer === 'raw' && !b.replayed);
    if (cand) { S.track = cand; S.trackPinned = false; S.trackDoneAt = null; }
  }
}

// Métricas que um time de dados olharia no Cloud Monitoring, derivadas do estado da cena.
const notIngested = id => S.batches.filter(b => b.src.id === id && b.times.raw == null && !b.gone);
export function metrics() {
  const p = SRC.pubsub, wave = 1 + 0.05 * Math.sin(S.t * 0.7) + 0.025 * Math.sin(S.t * 2.3);
  const pend = notIngested('pubsub'), cdc = notIngested('cloudsql');
  const backlog = pend.reduce((a, b) => a + (b.state === 'belt' ? b.rows * 0.4 : b.rows), 0) + 24000 + 9000 * Math.sin(S.t * 1.3);
  const oldest = pend.length ? Math.max(...pend.map(b => S.t - b.times.created)) : 0.4;
  const dsLag = cdc.length ? Math.max(...cdc.map(b => S.t - b.times.created)) : 0.3;
  const rawQ = HALL.raw.queue, sysLag = rawQ.length ? Math.max(...rawQ.map(b => S.t - b.times.created)) : 0.5;
  const busy = HALL.stg.machines.filter(m => m.batch).length + HALL.mart.machines.filter(m => m.batch).length;
  return {
    rps: p.baseRps * p.rateMul * wave,
    err5xx: p.rateMul > 1 ? 0.38 + 0.05 * Math.sin(S.t * 3) : 0.02 + 0.006 * Math.sin(S.t),
    backlog: Math.max(0, backlog), oldest, dsLag, sysLag,
    cdcRps: SRC.cloudsql.baseRps * (1 + 0.04 * Math.sin(S.t * 0.9)),
    slots: Math.min(CONFIG.slotsReserved, Math.round(160 + busy * 290 + 40 * Math.sin(S.t * 1.7))),
  };
}

// Aquece a simulação para a primeira tela já mostrar o pipeline em regime.
export function warmup() {
  for (let i = 0; i < 5; i++) { const w = spawnWorker(); w.spawnT = 0; w.x = SPOTS[i].x; w.y = SPOTS[i].y; }
  S.warming = true;
  for (let i = 0; i < WARMUP * 10; i++) step(0.1);
  S.warming = false;
  // contadores do dia: o painel abre no meio de um dia de operação, não do zero
  const sofar = minutesSinceMidnight() * CONFIG.rowsPerMinDay * rnd(0.92, 0.98);
  S.rowsToday += sofar; S.dups += sofar * 0.008; S.testFiltered += sofar * 0.021;
  S.dlq += Math.round(sofar / 1e6 * 4.1); S.filesToday += Math.floor(minutesSinceMidnight() / 60 * 4);
  HALL.raw.rowsIn += sofar; HALL.raw.rowsOut += sofar;
  HALL.stg.rowsIn += sofar; HALL.stg.rowsOut += sofar * 0.971; HALL.mart.rowsIn += sofar * 0.971; HALL.mart.rowsOut += sofar * 0.971;
  S.events = []; S.floaters = [];
  log('ok', 'Pipeline em execução: 3 fontes, 3 camadas no BigQuery, 3 consumidores');
}
