'use strict';
/* ===================== Gravity Well — versión táctil =====================
   Reimplementación del juego Gravity Well 3.5 (Software Engineering, Inc., 1995)
   usando las formas vectoriales (SYMBOLS.DAT) y sonidos originales. */

const ASSETS = /*__ASSETS__*/null;
const SYM = ASSETS.symbols;
const TAU = Math.PI * 2;
const FS = 2; // escala de dibujo del caza (el original es diminuto para una pantalla de celular)

(function scaleFighter() {
  const s = SYM.FIGHTER;
  const sc = pts => pts.map(([x, y]) => [x * FS, y * FS]);
  s.main = sc(s.main);
  s.fire = s.fire.map(sc);
})();

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = Math.hypot;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
function angLerp(a, b, t) { return a + angDiff(b, a) * clamp(t, 0, 1); }
function toLocal(px, py, pa, x, y) { const dx = x - px, dy = y - py, c = Math.cos(pa), s = Math.sin(pa); return [dx * c + dy * s, -dx * s + dy * c]; }
function toWorld(px, py, pa, lx, ly) { const c = Math.cos(pa), s = Math.sin(pa); return [px + lx * c - ly * s, py + lx * s + ly * c]; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const C = {
  PLANET_R: 100, STAR_R: 150,
  GM_STAR: 3.0e6, GM_PLANET: 2.6e5,
  PORT_R: 215, PORT_W: 0.085,       // órbita del puerto orbital
  FR_ORBIT: 330, FR_W: 0.07,        // órbita de estacionamiento de cargueros
  F_ROT: 3.5,                       // rad/s
  LANDV: 48, CRASHV: 135,           // velocidades de aterrizaje
  F_TAIL: 8,                        // distancia del centro del caza a sus toberas
  GUN_SPD: 560, GUN_LIFE: 1.0, GUN_DMG: 3, GUN_CD: 0.17,
  ROCKET_SPD: 680, ROCKET_DMG: 14, MISSILE_DMG: 16,
  TUR_RANGE: 330, TUR_SPD: 430, TUR_DMG: 1.6,
  FTUR_RANGE: 260, FTUR_DMG: 2,
  DEV_P: 0.0028,                    // probabilidad por laboratorio por segundo de desarrollar una mejora
  MAX_FREIGHTERS: 4,
};

const TEAMS = [
  { name: 'Azul', color: '#3d74ff', dim: '#1a2f73' },
  { name: 'Rojo', color: '#ff3b30', dim: '#6e1a16' },
  { name: 'Púrpura', color: '#b44dff', dim: '#4b1d6b' },
  { name: 'Amarillo', color: '#ffd60a', dim: '#6b5a06' },
];
const COL = {
  planet: '#16c43a', star: '#ffd60a', turret: '#1fc9c9', fire: '#ff9a1f',
  sel: '#ffffff', rocket: '#c25bff', missile: '#ffffff', freightRadar: '#d0d0d0',
};

// Personalidades de la IA (los nombres vienen del ejecutable original)
const PERS = [
  { n: 'Agresivo',  retreat: 0.30, expand: 1.0, attack: 1.6, hunt: 1.0, defend: 0.8, keep: 1.3 },
  { n: 'Cauteloso', retreat: 0.60, expand: 1.2, attack: 0.7, hunt: 0.8, defend: 1.2, keep: 1.3 },
  { n: 'Cobarde',   retreat: 0.70, expand: 1.4, attack: 0.4, hunt: 1.0, defend: 0.6, keep: 1.2 },
  { n: 'Defensivo', retreat: 0.45, expand: 0.9, attack: 0.6, hunt: 0.6, defend: 2.2, keep: 1.3 },
  { n: 'Decidido',  retreat: 0.35, expand: 1.1, attack: 1.2, hunt: 1.0, defend: 1.0, keep: 2.2 },
  { n: 'Maníaco',   retreat: 0.15, expand: 0.7, attack: 2.0, hunt: 1.2, defend: 0.5, keep: 1.2 },
  { n: 'Astuto',    retreat: 0.50, expand: 1.2, attack: 0.9, hunt: 2.0, defend: 1.0, keep: 1.4 },
  { n: 'Tenaz',     retreat: 0.20, expand: 1.0, attack: 1.4, hunt: 1.0, defend: 1.0, keep: 1.8 },
  { n: 'Voraz',     retreat: 0.40, expand: 2.1, attack: 0.8, hunt: 0.8, defend: 0.8, keep: 1.3 },
];

// Tipos de unidad. hp = resistencia del SYMBOLS.DAT x10
const UT = {
  base:      { sym: 'PBASE',      name: 'Base',            hp: 180, surf: 1 },
  colony:    { sym: 'COLONY',     name: 'Colonia',         hp: 100, surf: 1 },
  lab:       { sym: 'LAB',        name: 'Laboratorio',     hp: 50,  surf: 1 },
  comm:      { sym: 'PCOMM',      name: 'Centro de Com.',  hp: 80,  surf: 1 },
  port:      { sym: 'STARBASE',   name: 'Puerto Orbital',  hp: 150, orb: 1 },
  dock:      { sym: 'SHIPYARD',   name: 'Dique Espacial',  hp: 80,  orb: 1 },
  sensor:    { sym: 'COMMCENTER', name: 'Sensores',        hp: 50,  orb: 1 },
  fighter:   { sym: 'FIGHTER',    name: 'Caza',            hp: 50,  ship: 1 },
  freighter: { sym: 'FREIGHTER',  name: 'Carguero',        hp: 100, ship: 1 },
};
const SLOTS = ['base', 'colony', 'lab', 'comm', 'port', 'dock', 'sensor'];
// Rectángulos de impacto en coordenadas locales (planeta o puerto), tomados de las formas originales
const HR = {
  base: [-20, -20, 20, 20], colony: [-70, -40, -30, 40], lab: [0, -70, 50, -40], comm: [0, 30, 40, 50],
  port: [-6, -44, 6, 44], dock: [6, -42, 20, -22], sensor: [6, 26, 18, 46],
};
const RC = { base: [0, 0], colony: [-50, 0], lab: [25, -55], comm: [20, 40], port: [0, 0], dock: [13, -32], sensor: [12, 36] };
const PORT_SOLID = [[-6, -44, 2, 44], [2, -44, 6, -20], [2, 20, 6, 44]];
const BASE_TURRETS = [[63, -63], [-63, -63], [63, 63], [-63, 63]];
const PORT_TURRETS = [[2.7, 28], [2.7, -28], [2, 45.5], [2, -45.5]];
const FR_TURRETS = [[-32, 0], [30, 0]];

const UPG = [
  { n: 'Cohetes', d: '6 cohetes no guiados (botón MISIL)' },
  { n: 'Escudos reforzados', d: 'Escudos de 40 a 70' },
  { n: 'Misiles guiados', d: 'Reemplazan a los cohetes y persiguen naves enemigas' },
  { n: 'Motores mejorados', d: 'Más empuje y velocidad máxima' },
  { n: 'Cañón doble', d: 'Dos disparos por ráfaga' },
  { n: 'Blindaje pesado', d: 'Casco de 50 a 75' },
  { n: 'Cargadores ampliados', d: '10 cohetes o misiles' },
];
function fstats(u) {
  return {
    maxSh: u >= 2 ? 70 : 40, maxHp: u >= 6 ? 75 : 50,
    ammoT: u >= 3 ? 2 : (u >= 1 ? 1 : 0), maxAmmo: u >= 7 ? 10 : (u >= 1 ? 6 : 0),
    thrust: u >= 4 ? 112 : 90, maxSpd: u >= 4 ? 400 : 320, twin: u >= 5, upg: u,
  };
}

const STAR_NAMES = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Épsilon', 'Zeta'];
const ROMAN = ['I', 'II', 'III'];

/* ===================== Estado ===================== */
let G = null;            // estado serializable de la partida
let U = new Map();       // id -> unidad (índice, se reconstruye)
let FX = [];             // partículas (no se guardan)
let ME = 0;              // equipo que maneja este teléfono
const NET = { role: null }; // 'host' | 'client' | null (se completa en net.js)
function isClient() { return NET.role === 'client' && !!G && !G.demo; }
const HOOK = { fx: null };  // el anfitrión lo usa para retransmitir explosiones

// Nombres de equipos: la computadora es "Líder Rojo Agresivo"; una persona, "Juan (Rojo)"
function teamName(t) {
  if (t.human) return t.pname ? `${t.pname} (${TEAMS[t.id].name})` : `Jugador ${TEAMS[t.id].name}`;
  return `Líder ${TEAMS[t.id].name} ${PERS[t.pers].n}`;
}
function elTeam(t) { return t.human ? teamName(t) : 'el ' + teamName(t); }
function alTeam(t) { return t.human ? 'a ' + teamName(t) : 'al ' + teamName(t); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// Dos equipos son enemigos si no comparten alianza (ally: 'solo' = su propio id, Equipo A = 10, Equipo B = 11)
function foe(a, b) { return a !== b && G.teams[a].ally !== G.teams[b].ally; }
function unitLabel(u) {
  const n = UT[u.type].name;
  if (u.type === 'dock' || u.type === 'sensor') return `${n}-${u.pn}`;
  return `${u.num}. ${n}`;
}
function planetName(p) { return p.name; }

/* ===================== Generación del sector ===================== */
function genSector(sector, size, demo) {
  const cfg = size === 0 ? { stars: 4, pmin: 1, pmax: 2, W: 10000 } : size === 2 ? { stars: 6, pmin: 2, pmax: 3, W: 13000 } : { stars: 5, pmin: 1, pmax: 3, W: 11500 };
  for (let attempt = 0; attempt < 200; attempt++) {
    const W = cfg.W, stars = [], planets = [];
    let ok = true;
    for (let i = 0; i < cfg.stars; i++) {
      let placed = false;
      for (let k = 0; k < 300 && !placed; k++) {
        const x = rnd(1700, W - 1700), y = rnd(1700, W - 1700);
        if (stars.every(s => hyp(s.x - x, s.y - y) > 3600)) { stars.push({ x, y, r: C.STAR_R, name: STAR_NAMES[i] }); placed = true; }
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;
    for (const s of stars) {
      const n = rndi(cfg.pmin, cfg.pmax);
      let idx = 0;
      for (let j = 0; j < 3 && idx < n; j++) {
        for (let k = 0; k < 40; k++) {
          const r = 760 + j * 520 + rnd(0, 160), a = rnd(0, TAU);
          const x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
          if (x < 500 || y < 500 || x > W - 500 || y > W - 500) continue;
          if (planets.some(p => hyp(p.x - x, p.y - y) < 950)) continue;
          if (stars.some(o => o !== s && hyp(o.x - x, o.y - y) < 1200)) continue;
          planets.push({ id: planets.length, x, y, r: C.PLANET_R, name: `${s.name} ${ROMAN[idx]}`, owner: -1, flagA: 0, pa: rnd(0, TAU), s: { base: 0, colony: 0, lab: 0, comm: 0, port: 0, dock: 0, sensor: 0 } });
          idx++; break;
        }
      }
    }
    if (planets.length < 6) continue;
    // Elegir 4 planetas natales lo más separados posible
    let best = null, bestD = -1;
    for (let k = 0; k < 400; k++) {
      const pick = shuffle(planets.slice()).slice(0, 4);
      let md = 1e9;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) md = Math.min(md, hyp(pick[a].x - pick[b].x, pick[a].y - pick[b].y));
      if (md > bestD) { bestD = md; best = pick; }
    }
    if (bestD < 2500) continue;
    return { W, stars, planets, homes: best };
  }
  throw new Error('No se pudo generar el sector');
}

// opts.slots: por color { ctl: 'ai' | 'local' | 'remote', pname, ally, token }
function newGame(sector, size, demo, opts) {
  opts = opts || {};
  const map = genSector(sector, size, demo);
  const persPool = shuffle(PERS.map((_, i) => i));
  const slots = opts.slots || TEAMS.map((_, i) => ({ ctl: !demo && i === 0 ? 'local' : 'ai' }));
  G = {
    v: 2, t: 0, sector, size, demo: !!demo, online: !!opts.online, W: map.W, nextId: 1, sid: 0, over: false,
    skill: clamp(0.52 + 0.07 * (sector - 1), 0.5, 0.95),
    stars: map.stars, planets: map.planets, units: [], shots: [],
    teams: TEAMS.map((tm, i) => {
      const sl = slots[i] || { ctl: 'ai' };
      return { id: i, ctl: sl.ctl, human: sl.ctl !== 'ai', pname: sl.pname || '', token: sl.token || '', ally: sl.ally == null ? i : sl.ally,
        alive: true, pers: persPool[i], dev: 0, site: 0, fBuild: 0, num: 0, alertT: -99, lostT: -99 };
    }),
  };
  U = new Map(); FX = [];
  map.homes.forEach((p, i) => setupHome(p, i));
  return G;
}

function newUnit(type, team, props) {
  const T = G.teams[team];
  const u = Object.assign({ id: G.nextId++, type, team, hp: UT[type].hp, maxHp: UT[type].hp, x: 0, y: 0, vx: 0, vy: 0, a: 0, num: ++T.num, hitT: -99 }, props || {});
  G.units.push(u); U.set(u.id, u);
  return u;
}

function spawnInstallation(p, type, hpFrac, mat) {
  const u = newUnit(type, p.owner, { pl: p.id, mat: mat || 0, bcd: 0, pcd: 0 });
  if (type === 'base' || type === 'port') u.tcd = [rnd(0, 1), rnd(0, 1), rnd(0, 1), rnd(0, 1)];
  u.hp = u.maxHp * hpFrac;
  p.s[type] = u.id;
  if (type === 'dock' || type === 'sensor') { const port = U.get(p.s.port); u.pn = port ? port.num : 0; }
  placeInst(u);
  return u;
}

function setupHome(p, team) {
  p.owner = team; p.flagA = -Math.PI / 2;
  spawnInstallation(p, 'base', 1, 100);
  spawnInstallation(p, 'colony', 1, 20);
  const lab = spawnInstallation(p, 'lab', 1);
  spawnInstallation(p, 'comm', 1);
  spawnInstallation(p, 'port', 1, 100);
  spawnInstallation(p, 'dock', 1);
  spawnInstallation(p, 'sensor', 1);
  const fr = spawnFreighter(team, p);
  fr.cargo = 100;
  G.teams[team].site = lab.id;
  const f = spawnFighterAt(team, lab, p);
  p.pa = f.la + Math.PI; // el puerto arranca del lado opuesto al caza
}

function spawnFreighter(team, p) {
  const oa = rnd(0, TAU);
  const fr = newUnit('freighter', team, { cargo: 0, st: 'o', opl: p.id, oa, job: null, jt: rnd(0, 1), tcd: [rnd(0, 1), rnd(0, 1)] });
  fr.x = p.x + Math.cos(oa) * C.FR_ORBIT; fr.y = p.y + Math.sin(oa) * C.FR_ORBIT;
  return fr;
}

function spawnFighterAt(team, site, p) {
  const T = G.teams[team];
  const st = fstats(T.dev);
  const f = newUnit('fighter', team, {
    hp: st.maxHp, maxHp: st.maxHp, sh: st.maxSh, upg: T.dev, ammo: st.maxAmmo, st: 'l', pl: p.id, la: -Math.PI / 2,
    pt: 0, gcd: 0, mcd: 0, thr: false, landT: 0, lastHit: -99, rearm: 0,
    ctl: { turn: 0, thrust: false, fire: false, mis: false }, ai: { goal: 'idle', tid: 0, tpl: -1, t: 0, err: 0, errT: 0 },
  });
  if (site && site.type === 'dock' && p.s.port) { f.st = 'd'; f.pt = p.s.port; }
  else { f.la = site && site.type === 'lab' ? Math.atan2(RC.lab[1], RC.lab[0]) : -Math.PI / 2; }
  f.a = f.la; f.landT = G.t;
  attachFighter(f);
  return f;
}

function portPos(p) { return [p.x + Math.cos(p.pa) * C.PORT_R, p.y + Math.sin(p.pa) * C.PORT_R]; }

function placeInst(u) {
  const p = G.planets[u.pl];
  const [cx, cy] = RC[u.type];
  if (UT[u.type].orb) {
    const [ox, oy] = portPos(p);
    const [wx, wy] = toWorld(ox, oy, p.pa, cx, cy);
    u.x = wx; u.y = wy; u.a = p.pa;
    u.vx = -(u.y - p.y) * C.PORT_W; u.vy = (u.x - p.x) * C.PORT_W;
  } else { u.x = p.x + cx; u.y = p.y + cy; u.vx = 0; u.vy = 0; }
}

function attachFighter(f) {
  if (f.st === 'l') {
    const p = G.planets[f.pl];
    f.x = p.x + Math.cos(f.la) * (p.r + C.F_TAIL); f.y = p.y + Math.sin(f.la) * (p.r + C.F_TAIL);
    f.vx = 0; f.vy = 0;
  } else if (f.st === 'd') {
    const port = U.get(f.pt);
    if (!port) { f.st = 'f'; return; }
    const p = G.planets[port.pl];
    const [ox, oy] = portPos(p);
    const [wx, wy] = toWorld(ox, oy, p.pa, 2 + C.F_TAIL, 0);
    f.x = wx; f.y = wy; f.a = p.pa;
    f.vx = -(wy - p.y) * C.PORT_W; f.vy = (wx - p.x) * C.PORT_W;
  }
}

function rebuildIndex() { U = new Map(); for (const u of G.units) U.set(u.id, u); }
function fighterOf(team) { for (const u of G.units) if (u.type === 'fighter' && u.team === team) return u; return null; }
function planetEmpty(p) { for (const k of SLOTS) if (p.s[k]) return false; return true; }
function countType(team, type) { let n = 0; for (const u of G.units) if (u.team === team && u.type === type) n++; return n; }
function hostOf(u) {
  const p = G.planets[u.pl];
  if (!p) return null;
  const h = UT[u.type].orb ? U.get(p.s.port) : U.get(p.s.base);
  return h && h.team === u.team ? h : null;
}
function hasIntel(team) { for (const u of G.units) if ((u.type === 'comm' || u.type === 'sensor') && !foe(u.team, team)) return true; return false; }
// Partidas guardadas por la versión anterior (sin controles por equipo ni alianzas)
function migrateGame(g) {
  for (const T of g.teams) {
    if (T.ctl == null) T.ctl = T.human ? 'local' : 'ai';
    if (T.ally == null) T.ally = T.id;
    if (T.pname == null) T.pname = '';
  }
  if (g.sid == null) g.sid = 0;
  g.v = 2;
  return g;
}
