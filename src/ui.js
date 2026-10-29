// Tiles do dashboard em volta da cena: KPIs, gráficos, inspetor, eventos, rastreamento e incidente.
import { nf0, nf1, usd, big, pct } from './util.js';
import { PROJECT, TESTS, CONFIG } from './model.js';
import { S, SRC, SRCS, HALL, HALLS, INC_STEPS, clockAt, activeWorkers, startIncident, p90, metrics } from './sim.js';
import { LW, LH, getHitboxes } from './render.js';
import { lineChart, stackedBars, hBars } from './charts.js';

const $ = id => document.getElementById(id);

/* ---------------- interação com a cena ---------------- */
function hitTest(x, y) {
  let best = null, order = 0;
  getHitboxes().forEach((h, i) => {
    const r = h.r;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      if (!best || h.pri > best.pri || (h.pri === best.pri && i > order)) { best = h; order = i; }
    }
  });
  if (!best) return null;
  if (best.type === 'machine') return best.ref.worker ? { type: 'worker', ref: best.ref.worker } : { type: 'hall', ref: best.ref.hall };
  return { type: best.type, ref: best.ref };
}
const same = (a, b) => !!a && !!b && a.type === b.type && a.ref === b.ref;

export function initUI(canvas) {
  const toLogical = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH }; };
  canvas.addEventListener('mousemove', e => { const p = toLogical(e); S.hover = hitTest(p.x, p.y); canvas.style.cursor = S.hover ? 'pointer' : 'default'; });
  canvas.addEventListener('mouseleave', () => { S.hover = null; });
  canvas.addEventListener('click', e => {
    const p = toLogical(e), hit = hitTest(p.x, p.y);
    S.sel = hit ? (same(hit, S.sel) ? null : hit) : null;
    if (hit && hit.type === 'batch') { S.track = hit.ref; S.trackPinned = true; S.trackDoneAt = null; }
    renderInspector(); renderTrack();
  });
  $('btnInc').addEventListener('click', () => { startIncident(); uiTick(); });
  $('btnPause').addEventListener('click', () => { S.paused = !S.paused; $('btnPause').textContent = S.paused ? 'Retomar' : 'Pausar'; });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    S.speed = +b.dataset.speed;
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('insp-close').addEventListener('click', () => { S.sel = null; renderInspector(); });
  $('f-region').textContent = PROJECT.region; $('f-project').textContent = PROJECT.name;
}

/* ---------------- textos ---------------- */
const statusPill = s => s.status === 'drift' ? '<span class="pill crit">schema drift</span>'
  : s.status === 'spike' ? `<span class="pill warn">${s.rateMul}× volume</span>` : '<span class="pill ok">saudável</span>';
const kv = rows => '<dl class="kv">' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
const mins = v => v == null ? '—' : nf0.format(Math.max(0, v)) + ' min';
const SWATCH = { pubsub: '#34a853', cloudsql: '#4285f4', gcs: '#fbbc04', raw: '#c4823f', stg: '#a9b3c1', mart: '#e9b92f' };
const sw = c => `<span class="sw" style="background:${c}"></span>`;
function activityText(w) {
  if (w.gone || w.state === 'sink') return 'Desligado pelo autoscaling';
  if (w.state === 'spawn') return 'Subindo (cold start)';
  if (w.state === 'walk') return w.goal === 'machine' ? `Indo para ${w.machine ? w.machine.hall.name : 'uma estação'}` : w.goal === 'leave' ? 'Sendo desligado pelo autoscaling' : 'Voltando para o pool';
  if (w.state === 'work') return w.machine && w.machine.batch ? `Processando ${w.machine.batch.id}` : 'Esperando a fila';
  if (w.state === 'hallIdle') return 'Parado na estação, sem fila';
  return 'Parado no pool, ligado e cobrando';
}
const batchStatus = b => ({ belt: 'Na esteira', queued: 'Na fila', proc: 'Processando', kick: b.red ? 'Caindo na quarentena' : 'Em replay', quar: 'Em quarentena', served: 'Entregue' })[b.state] || b.state;
const freshness = s => s.lastServedCreated == null ? null : S.t - s.lastServedCreated;

