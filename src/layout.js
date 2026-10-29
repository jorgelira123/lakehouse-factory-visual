// Planta do galpão vista de cima, em pixels lógicos (528 × 240, desenhados em escala 3).
// Para trocar o visual, troque este arquivo e o render.js. O modelo de domínio não muda.

export const W = 528, H = 240, SCALE = 3;
export const LANE = 108;               // esteira que atravessa as salas das camadas
export const CORR_Y = 132;             // corredor entre as salas de cima e as de baixo
export const SPEED = { belt: 30, walk: 46, truck: 52 };
export const KICK = { quar: 6, replay: 46, replayDy: -6 };
export const FX = 0.33;                // escala das partículas

// salas (interior). Linha de cima: camadas. Linha de baixo: copa, quarentena, sala de controle.
export const BUILDING = { x: 84, y: 10, w: 336, h: 226 };
export const HALL_X = { raw: 88, stg: 192, mart: 306 };
export const HALL_W = { raw: 98, stg: 108, mart: 108 };
export const ROOMS = {
  raw:  { x: 88,  y: 16,  w: 98,  h: 102 },
  stg:  { x: 192, y: 16,  w: 108, h: 102 },
  mart: { x: 306, y: 16,  w: 108, h: 102 },
  corr: { x: 88,  y: 122, w: 326, h: 20 },
  pool: { x: 88,  y: 146, w: 112, h: 84 },
  quar: { x: 206, y: 146, w: 94,  h: 84 },
  ctrl: { x: 306, y: 146, w: 108, h: 84 },
};

export const SOURCE_POS = {
  pubsub:   { sprite: 'tower', x: 22, y: 44,  out: { x: 36, y: 44 } },
  cloudsql: { sprite: 'db',    x: 26, y: 120, out: { x: 46, y: 126 } },
  gcs:      { sprite: 'truck', x: 26, y: 200, out: { x: 50, y: 196 } },
};
export const TRUCK = { start: -40, park: 26, leave: -60, y: 204 };
export const COLLECTOR_X = 64;

export const CONSUMER_POS = { looker: { cy: 74 }, vertex: { cy: 116 }, api: { cy: 186 } };
export const CONSUMER_X = 452;

export const queuePoint = id => ({ x: HALL_X[id] + 12, y: LANE });
export const STACK_MAX = 15;
export const stackPos = (id, i) => {
  const k = Math.min(i, STACK_MAX - 1), col = k % 3, row = Math.floor(k / 3);
  return { x: HALL_X[id] + 7 + col * 7, y: 104 - row * 6 };
};

const MACHINE_Y = [38, 58, 78];
export function machineGeom(id, i) {
  const hx = HALL_X[id], my = MACHINE_Y[i];
  return {
    x: hx + 44, y: my, w: 20, h: 14,
    spot: { x: hx + 37, y: my + 12 },
    outStart: [{ x: hx + 64, y: my + 7 }, { x: hx + 80, y: my + 7 }, { x: hx + 80, y: LANE }],
  };
}

export const GATE = { x: 296, y: LANE };
export const GATE_PASS = [{ ...GATE }, queuePoint('mart')];
export const consumerPath = (m, cy) => [...m.outStart, { x: 438, y: LANE }, { x: 438, y: cy }, { x: CONSUMER_X, y: cy }];

export function sourcePath(id) {
  const p = SOURCE_POS[id];
  return [{ ...p.out }, { x: COLLECTOR_X, y: p.out.y }, { x: COLLECTOR_X, y: LANE }, queuePoint('raw')];
}

// copa (pool ocioso): cada lugar tem uma atividade
export const SPOTS = [
  { kind: 'coffee', x: 102, y: 168 }, { kind: 'stand', x: 152, y: 166 }, { kind: 'arcade', x: 188, y: 168 },
  { kind: 'chat', x: 160, y: 196 }, { kind: 'chat', x: 184, y: 196 }, { kind: 'stand', x: 100, y: 200 },
  { kind: 'sofa', x: 112, y: 222 }, { kind: 'sofa', x: 124, y: 222 }, { kind: 'sofa', x: 136, y: 222 },
];
export const SPAWN = { x: 404, y: CORR_Y };
export const penPos = i => {
  const k = i % 60, col = k % 12, row = Math.floor(k / 12);
  return { x: 214 + col * 7, y: 222 - row * 7 };
};

const DOORS = {
  raw:  { in: { x: 118, y: 114 }, corr: { x: 118, y: CORR_Y } },
  stg:  { in: { x: 226, y: 114 }, corr: { x: 226, y: CORR_Y } },
  mart: { in: { x: 340, y: 114 }, corr: { x: 340, y: CORR_Y } },
  pool: { in: { x: 144, y: 152 }, corr: { x: 144, y: CORR_Y } },
};
export const DOOR_X = { raw: 118, stg: 226, mart: 340, pool: 144 };
function areaOf(p) {
  if (p.y < 119) return p.x < 189 ? 'raw' : p.x < 303 ? 'stg' : 'mart';
  if (p.y > 144) return 'pool';
  return 'corr';
}
// Caminho de um worker: sai pela porta, anda pelo corredor, entra pela porta do destino.
export function route(from, to) {
  const pts = []; let cur = { x: from.x, y: from.y };
  const go = p => { if (cur.x !== p.x) pts.push({ x: p.x, y: cur.y }); if (cur.y !== p.y) pts.push({ x: p.x, y: p.y }); cur = { x: p.x, y: p.y }; };
  const A = areaOf(from), B = areaOf(to);
  if (A !== B) {
    if (A !== 'corr') { go(DOORS[A].in); go(DOORS[A].corr); }
    if (B !== 'corr') { go(DOORS[B].corr); go(DOORS[B].in); }
  }
  go(to);
  return pts;
}

export function allPaths() {
  const paths = Object.keys(SOURCE_POS).map(sourcePath);
  [0, 1, 2].forEach(i => {
    paths.push([...machineGeom('raw', i).outStart, queuePoint('stg')]);
    paths.push([...machineGeom('stg', i).outStart, { ...GATE }]);
    Object.values(CONSUMER_POS).forEach(c => paths.push(consumerPath(machineGeom('mart', i), c.cy)));
  });
  paths.push(GATE_PASS);
  return paths;
}
