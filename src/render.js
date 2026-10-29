// Planta do galpão em pixel art clara, vista de cima. Só lê o estado da simulação.
// A arte é desenhada em baixa resolução e ampliada; textos e etiquetas são desenhados por cima, nítidos.
import { S, SRC, HALL, HALLS, CONS, INC_STEPS, metrics } from './sim.js';
import { CONFIG } from './model.js';
import {
  W, H, SCALE, LANE, BUILDING, ROOMS, HALL_X, SOURCE_POS, TRUCK,
  penPos, stackPos, STACK_MAX, GATE, allPaths, DOOR_X,
} from './layout.js';
import { hash, nf0, nf1, usd, big, pct } from './util.js';

export const LW = W * SCALE, LH = H * SCALE;
const K = SCALE;
let cv, g, pcv, pc, bcv, bc, DPR = 1;
const HB = [];
const FONT = "'Barlow Condensed','Arial Narrow',sans-serif";
const MONO = "'Roboto Mono',ui-monospace,monospace";
const SANS = "'Roboto',system-ui,sans-serif";
const INK = '#202124', MUTED = '#5f6368', OK = '#34a853', WARN = '#f9ab00', CRIT = '#d93025', BLUE = '#1a73e8';
const MEDAL = {
  raw:  { name: 'BRONZE', sub: 'raw.orders_events · Dataflow', a: '#f8ebdd', b: '#f3e2d0', line: '#c4823f', sign: '#b0703a', ink: '#ffffff', screen: '#ffb27a' },
  stg:  { name: 'SILVER', sub: 'stg_orders · dbt',              a: '#f1f4f8', b: '#e7ebf1', line: '#9aa5b5', sign: '#a9b3c1', ink: '#202124', screen: '#dbe7ff' },
  mart: { name: 'GOLD',   sub: 'mart_daily_revenue · dbt',      a: '#fcf5dc', b: '#f6ecc6', line: '#e0ad1d', sign: '#e9b92f', ink: '#3b2a00', screen: '#ffe27a' },
};
const CRATE = {
  raw:  { fill: '#c98d52', top: '#e0aa72', edge: '#9c6634' },
  stg:  { fill: '#dfe4eb', top: '#ffffff', edge: '#8f9aab' },
  mart: { fill: '#e9b92f', top: '#f7d36a', edge: '#b38712' },
  red:  { fill: '#e5484d', top: '#f27a7e', edge: '#b42b30' },
};
const SRC_COLOR = { pubsub: '#34a853', cloudsql: '#4285f4', gcs: '#fbbc04' };
const SHIRTS = ['#4285f4', '#34a853', '#ea4335', '#9b6bff', '#ff8a3d', '#00a3a3', '#e91e63', '#5c6bc0', '#7cb342'];
const SKINS = ['#f1c7a3', '#d9a179', '#a86f4c', '#7a4a32', '#e8b48f', '#c58c63'];

const SEGS = (() => {
  const out = [], seen = new Set();
  for (const p of allPaths()) for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1]; if (a.x === b.x && a.y === b.y) continue;
    const k = [a.x, a.y, b.x, b.y].join(); if (seen.has(k)) continue; seen.add(k); out.push({ a, b });
  }
  return out;
})();

export function initRender(canvas) {
  cv = canvas; DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = LW * DPR; cv.height = LH * DPR; g = cv.getContext('2d');
  pcv = document.createElement('canvas'); pcv.width = W; pcv.height = H; pc = pcv.getContext('2d');
  bcv = document.createElement('canvas'); bcv.width = W; bcv.height = H; bc = bcv.getContext('2d');
  drawStatic();
}
export const getHitboxes = () => HB;

/* ---------------- helpers ---------------- */
function R(x, y, w, h, c, ctx = pc) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function rr(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function fillRR(x, y, w, h, r, fill) { rr(x, y, w, h, r); g.fillStyle = fill; g.fill(); }
function text(s, x, y, font, color, align = 'left', base = 'alphabetic') { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y); }
function dot(x, y, r, c) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c; g.fill(); }
function pill(t, cx, cy, bg, fg, font, border) {
  g.font = font; const w = g.measureText(t).width + 14, h = 20, x = cx - w / 2, y = cy - h / 2;
  fillRR(x, y + 1.5, w, h, 10, 'rgba(32,33,36,.14)');
  fillRR(x, y, w, h, 10, bg);
  if (border) { rr(x, y, w, h, 10); g.strokeStyle = border; g.lineWidth = 1.5; g.stroke(); }
  text(t, cx, cy + 1, font, fg, 'center', 'middle');
  return { x, y, w, h };
}
const hit = (type, ref, x, y, w, h, pri) => HB.push({ type, ref, r: { x: x * K, y: y * K, w: w * K, h: h * K }, pri });