export function renderInspector() {
  const el = $('inspector'), body = $('insp-body'), s = S.sel;
  el.hidden = !s; if (!s) return;
  let eyebrow = '', html = '';
  if (s.type === 'source') {
    const x = s.ref, inPen = S.pen.filter(b => b.src === x).length;
    eyebrow = 'Fonte';
    const mx = metrics();
    const live = x.id === 'pubsub'
      ? [['Requisições', nf0.format(mx.rps) + ' req/s'], ['Erros 5xx', pct(mx.err5xx, 2)], ['Backlog da assinatura', big(mx.backlog) + ' msgs'], ['Mensagem mais antiga', mins(mx.oldest)], ['Dead letter hoje', nf0.format(S.dlq) + ' msgs']]
      : x.id === 'cloudsql'
        ? [['Eventos de CDC', nf0.format(mx.cdcRps) + '/s'], ['Atraso de replicação', mins(mx.dsLag)]]
        : [['Arquivos hoje', nf0.format(S.filesToday)], ['Tamanho médio', '1,2 GB']];
    html = `<h2>${sw(SWATCH[x.id])}${x.name}</h2><p class="desc">${x.kind}. ${statusPill(x)}</p>` + kv([
      ...live, ['Chega via', x.via], ['Schema', x.schema], ['Lotes entregues', nf0.format(x.served)], ['Em quarentena', String(inPen)], ['Freshness', mins(freshness(x))],
    ]);
  } else if (s.type === 'hall') {
    const h = s.ref, avg = h.processed ? h.procTime / h.processed : null;
    eyebrow = `Camada · ${h.tool}`;
    html = `<h2>${sw(SWATCH[h.id])}${h.name}</h2><p class="desc">${h.desc}</p>` + kv([
      ['Tabela', `<code>${h.table}</code>`], ['Fila', `${h.queue.length} lotes · ${big(h.queue.reduce((a, b) => a + b.rows, 0))} linhas`],
      ['Linhas que entraram hoje', big(h.rowsIn)], ['Linhas que saíram hoje', big(h.rowsOut)],
      ...(h.id === 'stg' ? [['Duplicadas removidas', big(S.dups)], ['Pedidos de teste filtrados', big(S.testFiltered)]] : []),
      ...(h.id !== 'raw' ? [['Slots em uso (reserva)', `${nf0.format(metrics().slots)} de ${nf0.format(CONFIG.slotsReserved)}`]] : [['Lag do Dataflow', mins(metrics().sysLag)]]),
      ['Tempo médio por lote', avg == null ? '—' : nf1.format(avg) + ' min'],
    ]) + '<p class="hint">Cada caixa na estante é uma partição gravada na tabela.</p>';
  } else if (s.type === 'worker') {
    const w = s.ref, up = S.t - w.born;
    eyebrow = 'Worker Dataflow';
    html = `<h2>${w.name}</h2><p class="desc">${activityText(w)}</p>` + kv([
      ['Estação', w.machine ? `${w.machine.hall.name} · ${w.machine.i + 1}` : '—'], ['Lotes processados', nf0.format(w.done)],
      ['Ligado há', mins(up)], ['Custo até agora', usd(up / 60 * CONFIG.workerHour)], ['Preço', usd(CONFIG.workerHour) + '/h'],
    ]);
  } else if (s.type === 'batch') {
    const b = s.ref, end = b.times.served ?? S.t;
    eyebrow = 'Lote';
    html = `<h2>${b.id}</h2><p class="desc">${batchStatus(b)}${b.replayed ? ' · reprocessado por replay' : ''}</p>` + kv([
      ['Origem', b.src.name], ['Linhas', nf0.format(b.rows)], ['Tamanho', nf1.format(b.rows * CONFIG.bytesPerRow / 1e9) + ' GB'],
      ...(b.rowsOut != null ? [['Duplicadas removidas', nf0.format(b.dups)], ['Pedidos de teste', nf0.format(b.filtered)], ['Seguiram para o mart', nf0.format(b.rowsOut)]] : []),
      ['Camada', b.layer], ['Idade', mins(end - b.times.created)],
      ['Contrato do stg', b.bad ? '<span class="pill crit">quebra</span>' : '<span class="pill ok">ok</span>'],
    ]) + '<p class="hint">Rastreado no tile "Rastreamento de lote".</p>';
  } else if (s.type === 'gate') {
    const failing = S.batches.some(b => b.bad) || S.pen.length > 0;
    eyebrow = 'Portão de qualidade';
    html = `<h2>Testes dbt</h2><p class="desc">Todo lote que sai do staging passa pelos testes. Quem falha cai pelo alçapão na quarentena e não chega ao mart.</p>` +
      kv(TESTS.map((x, i) => [`<code>${x.name}</code>`, i === 0 && failing ? '<span class="pill crit">falhando</span>' : '<span class="pill ok">passando</span>'])) +
      kv([['Aprovados', nf0.format(S.dqPass)], ['Reprovados', nf0.format(S.dqFail)]]);
  } else if (s.type === 'quar') {
    const by = {}; S.pen.forEach(b => { by[b.src.name] = (by[b.src.name] || 0) + 1; });
    const list = Object.entries(by);
    eyebrow = 'Quarentena';
    html = `<h2>${S.pen.length} lotes · ${big(S.pen.reduce((a, b) => a + b.rows, 0))} linhas</h2><p class="desc">Tabela <code>raw.orders_quarantine</code>. Os lotes esperam aqui por um hotfix e voltam ao staging por replay, sem perda de dados.</p>` +
      (list.length ? kv(list.map(([k, v]) => [k, v + ' lotes'])) : '<p class="hint">Nenhum lote isolado agora.</p>') +
      kv([['Total histórico', nf0.format(SRCS.reduce((a, x) => a + x.quarTotal, 0))]]);
  } else if (s.type === 'pool') {
    const idle = S.workers.filter(w => w.state === 'pool');
    eyebrow = 'Pool de workers';
    html = `<h2>${idle.length} workers ociosos</h2><p class="desc">Worker parado continua cobrando. O autoscaling só desliga depois de uns ${CONFIG.scaleDownAfter} min sem fila, para não pagar outro cold start.</p>` +
      kv([['Queimando agora', usd(idle.length * CONFIG.workerHour) + '/h'], ...idle.map(w => [w.name, 'ocioso'])]);
  } else if (s.type === 'consumer') {
    const c = s.ref;
    eyebrow = 'Consumidor';
    html = `<h2>${c.name}</h2><p class="desc">${c.desc}</p>` + kv([
      ['Lotes recebidos', nf0.format(c.received)], ['Último lote', c.last == null ? '—' : 'há ' + mins(S.t - c.last)],
      ['Freshness', mins(c.lastCreated == null ? null : S.t - c.lastCreated)],
      ...(c.id === 'looker' ? [['Escaneado no BigQuery', nf1.format(S.scanGB) + ' GB'], ['Custo de scan', usd(S.scanUSD)]] : []),
    ]) + (c.id === 'looker' ? '<p class="hint">O mart é particionado por dia e clusterizado por loja, então cada atualização lê poucos GB.</p>' : '');
  } else if (s.type === 'composer') {
    const failing = S.batches.some(b => b.bad) || S.pen.length > 0;
    eyebrow = 'Orquestração';
    html = `<h2>Cloud Composer</h2><p class="desc">DAG <code>orders_hourly</code>: extrai, roda o dbt do staging, testa e só então constrói os marts.</p>` + kv([
      ['Task <code>dbt_test</code>', failing ? '<span class="pill crit">falhando</span>' : '<span class="pill ok">sucesso</span>'],
      ['Política', 'falha isola o lote, não para a DAG'],
    ]);
  }
  $('insp-eyebrow').textContent = eyebrow;
  body.innerHTML = html;
}

