/* ===================== Dibujo ===================== */
const app = document.getElementById('app');
const cv = document.getElementById('view'), ctx = cv.getContext('2d');
const hc = document.getElementById('hudc'), hx = hc.getContext('2d');
const V = { x: 0, y: 0, zoom: 0.8, baseZoom: 0.8, target: 0, w: 1, h: 1, dpr: 1 };
const HUD = { size: 120, h: 220, rows: {} };

function resize() {
  V.dpr = Math.min(window.devicePixelRatio || 1, 2);
  V.w = app.clientWidth || window.innerWidth; V.h = app.clientHeight || window.innerHeight;
  cv.width = Math.round(V.w * V.dpr); cv.height = Math.round(V.h * V.dpr);
  const nb = clamp(Math.min(V.w, V.h) / 560, 0.45, 1.4);
  if (V.baseZoom) V.zoom *= nb / V.baseZoom;
  V.baseZoom = nb;
  const s = Math.round(clamp(Math.min(V.w, V.h) * 0.3, 96, 150));
  const dial = Math.floor((s - 4 * 4) / 5);
  HUD.size = s; HUD.dial = dial;
  HUD.h = s + 5 + 11 + 4 * 9 + 4 + dial + 2;
  hc.width = s * V.dpr; hc.height = HUD.h * V.dpr;
  hc.style.width = s + 'px'; hc.style.height = HUD.h + 'px';
  app.style.setProperty('--hudw', (s + 12) + 'px');
}

function camTarget() {
  let t = U.get(V.target);
  if (t) return t;
  V.target = 0;
  const me = fighterOf(ME);
  if (me) { if (!G.demo) V.target = me.id; return me; }
  if (G.demo) { for (const u of G.units) if (u.type === 'fighter') return u; }
  const T = G.teams[ME];
  const site = U.get(T.buildSite) || U.get(T.site);
  if (site && site.team === ME) return site;
  for (const u of G.units) if (u.team === ME) return u;
  for (const u of G.units) if (u.type === 'fighter') return u;   // eliminado: mirar la partida
  return null;
}

function updCamera(dt) {
  const t = camTarget();
  if (!t) return;
  const k = 1 - Math.exp(-dt * 7);
  V.x += (t.x - V.x) * k; V.y += (t.y - V.y) * k;
}

function pathPts(pts, tx, ty, a, k) {
  const c = Math.cos(a), s = Math.sin(a);
  k = k || 1;
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0] * k, py = pts[i][1] * k;
    const x = tx + px * c - py * s, y = ty + px * s + py * c;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
}

function strokeSym(sym, x, y, a, color) {
  ctx.strokeStyle = color; ctx.beginPath(); pathPts(SYM[sym].main, x, y, a); ctx.stroke();
}

function hash(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function render() {
  const W = cv.width, H = cv.height, z = V.zoom * V.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(z, 0, 0, z, W / 2 - V.x * z, H / 2 - V.y * z);
  const lw = 1.35 * V.dpr / z;
  ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const hw = W / 2 / z, hh = H / 2 / z, x0 = V.x - hw, x1 = V.x + hw, y0 = V.y - hh, y1 = V.y + hh;
  const vis = (x, y, r) => x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;

  // campo de estrellas de fondo
  const TS = 640, ds = 1.4 * V.dpr / z;
  const i0 = Math.floor(x0 / TS), i1 = Math.floor(x1 / TS), j0 = Math.floor(y0 / TS), j1 = Math.floor(y1 / TS);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 260) {
    ctx.fillStyle = '#c8cddc';
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = 0; k < 5; k++) {
      ctx.globalAlpha = 0.25 + hash(i * 31 + k, j * 17 - k) * 0.75;
      ctx.fillRect(i * TS + hash(i * 7 + k, j * 13 + k * 3) * TS, j * TS + hash(i * 11 + k * 5, j * 3 + k) * TS, ds, ds);
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#1b2036'; ctx.strokeRect(0, 0, G.W, G.W);

  for (const s of G.stars) if (vis(s.x, s.y, s.r * 2.6)) drawStar(s);
  for (const p of G.planets) if (vis(p.x, p.y, C.PORT_R + 70)) drawPlanet(p, z);
  for (const u of G.units) if (u.type === 'freighter' && vis(u.x, u.y, 60)) drawFreighter(u);
  for (const u of G.units) if (u.type === 'fighter' && vis(u.x, u.y, 30)) drawFighter(u);

  // disparos
  for (const s of G.shots) {
    if (!vis(s.x, s.y, 20)) continue;
    if (s.k === 0) {
      ctx.strokeStyle = s.tur ? COL.turret : TEAMS[s.team].color;
      ctx.beginPath(); ctx.moveTo(s.x - s.vx * 0.014, s.y - s.vy * 0.014); ctx.lineTo(s.x, s.y); ctx.stroke();
    } else {
      ctx.strokeStyle = s.k === 1 ? COL.rocket : COL.missile;
      ctx.lineWidth = lw * 1.8;
      ctx.beginPath(); ctx.moveTo(s.x - s.vx * 0.022, s.y - s.vy * 0.022); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.lineWidth = lw;
    }
  }
  // partículas
  for (const p of FX) {
    if (!vis(p.x, p.y, p.r || 4)) continue;
    const a = p.life / p.max;
    ctx.globalAlpha = a;
    if (p.ring) { ctx.strokeStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - a) + 4, 0, TAU); ctx.stroke(); }
    else { ctx.fillStyle = p.color; const sz = p.size * V.dpr / z * 1.3; ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz); }
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!G.demo) drawEdgeMarkers();
}