/* ---------------- camada estática (pixels) ---------------- */
function checker(x, y, w, h, a, b, ctx) {
  for (let yy = y; yy < y + h; yy += 6) for (let xx = x; xx < x + w; xx += 6) R(xx, yy, Math.min(6, x + w - xx), Math.min(6, y + h - yy), ((xx - x) / 6 + (yy - y) / 6) % 2 ? b : a, ctx);
}
function drawStatic() {
  const c = bc, r = (x, y, w, h, col) => R(x, y, w, h, col, c);
  r(0, 0, W, H, '#e4f1dd');
  for (let i = 0; i < 160; i++) r(Math.floor(hash(i, 1, 1) * W), Math.floor(hash(i, 2, 2) * H), 1, 1, '#cfe5c4');
  r(0, 198, 84, 14, '#d5dae1'); for (let x = 2; x < 80; x += 8) r(x, 204, 4, 1, '#ffffff');
  // prédio
  r(BUILDING.x, BUILDING.y, BUILDING.w, BUILDING.h, '#c7cfda');
  r(BUILDING.x, BUILDING.y, BUILDING.w, 1, '#ffffff'); r(BUILDING.x, BUILDING.y + BUILDING.h - 1, BUILDING.w, 1, '#a9b3c1');
  ['raw', 'stg', 'mart'].forEach(id => { const m = MEDAL[id], o = ROOMS[id]; checker(o.x, o.y, o.w, o.h, m.a, m.b, c); r(o.x, o.y + o.h - 2, o.w, 2, m.line); });
  checker(ROOMS.corr.x, ROOMS.corr.y, ROOMS.corr.w, ROOMS.corr.h, '#f1f3f6', '#eceff3', c);
  checker(ROOMS.pool.x, ROOMS.pool.y, ROOMS.pool.w, ROOMS.pool.h, '#f6efe4', '#f0e7da', c);
  checker(ROOMS.quar.x, ROOMS.quar.y, ROOMS.quar.w, ROOMS.quar.h, '#fdf0f0', '#f9e5e5', c);
  checker(ROOMS.ctrl.x, ROOMS.ctrl.y, ROOMS.ctrl.w, ROOMS.ctrl.h, '#eff3f9', '#e8edf5', c);
  Object.values(ROOMS).forEach(o => r(o.x, o.y, o.w, 1, 'rgba(0,0,0,.08)'));
  Object.entries(DOOR_X).forEach(([id, x]) => { if (id === 'pool') r(x - 7, 142, 14, 4, '#f1f3f6'); else r(x - 7, 118, 14, 4, '#f1f3f6'); });
  for (let x = 90; x < 412; x += 8) { r(x, 123, 4, 1, '#f2c14e'); r(x, 141, 4, 1, '#f2c14e'); }
  // elevador do autoscaling
  r(414, 124, 6, 17, '#9aa5b5'); r(415, 125, 2, 15, '#dfe4eb'); r(417, 125, 2, 15, '#dfe4eb'); r(412, 122, 8, 2, '#f9ab00');
  // copa
  r(94, 150, 11, 13, '#5c6b7d'); r(94, 150, 11, 2, '#7d8ea3'); r(96, 154, 7, 4, '#1d2f4a'); r(97, 155, 2, 1, '#34a853'); r(97, 160, 5, 1, '#c7cfda');
  r(104, 212, 40, 16, '#e4d6f0'); r(104, 212, 40, 1, '#cbb5df');
  r(106, 214, 36, 4, '#9b6bb8'); r(106, 218, 36, 6, '#b78bd1'); r(104, 214, 2, 10, '#8a5aa8'); r(142, 214, 2, 10, '#8a5aa8');
  r(166, 186, 12, 8, '#b08458'); r(166, 186, 12, 1, '#c9a074');
  r(183, 150, 11, 14, '#5a4b8a'); r(183, 150, 11, 2, '#7a69b0'); r(185, 153, 7, 5, '#1d2f4a'); r(186, 160, 1, 1, '#ea4335'); r(188, 160, 1, 1, '#fbbc04');
  [[92, 222], [192, 222]].forEach(([x, y]) => { r(x, y + 2, 5, 4, '#b07a50'); r(x - 1, y - 3, 7, 5, '#5fb06a'); r(x + 1, y - 5, 3, 2, '#5fb06a'); });
  // quarentena
  const q = ROOMS.quar;
  for (let x = q.x; x < q.x + q.w; x += 6) { r(x, q.y + 14, 3, 2, '#f9ab00'); r(x + 3, q.y + 14, 3, 2, '#3c4654'); r(x, q.y + q.h - 2, 3, 2, '#f9ab00'); r(x + 3, q.y + q.h - 2, 3, 2, '#3c4654'); }
  // sala de controle
  const k = ROOMS.ctrl;
  r(k.x + 8, k.y + 14, k.w - 16, 40, '#2b3440'); r(k.x + 9, k.y + 15, k.w - 18, 38, '#18212d');
  [[k.x + 10, k.y + 64], [k.x + 58, k.y + 64]].forEach(([x, y]) => { r(x, y, 40, 8, '#b08458'); r(x, y, 40, 1, '#c9a074'); r(x + 6, y - 5, 10, 5, '#2b3440'); r(x + 24, y - 5, 10, 5, '#2b3440'); r(x + 7, y - 4, 8, 3, '#4285f4'); r(x + 25, y - 4, 8, 3, '#34a853'); r(x + 14, y + 10, 6, 4, '#5c6b7d'); });
  // fontes
  r(10, 104, 34, 30, '#eef1f5'); r(10, 104, 34, 2, '#c7cfda'); r(10, 133, 34, 1, '#a9b3c1');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) r(14 + i * 7, 110 + j * 7, 4, 4, '#a8c7f0');
  r(14, 52, 18, 6, '#c7cfda'); r(14, 52, 18, 1, '#ffffff');
  r(44, 190, 10, 12, '#9aa5b5'); r(44, 190, 10, 1, '#f9ab00');
  // consumidores
  r(452, 66, 26, 16, '#eef1f5'); r(452, 66, 26, 1, '#c7cfda'); r(462, 76, 6, 6, '#a9b3c1');
  r(446, 10, 74, 52, '#2b3440'); r(448, 12, 70, 48, '#ffffff'); r(470, 62, 3, 4, '#5c6b7d'); r(496, 62, 3, 4, '#5c6b7d');
  r(452, 100, 52, 32, '#eef1f5'); r(452, 100, 52, 1, '#c7cfda');
  r(452, 168, 52, 36, '#33475f'); for (let i = 0; i < 3; i++) r(456 + i * 16, 172, 12, 28, '#26364a');
  // esteiras
  SEGS.forEach(({ a, b }) => {
    if (a.y === b.y) { const x0 = Math.min(a.x, b.x), L = Math.abs(a.x - b.x); r(x0 - 2, a.y - 2, L + 5, 5, '#5f6b7d'); r(x0 - 2, a.y - 1, L + 5, 3, '#808b9d'); }
    else { const y0 = Math.min(a.y, b.y), L = Math.abs(a.y - b.y); r(a.x - 2, y0 - 2, 5, L + 5, '#5f6b7d'); r(a.x - 1, y0 - 2, 3, L + 5, '#808b9d'); }
  });
  r(GATE.x + 3, LANE - 8, 2, 16, '#5c6b7d'); r(GATE.x + 9, LANE - 8, 2, 16, '#5c6b7d');
}