function stepsHTML(list) {
  return `<div class="steps-wrap"><div class="steps" style="--n:${list.length}">` + list.map(x =>
    `<div class="step ${x.cls}"><div class="node"></div><div class="s-name">${x.name}</div><div class="s-time">${x.time}</div></div>`).join('') + '</div></div>';
}
export function renderTrack() {
  const b = S.track, el = $('track-body'), meta = $('track-meta');
  if (!b) { el.innerHTML = '<p class="note">Aguardando o primeiro lote.</p>'; return; }
  const t = b.times, stages = [['created', 'Origem'], ['raw', 'Bronze'], ['stg', 'Silver'], ['mart', 'Gold'], ['served', 'Entregue']];
  const failed = b.state === 'quar' || b.red;
  let activeSet = false;
  const list = stages.map(([k, name]) => {
    if (k === 'stg' && failed) return { name: 'Quarentena', cls: 'fail', time: t.stg != null ? clockAt(t.stg) : 'agora' };
    if (t[k] != null) return { name: k === 'served' && b.consumer ? b.consumer.name : name, cls: 'done', time: clockAt(t[k]) };
    if (!activeSet && !failed) { activeSet = true; return { name, cls: 'active', time: 'agora' }; }
    return { name, cls: '', time: '—' };
  });
  meta.textContent = `#${b.id} · ${b.src.short} · ${big(b.rows)} linhas · ${nf0.format((t.served ?? S.t) - t.created)} min`;
  el.innerHTML = stepsHTML(list);
}
export function renderIncident() {
  const I = S.inc, el = $('incident-body');
  let list, note;
  if (!I) {
    list = INC_STEPS.map(([, name]) => ({ name, cls: '', time: '—' }));
    note = 'Clique em <b>Simular incidente</b>: um deploy faz o Pub/Sub mandar 6× o volume e muda o schema sem aviso. Veja a quarentena encher, o Dataflow escalar e o replay recuperar tudo.';
  } else {
    let activeSet = false;
    list = INC_STEPS.map(([k, name]) => {
      if (I.m[k] != null) return { name, cls: (k === 'drift' || k === 'quar') && !I.done ? 'fail' : 'done', time: clockAt(I.m[k]) };
      if (!activeSet && !I.done) { activeSet = true; return { name, cls: 'active', time: 'aguardando' }; }
      return { name, cls: '', time: '—' };
    });
    note = I.done
      ? `Resolvido em ${nf0.format(I.m.normal - I.t0)} min, sem perda de dados: ${nf0.format(SRC.pubsub.quarTotal)} lotes passaram pela quarentena e voltaram por replay.`
      : 'Incidente em andamento. Quarentena, autoscaling e replay acontecem sozinhos na cena.';
  }
  $('incident-meta').innerHTML = I ? (I.done ? '<span class="pill ok">resolvido</span>' : '<span class="pill crit">em andamento</span>') : '<span class="pill info">pronto para simular</span>';
  el.innerHTML = stepsHTML(list) + `<p class="note">${note}</p>`;
  const btn = $('btnInc'), running = I && !I.done;
  btn.disabled = !!running; btn.textContent = running ? 'Incidente em andamento' : (I ? 'Simular de novo' : 'Simular incidente');
}
function renderEvents() {
  if (!S.eventsDirty) return; S.eventsDirty = false;
  $('events').innerHTML = S.events.slice(0, 14).map(e => `<li><time>${clockAt(e.t)}</time><i class="d ${e.level}"></i><span>${e.msg}</span></li>`).join('');
}
function setState(id, st) { const el = $(id); if (el.dataset.state !== st) el.dataset.state = st; }
function renderKPIs() {
  const mx = metrics();
  $('v-api').textContent = nf0.format(mx.rps);
  $('s-api').textContent = `5xx ${pct(mx.err5xx, 2)} · dead letter ${nf0.format(S.dlq)} msgs hoje`;
  setState('k-api', mx.err5xx > 0.2 ? 'warn' : 'ok');
  $('v-backlog').textContent = big(mx.backlog);
  $('s-backlog').textContent = `mais antiga há ${nf0.format(mx.oldest)} min`;
  setState('k-backlog', mx.backlog > 2e6 || mx.oldest > 20 ? 'crit' : mx.backlog > 1e6 || mx.oldest > 10 ? 'warn' : 'ok');
  const ing = S.ingestLog.reduce((a, x) => a + x.rows, 0) / 15;
  $('v-rows').textContent = big(S.rowsToday);
  $('s-rows').textContent = `≈ ${nf1.format(ing / 60 / 1000)} mil linhas/s agora`;
  const tn = S.tests.length, tok = S.tests.filter(Boolean).length, pass = tn ? tok / tn * 100 : null;
  $('v-dq').textContent = pass == null ? '—' : nf0.format(pass);
  const qRows = S.pen.reduce((a, b) => a + b.rows, 0);
  $('s-dq').textContent = S.pen.length ? `${big(qRows)} linhas em quarentena` : 'nenhuma linha em quarentena';
  setState('k-dq', pass == null ? 'idle' : pass >= 99 ? 'ok' : pass >= 90 ? 'warn' : 'crit');
  const n = S.outcomes.length, okN = S.outcomes.filter(Boolean).length, sla = n ? okN / n * 100 : null, lp = p90(S.lat);
  $('v-sla').textContent = sla == null ? '—' : nf0.format(sla);
  $('s-sla').textContent = `${okN} de ${n} lotes · p90 ${lp == null ? '—' : nf0.format(lp) + ' min'}`;
  setState('k-sla', sla == null ? 'idle' : sla >= 95 ? 'ok' : sla >= 85 ? 'warn' : 'crit');
  const ws = activeWorkers(), idle = S.workers.filter(w => w.state === 'pool').length;
  $('v-cost').textContent = usd(ws.length * CONFIG.workerHour);
  $('s-cost').textContent = `${ws.length} workers (${ws.length * 4} vCPU) · ${idle} ociosos · slots ${nf0.format(mx.slots)}/${nf0.format(CONFIG.slotsReserved)}`;
  setState('k-cost', idle >= 3 ? 'warn' : 'idle');
  setState('k-rows', 'ok');
  $('clock').textContent = clockAt(S.t);
}
function renderCharts() {
  const h = S.hist.slice(-40);
  lineChart($('c-api'), h.map(x => x.rps), { color: '#4285f4', fmt: v => v >= 1000 ? nf0.format(v / 1000) + ' mil' : nf0.format(v) });
  lineChart($('c-backlog'), h.map(x => x.backlog / 1000), { color: '#f9ab00', fmt: v => nf0.format(v), ref: 2000 });
  stackedBars($('c-tests'), h.slice(-24).map(x => [x.pass, x.fail]));
  hBars($('c-fresh'), SRCS.map(s => {
    const f = freshness(s) ?? 0;
    return { label: s.short, value: f, text: nf0.format(f) + ' min', color: f >= CONFIG.slaMin ? '#d93025' : f >= 30 ? '#f9ab00' : '#34a853' };
  }), { max: 90, ref: CONFIG.slaMin });
  lineChart($('c-workers'), h.map(x => x.workers), { color: '#f6b93b', max: CONFIG.maxWorkers, fmt: v => Math.round(v), ref: CONFIG.maxWorkers, step: true });
  $('t-layers').innerHTML = HALLS.map(l => `<tr><td>${sw(SWATCH[l.id])}${l.name}</td><td><code>${l.table}</code></td><td>${l.queue.length}</td><td>${big(l.rowsIn)}</td><td>${big(l.rowsOut)}</td><td>${l.id === 'stg' ? big(l.rowsIn - l.rowsOut) : '—'}</td></tr>`).join('');
  const st = HALL.stg, removed = st.rowsIn ? (st.rowsIn - st.rowsOut) / st.rowsIn * 100 : 0;
  $('sep').innerHTML = `<span>Duplicadas removidas <b>${big(S.dups)}</b></span><span>Pedidos de teste filtrados <b>${big(S.testFiltered)}</b></span><span>Removido no staging <b>${pct(removed)}</b></span><span>Dead letter (JSON inválido) <b>${nf0.format(S.dlq)} msgs</b></span><span>Arquivos de parceiros hoje <b>${nf0.format(S.filesToday)}</b></span>`;
}
let chartAcc = 0;
export function uiTick() {
  renderKPIs(); renderInspector(); renderTrack(); renderIncident(); renderEvents();
  if (++chartAcc % 2 === 1) renderCharts();
}
