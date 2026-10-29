// Ponto de entrada: aquece a simulação, liga a cena e os painéis, roda o loop.
import { S, step, warmup } from './sim.js';
import { initRender, render } from './render.js';
import { initUI, uiTick } from './ui.js';

const canvas = document.getElementById('cv');
initRender(canvas);
initUI(canvas);
warmup();
if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  S.paused = true; document.getElementById('btnPause').textContent = 'Retomar';
}
uiTick();
render(performance.now() / 1000);

let last = performance.now(), uiAcc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!S.paused) step(dt * S.speed);
  render(now / 1000);
  uiAcc += dt; if (uiAcc > 0.25) { uiAcc = 0; uiTick(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