/* ---------------- objetos (pixels) ---------------- */
function drawCrate(b) {
  const c = b.red ? CRATE.red : CRATE[b.layer], x = Math.round(b.x) - 3, y = Math.round(b.y) - 5;
  R(x, y, 6, 5, c.fill); R(x, y, 6, 1, c.top); R(x + 5, y + 1, 1, 4, c.edge); R(x, y + 4, 6, 1, c.edge);
  if (!b.red) R(x + 1, y + 2, 2, 1, b.layer === 'mart' ? '#ffffff' : SRC_COLOR[b.src.id]);
  if (b.bad && !b.red) R(x + 4, y + 1, 1, 1, CRIT);
  hit('batch', b, x - 1, y - 1, 8, 7, 5);
}
function drawMachine(m, T) {
  const busy = !!m.batch, x = m.x, y = m.y, md = MEDAL[m.hall.id];
  R(x, y, 20, 14, '#3b5f91'); R(x, y, 20, 2, '#5274bb'); R(x, y + 13, 20, 1, '#2b4670');
  R(x + 3, y + 4, 9, 5, busy ? md.screen : '#1d2f4a');
  if (busy) R(x + 3, y + 4 + (Math.floor(T * 8) % 5), 9, 1, 'rgba(255,255,255,.55)');
  R(x + 15, y + 5, 2, 2, busy ? OK : (m.worker ? WARN : '#55657a'));
  R(x + 3, y + 11, 14, 1, '#1d2f4a');
  if (busy) R(x + 3, y + 11, Math.max(1, Math.round(14 * Math.min(1, m.prog / m.dur))), 1, OK);
  hit('machine', m, x - 2, y - 7, 24, 22, 4);
  if (busy) { const b = m.batch; b.x = x + 10 + (Math.floor(T * 14) % 2 ? 0.4 : 0); b.y = y + 1; drawCrate(b); }
}
function drawShelf(h, T) {
  const o = ROOMS[h.id], cols = h.id === 'raw' ? 3 : 4, x0 = o.x + o.w - 4 - cols * 7, st = CRATE[h.id];
  R(x0 - 1, o.y + 2, cols * 7 + 1, 16, '#c7cfda');
  const filled = Math.min(cols * 2, h.processed), newest = (h.processed - 1) % (cols * 2);
  for (let k = 0; k < cols * 2; k++) {
    const x = x0 + (k % cols) * 7, y = o.y + 4 + Math.floor(k / cols) * 7;
    R(x, y + 5, 6, 1, '#7d8ea3');
    if (k < filled) { R(x, y, 6, 5, st.fill); R(x, y, 6, 1, st.top); if (k === newest && Math.floor(T * 3) % 2) R(x, y, 6, 1, OK); }
  }
}
function drawGate() {
  const col = S.gateFlash > 0 ? (S.gateOk ? OK : CRIT) : '#9aa5b5';
  R(GATE.x + 2, LANE - 10, 10, 2, col);
  if (S.gateFlash > 0) R(GATE.x + 5, LANE - 8, 4, 16, S.gateOk ? 'rgba(52,168,83,.35)' : 'rgba(217,48,37,.4)');
  hit('gate', null, GATE.x - 2, LANE - 12, 16, 22, 4);
}
function drawWorker(w, T) {
  const x = Math.round(w.x), y = Math.round(w.y), f = w.face || 1;
  const sit = w.state === 'pool' && w.spot && w.spot.kind === 'sofa';
  const step = w.state === 'walk' ? Math.floor(w.anim * 8) % 2 : 0;
  const shirt = SHIRTS[w.id % SHIRTS.length], skin = SKINS[w.id % SKINS.length], jeans = '#3c4a6b', oy = sit ? 2 : 0;
  pc.globalAlpha = w.state === 'spawn' ? (Math.floor(T * 10) % 2 ? 0.35 : 0.9) : w.state === 'sink' ? Math.max(0, w.fade) : 1;
  R(x - 3, y, 7, 1, 'rgba(0,0,0,.18)');
  if (sit) { R(x - 2, y - 3, 2, 3, jeans); R(x + 1, y - 3, 2, 3, jeans); }
  else { R(x - 2, y - 3, 2, 3 - (step ? 1 : 0), jeans); R(x + 1, y - 3, 2, 3 - (step ? 0 : 1), jeans); }
  R(x - 2, y - 8 + oy, 5, 5, shirt);
  const working = w.state === 'work' && w.machine && w.machine.batch;
  if (working) { const up = Math.floor(T * 6) % 2; R(x - 3, y - 8 + oy, 1, 3, shirt); R(x + 3, y - 7 - up, 2, 1, shirt); R(x + 5, y - 7 - up, 1, 1, skin); }
  else { R(x - 3, y - 8 + oy, 1, 4, shirt); R(x + 3, y - 8 + oy, 1, 4, shirt); R(x - 3, y - 4 + oy, 1, 1, skin); R(x + 3, y - 4 + oy, 1, 1, skin); }
  R(x - 2, y - 11 + oy, 5, 3, skin); R(x + (f > 0 ? 1 : -1), y - 10 + oy, 1, 1, '#202124');
  R(x - 2, y - 13 + oy, 5, 1, '#f6b93b'); R(x - 3, y - 12 + oy, 7, 1, '#f6b93b');
  if (w.state === 'pool' && w.spot) {
    const k = w.spot.kind;
    if (k === 'coffee' || k === 'stand') { R(x + 4, y - 6, 2, 2, '#ffffff'); if (k === 'coffee' && Math.floor(T * 3) % 2) R(x + 4, y - 9, 1, 1, 'rgba(120,120,120,.5)'); }
  }
  pc.globalAlpha = 1;
  hit('worker', w, x - 5, y - 15, 11, 17, 6);
}
function drawTruck(t) {
  const x = Math.round(t.x), y = TRUCK.y;
  R(x - 10, y - 8, 26, 12, '#ffffff'); R(x - 10, y - 8, 26, 1, '#dfe4eb'); R(x - 10, y - 2, 26, 2, '#fbbc04');
  R(x - 18, y - 6, 8, 10, '#4285f4'); R(x - 17, y - 5, 3, 4, '#cfe3f3');
  R(x - 16, y + 4, 4, 2, '#2b3440'); R(x + 8, y + 4, 4, 2, '#2b3440');
  if (t.state === 'unload') R(x + 16, y - 7, 1, 10, '#3c4654');
  hit('source', t.src, x - 19, y - 9, 37, 16, 4);
}
function drawSources(T) {
  const tx = SOURCE_POS.pubsub.x, p = SRC.pubsub;
  for (let y = 20; y < 52; y += 4) { const half = Math.round(2 + (y - 20) / 8); R(tx - half, y, 1, 4, '#8a99ad'); R(tx + half, y, 1, 4, '#8a99ad'); R(tx - half, y + 2, half * 2, 1, '#b4c0cf'); }
  R(tx - 1, 12, 2, 8, '#5c6b7d');
  R(tx - 1, 10, 2, 2, (Math.floor(T * 2) % 2 || p.flash > 0) ? SRC_COLOR.pubsub : '#c7cfda');
  const ph = (T * 1.1) % 1, rr2 = 3 + Math.floor(ph * 8);
  pc.globalAlpha = 1 - ph; R(tx - rr2, 10, 1, 2, SRC_COLOR.pubsub); R(tx + rr2, 10, 1, 2, SRC_COLOR.pubsub); pc.globalAlpha = 1;
  hit('source', p, tx - 10, 8, 20, 52, 4);
  const d = SRC.cloudsql;
  R(20, 98, 14, 6, SRC_COLOR.cloudsql); R(20, 98, 14, 1, '#8ab4f8'); R(20, 101, 14, 1, '#8ab4f8');
  if (d.flash > 0) R(14, 110, 4, 4, '#ffffff');
  hit('source', d, 8, 96, 38, 40, 3);
  S.trucks.forEach(drawTruck);
}
function drawConsumers(T) {
  const [lk, vx, api] = CONS;
  hit('consumer', lk, 444, 8, 78, 76, 3);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) R(460 + i * 10, 108 + j * 10, 4, 4, hash(i, j, Math.floor(T * 3)) > (vx.flash > 0 ? 0.25 : 0.6) ? '#9b6bff' : '#d6dbe4');
  hit('consumer', vx, 450, 98, 56, 36, 3);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) R(458 + i * 16, 175 + j * 4, 2, 2, hash(i, j, Math.floor(T * (api.flash > 0 ? 12 : 4))) > 0.4 ? '#4be08f' : '#1e3a2c');
  hit('consumer', api, 450, 166, 56, 40, 3);
}

