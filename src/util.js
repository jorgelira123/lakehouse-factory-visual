// Utilitários sem dependência de domínio nem de tela.
export const rnd = (a, b) => a + Math.random() * (b - a);
export const rint = (a, b) => Math.floor(rnd(a, b + 1));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const hash = (a, b, c) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return s - Math.floor(s); };
export const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const usd = v => 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 1.234 → "1.234"; 45.300 → "45,3 mil"; 2.100.000 → "2,1 mi"; 3.2e9 → "3,2 bi"
export const big = n => {
  const a = Math.abs(n);
  if (a >= 1e9) return nf1.format(n / 1e9) + ' bi';
  if (a >= 1e6) return nf1.format(n / 1e6) + ' mi';
  if (a >= 1e4) return nf1.format(n / 1e3) + ' mil';
  return nf0.format(n);
};
export const pct = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