function drawStar(s) {
  const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.3, s.x, s.y, s.r * 2.6);
  g.addColorStop(0, 'rgba(255,214,10,0.30)'); g.addColorStop(0.45, 'rgba(255,160,0,0.08)'); g.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#231b00'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = COL.star; ctx.stroke();
}

function unitColor(u, base) {
  if (G.t - u.hitT < 0.07) return '#ffffff';
  if (u.id === V.target && u.type !== 'fighter') return COL.sel;
  return base;
}

function drawPlanet(p, z) {
  ctx.strokeStyle = COL.planet;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
  const fs = 11 * V.dpr / z;
  if (fs < 60) {
    ctx.font = `${fs}px "Share Tech Mono", ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(22,196,58,0.55)'; ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y + p.r + fs * 1.6);
  }
  const tc = p.owner >= 0 ? TEAMS[p.owner].color : '#888';
  if (p.owner >= 0) {
    const c = Math.cos(p.flagA), s = Math.sin(p.flagA), r = p.r;
    ctx.strokeStyle = tc; ctx.beginPath();
    ctx.moveTo(p.x + c * r, p.y + s * r); ctx.lineTo(p.x + c * (r + 20), p.y + s * (r + 20));
    ctx.lineTo(p.x + c * (r + 16) - s * 10, p.y + s * (r + 16) + c * 10); ctx.lineTo(p.x + c * (r + 12), p.y + s * (r + 12));
    ctx.stroke();
  }
  const T = p.owner >= 0 ? G.teams[p.owner] : null;
  const flashLab = T && labFlash(T) && ((G.t * 3) | 0) % 2 === 0;
  for (const k of ['base', 'colony', 'lab', 'comm']) {
    const id = p.s[k]; if (!id) continue;
    const u = U.get(id); if (!u) continue;
    strokeSym(UT[k].sym, p.x, p.y, 0, k === 'lab' && flashLab ? '#ffffff' : unitColor(u, tc));
    if (k === 'base') {
      const q = 3 + 9 * u.mat / 100;
      ctx.fillStyle = unitColor(u, tc); ctx.fillRect(p.x - q, p.y - q, q * 2, q * 2);
      ctx.strokeStyle = COL.turret; ctx.beginPath();
      for (const t of SYM.PBASE.turret) pathPts(t, p.x, p.y, 0);
      ctx.stroke();
    }
  }
  if (p.s.port) {
    const port = U.get(p.s.port);
    if (port) {
      const [ox, oy] = portPos(p);
      strokeSym('STARBASE', ox, oy, p.pa, unitColor(port, tc));
      ctx.strokeStyle = COL.turret; ctx.beginPath();
      for (const t of SYM.STARBASE.turret) pathPts(t, ox, oy, p.pa);
      ctx.stroke();
      if (Math.sin(G.t * 2.3 + p.id * 1.7) > 0.8 && Math.random() > 0.2) {
        ctx.strokeStyle = COL.fire; ctx.beginPath();
        for (const t of SYM.STARBASE.fire) pathPts(t, ox, oy, p.pa);
        ctx.stroke();
      }
      for (const k of ['dock', 'sensor']) {
        const u = U.get(p.s[k]); if (!u) continue;
        strokeSym(UT[k].sym, ox, oy, p.pa, unitColor(u, tc));
      }
    }
  }
}

function labFlash(T) {
  if (T.dev <= 0) return false;
  const f = fighterOf(T.id);
  return f ? T.dev > f.upg : false;
}

function drawFighter(f) {
  ctx.strokeStyle = G.t - f.hitT < 0.07 ? '#ffffff' : TEAMS[f.team].color;
  ctx.beginPath(); pathPts(SYM.FIGHTER.main, f.x, f.y, f.a); ctx.stroke();
  const T = G.teams[f.team];
  if (G.online && T.human && f.team !== ME) {
    const z = V.zoom * V.dpr, fs = 11 * V.dpr / z;
    ctx.font = `${fs}px "Share Tech Mono", ui-monospace, monospace`; ctx.textAlign = 'center';
    ctx.fillStyle = TEAMS[f.team].color;
    ctx.fillText((T.pname || TEAMS[f.team].name) + (foe(f.team, ME) ? '' : ' ·aliado'), f.x, f.y + 34 * V.dpr / z * 0.9 + 14);
  }
  if (f.thr && Math.random() > 0.12) {
    ctx.strokeStyle = COL.fire; ctx.beginPath();
    for (const t of SYM.FIGHTER.fire) pathPts(t, f.x, f.y, f.a);
    ctx.stroke();
  }
  if (G.t - f.lastHit < 0.25 && f.sh > 0) {
    ctx.strokeStyle = 'rgba(120,200,255,0.55)';
    ctx.beginPath(); ctx.arc(f.x, f.y, 20, 0, TAU); ctx.stroke();
  }
}

function drawFreighter(fr) {
  const col = unitColor(fr, TEAMS[fr.team].color);
  const S = SYM.FREIGHTER;
  strokeSym('FREIGHTER', fr.x, fr.y, fr.a, col);
  if (fr.cargo > 0) {
    ctx.globalAlpha = 0.3 + 0.7 * fr.cargo / 100;
    ctx.strokeStyle = col; ctx.beginPath();
    for (const t of S.cargopod) pathPts(t, fr.x, fr.y, fr.a);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = COL.turret; ctx.beginPath();
  for (const t of S.turret) pathPts(t, fr.x, fr.y, fr.a);
  ctx.stroke();
  ctx.strokeStyle = TEAMS[fr.team].color; ctx.beginPath();
  for (const t of S.flag) pathPts(t, fr.x, fr.y, fr.a);
  ctx.stroke();
  if (fr.thr && Math.random() > 0.2) {
    ctx.strokeStyle = COL.fire; ctx.beginPath();
    for (const t of S.fire) pathPts(t, fr.x, fr.y, fr.a);
    ctx.stroke();
  }
}

/* Marcadores en el borde de la pantalla: planeta más cercano (verde) y enemigo más cercano (rojo) */
function drawEdgeMarkers() {
  const me = fighterOf(ME);
  if (!me) return;
  const W = cv.width, H = cv.height, d = V.dpr, z = V.zoom * d;
  const marks = [];
  const np = nearest(me, G.planets);
  if (np) marks.push([np.x, np.y, COL.planet]);
  const ne = nearestEnemy(me, true);
  if (ne && ne.d < 2600) marks.push([ne.u.x, ne.u.y, '#ff4040']);
  const insetL = (HUD.size + 18) * d, pad = 22 * d;
  for (const [x, y, color] of marks) {
    const sx = (x - V.x) * z + W / 2, sy = (y - V.y) * z + H / 2;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const a = Math.atan2(sy - H / 2, sx - W / 2);
    const ex = clamp(sx, pad, W - pad), ey = clamp(sy, pad, H - pad);
    let px = ex, py = ey;
    if (px < insetL && py < (HUD.h + 18) * d) py = Math.max(py, (HUD.h + 18) * d);
    ctx.save(); ctx.translate(px, py); ctx.rotate(a);
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(9 * d, 0); ctx.lineTo(-6 * d, -6 * d); ctx.lineTo(-3 * d, 0); ctx.lineTo(-6 * d, 6 * d); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function nearest(from, list) {
  let best = null, bd = 1e18;
  for (const o of list) { const dd = (o.x - from.x) ** 2 + (o.y - from.y) ** 2; if (dd < bd) { bd = dd; best = o; } }
  return best;
}
function nearestEnemy(from, shipsOnly) {
  let best = null, bd = 1e18;
  for (const u of G.units) {
    if (u.team === from.team || (shipsOnly && !UT[u.type].ship)) continue;
    const dd = (u.x - from.x) ** 2 + (u.y - from.y) ** 2;
    if (dd < bd) { bd = dd; best = u; }
  }
  return best ? { u: best, d: Math.sqrt(bd) } : null;
}

/* ===================== Panel de estado (radar, barras y diales) ===================== */
function hudFighter() {
  const t = U.get(V.target);
  if (t && t.type === 'fighter') return t;
  return fighterOf(ME);
}

function drawRadar(g, x, y, w, big) {
  const k = w / G.W;
  g.fillStyle = '#000'; g.fillRect(x, y, w, w);
  g.lineWidth = 1; g.strokeStyle = '#39405e'; g.strokeRect(x + 0.5, y + 0.5, w - 1, w - 1);
  const intel = G.demo || hasIntel(ME);
  const vw = V.w / V.zoom, vh = V.h / V.zoom;
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.strokeRect(x + (V.x - vw / 2) * k, y + (V.y - vh / 2) * k, vw * k, vh * k);
  for (const s of G.stars) { g.fillStyle = COL.star; g.beginPath(); g.arc(x + s.x * k, y + s.y * k, big ? 6 : 2.6, 0, TAU); g.fill(); }
  g.font = `${big ? 12 : 9}px "Share Tech Mono", ui-monospace, monospace`; g.textAlign = 'center';
  for (const p of G.planets) {
    const px = x + p.x * k, py = y + p.y * k;
    g.fillStyle = COL.planet; g.beginPath(); g.arc(px, py, big ? 4 : 1.8, 0, TAU); g.fill();
    if (p.owner >= 0 && (intel || !foe(p.owner, ME))) { const b = big ? 10 : 4.5; g.strokeStyle = TEAMS[p.owner].color; g.strokeRect(px - b, py - b, b * 2, b * 2); }
    if (big) { g.fillStyle = 'rgba(200,210,230,0.7)'; g.font = '11px "Share Tech Mono", ui-monospace, monospace'; g.fillText(p.name, px, py + 22); }
  }
  for (const u of G.units) {
    if (!UT[u.type].ship) continue;
    if (!intel && !(u.type === 'fighter' && !foe(u.team, ME))) continue;
    const px = x + u.x * k, py = y + u.y * k;
    if (u.type === 'fighter') { g.fillStyle = TEAMS[u.team].color; const r = big ? 3.5 : 1.8; g.fillRect(px - r, py - r, r * 2, r * 2); }
    else { g.fillStyle = COL.freightRadar; const r = big ? 2.5 : 1.1; g.fillRect(px - r, py - r, r * 2, r * 2); }
  }
  const sel = camTarget();
  if (sel) { const b = big ? 9 : 5; g.strokeStyle = '#fff'; g.strokeRect(x + sel.x * k - b, y + sel.y * k - b, b * 2, b * 2); }
  if (!intel) {
    g.fillStyle = 'rgba(255,90,90,0.9)'; g.font = `${big ? 15 : 9}px "Share Tech Mono", ui-monospace, monospace`;
    g.fillText('SIN SENSORES', x + w / 2, y + w - (big ? 14 : 6));
  }
}

function drawDial(g, cx, cy, r, bg) {
  g.fillStyle = bg || '#000'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  g.strokeStyle = '#5a6382'; g.lineWidth = 1; g.stroke();
}
function needle(g, cx, cy, r, a, color, len) {
  g.strokeStyle = color; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * (len || 0.8), cy + Math.sin(a) * r * (len || 0.8)); g.stroke();
}

function drawHud() {
  const d = V.dpr, s = HUD.size, g = hx;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, s, HUD.h);
  drawRadar(g, 0, 0, s, false);
  let y = s + 5;
  HUD.rows.teams = [y, y + 9];
  const bw = (s - 6) / 4;
  const pend = labFlash(G.teams[ME]) && ((G.t * 3) | 0) % 2 === 0;
  for (let i = 0; i < 4; i++) {
    const T = G.teams[i];
    g.fillStyle = T.alive ? (i === ME && pend ? '#ffffff' : TEAMS[i].color) : '#000';
    g.fillRect(i * (bw + 2), y, bw, 9);
    g.strokeStyle = i === ME ? '#ffffff' : (!foe(i, ME) ? '#9aa6c8' : '#3a4160'); g.lineWidth = 1;
    g.strokeRect(i * (bw + 2) + 0.5, y + 0.5, bw - 1, 8);
    if (i !== ME && !foe(i, ME)) { g.fillStyle = '#ffffff'; g.fillRect(i * (bw + 2) + bw / 2 - 2, y + 3, 4, 3); }
  }
  y += 13;
  const f = hudFighter();
  const st = f ? fstats(f.upg) : fstats(0);
  const bar = (frac, fg, bg) => { g.fillStyle = bg; g.fillRect(0, y, s, 6); g.fillStyle = fg; g.fillRect(0, y, s * clamp(frac, 0, 1), 6); y += 9; };
  bar(f ? f.sh / st.maxSh : 0, '#62b6ff', '#0b1c70');
  g.fillStyle = '#000'; g.fillRect(0, y, s, 6);
  if (f && st.ammoT) { g.fillStyle = st.ammoT === 1 ? COL.rocket : '#ffffff'; for (let i = 0; i < f.ammo; i++) g.fillRect(2 + i * 5, y, 2, 6); }
  y += 9;
  bar(f ? f.hp / st.maxHp : 0, '#16b416', '#c01212');
  let spd = 0, slow = false;
  if (f) {
    let rvx = f.vx, rvy = f.vy;
    if (f.st === 'f') for (const p of G.planets) {
      if (!p.s.port) continue;
      const [ox, oy] = portPos(p);
      if (hyp(f.x - ox, f.y - oy) < 160) { rvx -= -(oy - p.y) * C.PORT_W; rvy -= (ox - p.x) * C.PORT_W; break; }
    }
    if (f.st !== 'f') { rvx = 0; rvy = 0; }
    spd = hyp(rvx, rvy); slow = spd <= C.LANDV;
  }
  bar(spd / st.maxSpd, '#2ff0ff', slow && f ? '#1733b0' : '#000');
  y += 2;
  HUD.rows.dials = y;
  const r = HUD.dial / 2;
  const cxs = [0, 1, 2, 3, 4].map(i => r + i * (HUD.dial + 4));
  const cy = y + r;
  // reloj
  drawDial(g, cxs[0], cy, r);
  const now = new Date();
  needle(g, cxs[0], cy, r, ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU - Math.PI / 2, '#ff5050', 0.5);
  needle(g, cxs[0], cy, r, now.getMinutes() / 60 * TAU - Math.PI / 2, '#5a8cff', 0.8);
  const from = f || camTarget() || { x: V.x, y: V.y, team: 0 };
  // estrella más cercana
  drawDial(g, cxs[1], cy, r);
  const ns = nearest(from, G.stars); if (ns) needle(g, cxs[1], cy, r, Math.atan2(ns.y - from.y, ns.x - from.x), COL.star);
  // planeta más cercano
  drawDial(g, cxs[2], cy, r);
  const np = nearest(from, G.planets); if (np) needle(g, cxs[2], cy, r, Math.atan2(np.y - from.y, np.x - from.x), COL.planet);
  // enemigo más cercano
  const ne = nearestEnemy(from, false);
  drawDial(g, cxs[3], cy, r, ne && ne.d < 700 ? '#7a0000' : '#000');
  if (ne) needle(g, cxs[3], cy, r, Math.atan2(ne.u.y - from.y, ne.u.x - from.x), '#ff3b30');
  // orientación del caza
  drawDial(g, cxs[4], cy, r);
  if (f) {
    g.save(); g.translate(cxs[4], cy); g.rotate(f.a); g.scale(r / 20, r / 20);
    g.strokeStyle = TEAMS[f.team].color; g.lineWidth = 2; g.beginPath();
    SYM.FIGHTER.main.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
    g.stroke(); g.restore();
  }
}