/* ---------------- sobreposições nítidas ---------------- */
function roomTitle(id, mx) {
  const o = ROOMS[id], md = MEDAL[id], x = o.x * K + 10, y = o.y * K + 8;
  const sub = id === 'raw' ? `lag ${nf0.format(mx.sysLag)} min · ${big(HALL.raw.rowsOut)} linhas hoje`
    : id === 'stg' ? `dedup + teste: −${pct(HALL.stg.rowsIn ? (HALL.stg.rowsIn - HALL.stg.rowsOut) / HALL.stg.rowsIn * 100 : 0)}`
    : `slots ${nf0.format(mx.slots)}/${nf0.format(CONFIG.slotsReserved)}`;
  fillRR(x, y, 22, 22, 11, md.sign); text(String(HALLS.findIndex(h => h.id === id) + 1), x + 11, y + 12, `700 13px ${FONT}`, md.ink, 'center', 'middle');
  text(md.name, x + 28, y + 17, `700 20px ${FONT}`, INK);
  text(md.sub, x, y + 36, `500 11px ${MONO}`, MUTED);
  text(sub, x, y + 51, `500 11px ${MONO}`, INK);
}
function smallTitle(o, t, color) { text(t, o.x * K + 10, o.y * K + 22, `700 15px ${FONT}`, color); }
function drawLooker() {
  const x = 448 * K, y = 12 * K, w = 70 * K, h = 48 * K, hist = S.thrHist.slice(-24), mx = Math.max(1, ...hist);
  text('Looker · Receita diária', x + 10, y + 18, `500 12px ${SANS}`, INK);
  if (S.pen.length || S.batches.some(b => b.bad)) { g.fillStyle = '#fef7e0'; g.fillRect(x + 4, y + 26, w - 8, 18); text('⚠ Dados incompletos', x + 10, y + 39, `500 10.5px ${SANS}`, '#b06000'); }
  text(big(HALL.mart.rowsOut), x + 10, y + 72, `700 26px ${SANS}`, INK);
  text('linhas no Gold hoje', x + 10, y + 87, `400 10.5px ${SANS}`, MUTED);
  const base = y + h - 10;
  g.beginPath(); hist.forEach((v, i) => { const px = x + 10 + i * ((w - 20) / 23), py = base - v / mx * 40; i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.strokeStyle = '#4285f4'; g.lineWidth = 2; g.stroke();
}
const STEP_TEXT = {
  spike: ['Deploy faz o Pub/Sub mandar', '6× o volume normal'], drift: ['amount chegou como STRING', 'schema v7, sem aviso'],
  scale: ['Dataflow sobe workers', '(cold start)'], quar: ['Contrato do stg_orders barra', 'os lotes antes do Gold'],
  fix: ['SAFE_CAST(amount AS NUMERIC)', 'em produção'], replay: ['Quarentena volta para o Silver.', 'Nada se perde.'],
};
function drawControlScreen(T) {
  const k = ROOMS.ctrl, x = (k.x + 9) * K, y = (k.y + 15) * K, w = (k.w - 18) * K, h = 38 * K;
  const I = S.inc;
  let cur = null, idx = 0;
  if (I) INC_STEPS.forEach(([key], i) => { if (I.m[key] != null && (cur == null || I.m[key] >= I.m[cur])) { cur = key; idx = i; } });
  if (I && cur && !(I.done && S.t - I.m.normal > 14)) {
    const crit = cur === 'drift' || cur === 'quar', ok = cur === 'normal' || cur === 'replay' || cur === 'fix';
    g.fillStyle = crit ? CRIT : ok ? OK : WARN; g.fillRect(x, y, 6, h);
    text(`INCIDENTE · ETAPA ${idx + 1}/${INC_STEPS.length}`, x + 14, y + 20, `500 11px ${MONO}`, '#9aa5b5');
    text(INC_STEPS[idx][1], x + 14, y + 46, `700 22px ${FONT}`, '#ffffff');
    const lines = cur === 'normal' ? [`Resolvido em ${nf0.format(I.m.normal - I.t0)} min,`, 'sem perder nenhum lote'] : STEP_TEXT[cur];
    lines.forEach((l, i) => text(l, x + 14, y + 70 + i * 17, `500 13px ${SANS}`, '#dfe4eb'));
  } else {
    text('COMPOSER · DAG orders_hourly', x + 14, y + 22, `500 11px ${MONO}`, '#9aa5b5');
    const fail = S.batches.some(b => b.bad) || S.pen.length > 0, run = Math.floor(T * 1.5) % 4;
    ['extract', 'dbt run', 'dbt test', 'marts'].forEach((n, i) => {
      const step = (w - 60) / 3, nx = x + 30 + i * step, ny = y + 62;
      if (i < 3) { g.strokeStyle = '#5c6b7d'; g.lineWidth = 2; g.beginPath(); g.moveTo(nx + 10, ny); g.lineTo(nx + step - 10, ny); g.stroke(); }
      dot(nx, ny, i === run ? 9 : 8, n === 'dbt test' && fail ? CRIT : OK);
      text(n, nx, ny + 26, `500 11px ${MONO}`, '#c7cfda', 'center');
    });
  }
  hit('composer', null, k.x, k.y, k.w, k.h, 2);
}
function statusColor(w) {
  if (w.state === 'work' && w.machine && w.machine.batch) return OK;
  if (w.state === 'spawn') return '#ffffff';
  if (w.goal === 'leave' || w.state === 'sink') return '#9aa5b5';
  if (w.state === 'walk') return '#4285f4';
  return WARN;
}
function drawOverlays(T) {
  const mx = metrics();
  ['raw', 'stg', 'mart'].forEach(id => roomTitle(id, mx));
  const idle = S.workers.filter(w => w.state === 'pool').length;
  smallTitle(ROOMS.pool, 'COPA · WORKERS OCIOSOS', '#6b4f8a');
  smallTitle(ROOMS.quar, 'QUARENTENA', '#b42b30');
  text('raw.orders_quarantine', ROOMS.quar.x * K + 10, ROOMS.quar.y * K + 37, `500 10.5px ${MONO}`, '#b42b30');
  smallTitle(ROOMS.ctrl, 'SALA DE CONTROLE', '#2f5d94');
  text('AUTOSCALING', 404 * K, 120 * K - 4, `600 11px ${FONT}`, MUTED, 'center');
  drawLooker(); drawControlScreen(T);
  for (const w of S.workers) {
    const sx = w.x * K, sy = w.y * K, col = statusColor(w), top = sy - 15 * K - 8;
    g.save(); g.translate(sx, top); g.rotate(Math.PI / 4); g.fillStyle = col; g.fillRect(-4.5, -4.5, 9, 9); g.strokeStyle = 'rgba(32,33,36,.5)'; g.lineWidth = 1; g.strokeRect(-4.5, -4.5, 9, 9); g.restore();
    const working = w.state === 'work' && w.machine && w.machine.batch;
    if (w.state === 'pool' || working || (S.sel && S.sel.ref === w)) pill(w.name, sx, sy + 12, '#ffffff', INK, `500 10px ${MONO}`, col);
    if (w.state === 'pool' && w.spot && w.spot.kind === 'sofa') text('z', sx + 14, sy - 34 - ((T * 8 + w.id * 5) % 10), `700 13px ${FONT}`, '#6b4f8a');
  }
  const tag = (t, x, y, metric, src, hot) => {
    pill(t, x, y, '#ffffff', INK, `600 13px ${FONT}`);
    if (metric) pill(metric, x, y + 23, hot ? WARN : '#f1f3f4', hot ? '#3b2a00' : INK, `500 11px ${MONO}`);
    if (src && src.status !== 'ok' && (src.status !== 'drift' || Math.floor(T * 3) % 3)) {
      pill(src.status === 'drift' ? `SCHEMA ${src.schema} · amount STRING` : `${src.rateMul}× VOLUME`, x, y - 24, src.status === 'drift' ? CRIT : WARN, src.status === 'drift' ? '#ffffff' : '#3b2a00', `500 11px ${MONO}`);
    }
  };
  tag('orders-api → Pub/Sub', 124, 50, `${nf0.format(mx.rps)} req/s · backlog ${big(mx.backlog)}`, SRC.pubsub, mx.backlog > 1e6 || mx.oldest > 10);
  pill(`dead letter ${nf0.format(S.dlq)}`, 70, 192, '#ffffff', MUTED, `500 11px ${MONO}`);
  tag('Cloud SQL · Datastream', 124, 262, `${nf0.format(mx.cdcRps)} eventos/s · atraso ${nf0.format(mx.dsLag)} min`, SRC.cloudsql);
  tag('GCS · parceiros', 112, 548, `${nf0.format(S.filesToday)} arquivos hoje`, SRC.gcs);
  pill('Vertex AI', 478 * K, 94 * K, '#ffffff', INK, `600 13px ${FONT}`);
  pill('API de consulta', 478 * K, 161 * K, '#ffffff', INK, `600 13px ${FONT}`);
  pill(`scan ${nf1.format(S.scanGB)} GB · ${usd(S.scanUSD)}`, 486 * K, 87 * K, '#ffffff', INK, `500 11px ${MONO}`);
  HALLS.forEach(h => {
    const n = h.queue.length, rows = h.queue.reduce((a, b) => a + b.rows, 0), top = stackPos(h.id, Math.max(0, Math.min(n, STACK_MAX) - 1)).y - 6;
    const bg = n >= 12 ? CRIT : n >= 5 ? WARN : '#ffffff', fg = n >= 12 ? '#ffffff' : INK;
    const qp = pill(n ? `fila ${n} · ${big(rows)} linhas` : 'fila vazia', 0, -100, bg, fg, `500 11px ${MONO}`);
    pill(n ? `fila ${n} · ${big(rows)} linhas` : 'fila vazia', HALL_X[h.id] * K + 6 + qp.w / 2, (LANE + 6) * K, bg, fg, `500 11px ${MONO}`);
  });
  pill(idle ? `${idle} ociosos · ${usd(idle * CONFIG.workerHour)}/h` : 'nenhum ocioso', 158 * K, 156 * K, idle >= 3 ? CRIT : '#ffffff', idle >= 3 ? '#ffffff' : INK, `500 11px ${MONO}`);
  if (S.pen.length) pill(`${S.pen.length} lotes · ${big(S.pen.reduce((a, b) => a + b.rows, 0))} linhas`, 262 * K, 170 * K, CRIT, '#ffffff', `500 11px ${MONO}`);
  pill('dbt tests', (GATE.x + 7) * K, (LANE - 18) * K, '#ffffff', INK, `600 13px ${FONT}`);
  const lx = 428 * K, ly = 210 * K;
  fillRR(lx, ly, (W - 432) * K, 28 * K, 8, 'rgba(255,255,255,.95)');
  [['Bronze', CRATE.raw.fill], ['Silver', CRATE.stg.fill], ['Gold', CRATE.mart.fill], ['Reprovado', CRATE.red.fill]].forEach(([t, c], i) => {
    const x = lx + 14 + (i % 2) * 140, y = ly + 16 + Math.floor(i / 2) * 28;
    g.fillStyle = c; g.fillRect(x, y, 14, 12); g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 13, 11);
    text(t, x + 20, y + 11, `500 14px ${FONT}`, INK);
  });
}

/* ---------------- quadro ---------------- */
export function render(T) {
  HB.length = 0;
  pc.drawImage(bcv, 0, 0);
  const ph = Math.floor(S.t * 30) % 4;
  for (const { a, b } of SEGS) {
    if (a.y === b.y) { const s = Math.sign(b.x - a.x), lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x); for (let x = lo; x <= hi; x++) if ((((x - s * ph) % 4) + 4) % 4 === 0) R(x, a.y - 1, 1, 3, '#b7c0cd'); }
    else { const s = Math.sign(b.y - a.y), lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y); for (let y = lo; y <= hi; y++) if ((((y - s * ph) % 4) + 4) % 4 === 0) R(a.x - 1, y, 3, 1, '#b7c0cd'); }
  }
  HALLS.forEach(h => drawShelf(h, T));
  drawSources(T);
  drawConsumers(T);
  HALLS.forEach(h => {
    h.machines.forEach(m => drawMachine(m, T));
    R(HALL_X[h.id] + 3, 106, 22, 3, '#b08458');
    h.queue.forEach((b, i) => { if (i >= STACK_MAX) return; const p = stackPos(h.id, i); b.x = p.x; b.y = p.y; drawCrate(b); });
    hit('hall', h, ROOMS[h.id].x, ROOMS[h.id].y, ROOMS[h.id].w, ROOMS[h.id].h, 1);
  });
  S.pen.forEach((b, i) => { if (b.state !== 'quar') return; const p = penPos(i); b.x = p.x; b.y = p.y; drawCrate(b); });
  hit('quar', null, ROOMS.quar.x, ROOMS.quar.y, ROOMS.quar.w, ROOMS.quar.h, 2);
  hit('pool', null, ROOMS.pool.x, ROOMS.pool.y, ROOMS.pool.w, ROOMS.pool.h, 2);
  for (const b of S.batches) if (b.state === 'belt') drawCrate(b);
  drawGate();
  [...S.workers].sort((a, c) => a.y - c.y).forEach(w => drawWorker(w, T));
  for (const b of S.batches) if (b.state === 'kick') drawCrate(b);
  for (const f of S.floaters) { pc.globalAlpha = Math.max(0, f.life / f.max); R(f.x, f.y, 1, 1, f.c); }
  pc.globalAlpha = 1;

  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(pcv, 0, 0, LW, LH);
  drawOverlays(T);
  const find = s => { let best = null; HB.forEach(h => { if (h.type === s.type && h.ref === s.ref && (!best || h.pri >= best.pri)) best = h; }); return best; };
  if (S.hover && !(S.sel && S.hover.type === S.sel.type && S.hover.ref === S.sel.ref)) {
    const h = find(S.hover); if (h) { g.setLineDash([6, 4]); rr(h.r.x, h.r.y, h.r.w, h.r.h, 6); g.strokeStyle = BLUE; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); }
  }
  if (S.sel) { const h = find(S.sel); if (h) { rr(h.r.x, h.r.y, h.r.w, h.r.h, 6); g.strokeStyle = BLUE; g.lineWidth = 3; g.stroke(); } }
}
