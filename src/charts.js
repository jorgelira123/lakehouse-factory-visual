// Gráficos SVG pequenos, no estilo de tiles do Looker. Sem biblioteca.
const GRID = '#e8eaed', AXIS = '#5f6368';
const VB_W = 320, VB_H = 130, PL = 36, PR = 8, PT = 10, PB = 20;
const sx = (i, n) => PL + (n <= 1 ? 0 : i / (n - 1)) * (VB_W - PL - PR);
const sy = (v, max) => PT + (1 - v / max) * (VB_H - PT - PB);
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; };

function chartFrame(max, fmt) {
  let s = '';
  [0, 0.5, 1].forEach(f => {
    const v = max * f, y = sy(v, max);
    s += `<line x1="${PL}" x2="${VB_W - PR}" y1="${y}" y2="${y}" stroke="${GRID}"/>`;
    s += `<text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${AXIS}">${fmt(v)}</text>`;
  });
  return s;
}
const wrap = inner => `<svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" role="img">${inner}</svg>`;

export function lineChart(el, values, { color = '#4285f4', fmt = v => Math.round(v), max: forcedMax, ref, step = false } = {}) {
  const n = values.length, max = forcedMax || niceMax(Math.max(1, ...values));
  let pts = values.map((v, i) => [sx(i, n), sy(v, max)]);
  if (step) { const s = []; pts.forEach((p, i) => { if (i) s.push([p[0], pts[i - 1][1]]); s.push(p); }); pts = s; }
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const area = pts.length ? `${d}L${pts[pts.length - 1][0]},${VB_H - PB}L${pts[0][0]},${VB_H - PB}Z` : '';
  let s = chartFrame(max, fmt);
  if (ref != null) { const y = sy(ref, max); s += `<line x1="${PL}" x2="${VB_W - PR}" y1="${y}" y2="${y}" stroke="#d93025" stroke-dasharray="4 3"/>`; }
  s += `<path d="${area}" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  if (pts.length) { const p = pts[pts.length - 1]; s += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${color}"/>`; }
  el.innerHTML = wrap(s);
}

export function stackedBars(el, rows, { colors = ['#34a853', '#d93025'] } = {}) {
  const n = rows.length, max = niceMax(Math.max(1, ...rows.map(r => r[0] + r[1])));
  const bw = (VB_W - PL - PR) / Math.max(n, 1) * 0.7;
  let s = chartFrame(max, v => Math.round(v));
  rows.forEach((r, i) => {
    const x = PL + (i + 0.15) * (VB_W - PL - PR) / Math.max(n, 1);
    const y0 = sy(r[0], max), y1 = sy(r[0] + r[1], max);
    s += `<rect x="${x}" y="${y0}" width="${bw}" height="${VB_H - PB - y0}" fill="${colors[0]}"/>`;
    if (r[1]) s += `<rect x="${x}" y="${y1}" width="${bw}" height="${y0 - y1}" fill="${colors[1]}"/>`;
  });
  el.innerHTML = wrap(s);
}

export function hBars(el, rows, { max = 90, ref = 60, unit = 'min' } = {}) {
  const left = 74, right = VB_W - 40, bh = 20, gap = 14;
  let s = '';
  const x = v => left + Math.min(1, v / max) * (right - left);
  s += `<line x1="${x(ref)}" x2="${x(ref)}" y1="4" y2="${rows.length * (bh + gap)}" stroke="#d93025" stroke-dasharray="4 3"/>`;
  s += `<text x="${x(ref)}" y="${rows.length * (bh + gap) + 12}" text-anchor="middle" font-size="10" fill="#d93025">SLA ${ref} ${unit}</text>`;
  rows.forEach((r, i) => {
    const y = 6 + i * (bh + gap);
    s += `<text x="${left - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="#202124">${r.label}</text>`;
    s += `<rect x="${left}" y="${y}" width="${right - left}" height="${bh}" fill="#f1f3f4"/>`;
    s += `<rect x="${left}" y="${y}" width="${Math.max(2, x(r.value) - left)}" height="${bh}" fill="${r.color}"/>`;
    s += `<text x="${Math.min(VB_W - 4, x(r.value) + 6)}" y="${y + 14}" font-size="11" fill="#202124" text-anchor="${x(r.value) + 40 > VB_W ? 'end' : 'start'}">${r.text}</text>`;
  });
  el.innerHTML = wrap(s);
}
