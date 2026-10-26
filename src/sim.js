/* ===================== Simulación ===================== */
const STEP = 1 / 60;

function gravityAt(x, y) {
  let ax = 0, ay = 0;
  for (const s of G.stars) {
    const dx = s.x - x, dy = s.y - y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
    const f = C.GM_STAR / Math.max(d2, s.r * s.r);
    ax += f * dx / d; ay += f * dy / d;
  }
  for (const p of G.planets) {
    const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
    if (d2 > 6.25e6) continue;
    const d = Math.sqrt(d2) || 1, f = C.GM_PLANET / Math.max(d2, p.r * p.r);
    ax += f * dx / d; ay += f * dy / d;
  }
  return [ax, ay];
}

function step(dt) {
  G.t += dt;
  for (const p of G.planets) p.pa += C.PORT_W * dt;
  for (const u of G.units) if (UT[u.type].surf || UT[u.type].orb) placeInst(u);
  G.tick = (G.tick || 0) + dt;
  if (G.tick >= 0.5) { G.tick -= 0.5; for (const T of G.teams) { teamTick(T, 0.5); if (G.over) return; } }
  for (const p of G.planets) if (p.owner >= 0) economy(p, dt);
  const list = G.units.slice();
  for (const u of list) {
    if (u.dead) continue;
    if (u.type === 'fighter') {
      const ctl = G.teams[u.team].ctl;
      if (ctl === 'remote') remoteFighter(u, dt);
      else { if (ctl === 'local') playerControl(u); else aiFighter(u, dt); updFighter(u, dt); }
    } else if (u.type === 'freighter') updFreighter(u, dt);
    if (!u.dead && u.tcd) turrets(u, dt);
  }
  updShots(dt);
  updFx(dt);
}

/* ---------- economía ---------- */
function economy(p, dt) {
  const s = p.s;
  const base = s.base ? U.get(s.base) : null, col = s.colony ? U.get(s.colony) : null, port = s.port ? U.get(s.port) : null;
  if (col) {
    col.mat = Math.min(100, col.mat + 2.6 * dt);
    if (base && base.mat < 100) { const a = Math.min(2.0 * dt, col.mat, 100 - base.mat); col.mat -= a; base.mat += a; }
    if (port && port.mat < 100) { const a = Math.min(1.2 * dt, col.mat, 100 - port.mat); col.mat -= a; port.mat += a; }
  }
  for (const k of SLOTS) {
    const id = s[k]; if (!id) continue;
    const u = U.get(id); if (!u || u.hp >= u.maxHp) continue;
    const host = UT[k].orb ? port : base;
    if (!host || host.mat <= 0.5) continue;
    const a = Math.min(1.6 * dt, u.maxHp - u.hp);
    u.hp += a; host.mat = Math.max(0, host.mat - a * 0.25);
  }
  if (base) { if (!s.lab) buildBy(p, base, 'lab', 60, 12, dt); else if (!s.comm) buildBy(p, base, 'comm', 40, 10, dt); else base.bcd = 0; }
  if (port) { if (!s.dock) buildBy(p, port, 'dock', 50, 12, dt); else if (!s.sensor) buildBy(p, port, 'sensor', 40, 10, dt); else port.bcd = 0; }
}

function buildBy(p, host, type, cost, time, dt) {
  if (host.mat < cost + 10) return;
  host.bcd += dt;
  if (host.bcd < time) return;
  host.bcd = 0; host.mat -= cost;
  const u = spawnInstallation(p, type, 0.5);
  tell(p.owner, `Nueva instalación: ${UT[type].name} en ${p.name}`); tsfx(p.owner, 'install', u.x, u.y, 0.6);
}

function nextBuild(p, noCol) {
  const s = p.s;
  if (noCol && !s.colony) return 'colony';
  if (!s.base) return 'base';
  if (!s.colony) return 'colony';
  if (!s.port) return 'port';
  return null;
}

/* ---------- equipos ---------- */
function teamTick(T, dt) {
  if (!T.alive) return;
  let cols = 0, labs = 0, fighter = null;
  const frs = [], producers = [];
  for (const u of G.units) {
    if (u.team !== T.id) continue;
    if (u.type === 'colony') cols++;
    else if (u.type === 'lab') { labs++; producers.push(u); }
    else if (u.type === 'dock') producers.push(u);
    else if (u.type === 'freighter') frs.push(u);
    else if (u.type === 'fighter') fighter = u;
  }
  if (cols === 0 && !frs.some(f => f.cargo >= 100)) { defeatTeam(T); return; }

  // Laboratorios: desarrollo de mejoras
  if (labs > 0 && T.dev < UPG.length && Math.random() < 1 - Math.pow(1 - C.DEV_P / (1 + 0.3 * T.dev), labs * dt)) {
    T.dev++;
    tell(T.id, `Tus laboratorios desarrollaron: ${UPG[T.dev - 1].n}. Aterrizá en un planeta tuyo con laboratorio para instalarla.`, 'dev'); tsfx(T.id, 'develop');
  }

  // Caza del líder
  if (!fighter) {
    let site = U.get(T.site);
    if (!site || site.team !== T.id || (site.type !== 'lab' && site.type !== 'dock')) site = null;
    const siteHost = site && hostOf(site);
    if (!site || !siteHost || siteHost.mat < 50) {
      let best = null, bm = -1;
      for (const pr of producers) { const h = hostOf(pr); if (h && h.mat > bm) { bm = h.mat; best = pr; } }
      if (!site || (best && bm >= 50)) site = best;
    }
    T.buildSite = site ? site.id : 0;
    const host = site && hostOf(site);
    if (host && host.mat >= 50) {
      T.fBuild += dt;
      if (T.fBuild >= (T.human ? 5 : 8)) {
        T.fBuild = 0; host.mat -= 50;
        const f = spawnFighterAt(T.id, site, G.planets[site.pl]);
        tell(T.id, `Nuevo caza listo en ${G.planets[site.pl].name}.`, 'good'); tsfx(T.id, 'install'); onFighterSpawn(T.id, f);
      }
    }
  } else { T.fBuild = 0; T.buildSite = 0; }

  // Cargueros
  let jobs = 0;
  for (const p of G.planets) if (p.owner === T.id && nextBuild(p, cols === 0)) jobs++;
  const desired = Math.min(C.MAX_FREIGHTERS, 1 + jobs);
  if (frs.length < desired) {
    let started = false;
    for (const pr of producers) {
      const h = hostOf(pr), p = G.planets[pr.pl];
      if (started || !h || h.mat < 80 || frs.some(f => hyp(f.x - p.x, f.y - p.y) < 450)) { pr.pcd = Math.max(0, (pr.pcd || 0) - dt); continue; }
      started = true;
      pr.pcd = (pr.pcd || 0) + dt;
      if (pr.pcd >= 10) {
        pr.pcd = 0; h.mat -= 60;
        spawnFreighter(T.id, p);
        tell(T.id, `Nuevo carguero en ${p.name}.`);
      }
    }
  }
}

function defeatTeam(T) {
  T.alive = false;
  if (G.demo) { if (G.teams.filter(t => t.alive).length <= 1) G.over = true; return; }
  for (const O of G.teams) {
    if (!O.human) continue;
    if (O.id === T.id) tell(O.id, 'Te quedaste sin colonias ni cargueros. Seguís mirando la partida.', 'bad');
    else { tell(O.id, `¡${teamName(T)} fue derrotado! Sin colonias ni cargueros, ya no puede expandirse en este sector.`, 'big'); tsfx(O.id, 'siren'); }
  }
  checkSectorEnd();
}

// Termina cuando queda un solo equipo (o alianza) en pie, o cuando ya no queda ninguna persona en juego
function checkSectorEnd() {
  if (G.over || G.demo) return;
  const alive = G.teams.filter(t => t.alive);
  const groups = new Set(alive.map(t => t.ally));
  if (groups.size <= 1 || !alive.some(t => t.human)) sectorEnd(groups.size === 1 ? [...groups][0] : null);
}

/* ---------- unidades: daño y destrucción ---------- */
function damage(u, dmg, by) {
  if (u.dead) return;
  if (u.type === 'fighter') { u.lastHit = G.t; const ab = Math.min(u.sh, dmg); u.sh -= ab; dmg -= ab; }
  u.hp -= dmg; u.hitT = G.t;
  const T = G.teams[u.team];
  if (T.human) {
    if (u.type === 'fighter') tvib(T.id, 12);
    else if (G.t - T.alertT > 20) {
      T.alertT = G.t;
      const inst = UT[u.type].surf || UT[u.type].orb;
      tell(T.id, `¡Están atacando tu ${UT[u.type].name.toLowerCase()}${inst ? ' en ' + G.planets[u.pl].name : ''}!`, 'warn');
      tsfx(T.id, 'siren', null, null, 0.45);
    }
  }
  if (u.hp <= 0) killUnit(u, by);
}

function hullDamage(f, dmg, by) {
  if (isClient()) { netReportDamage(f, dmg); return; } // en un cliente lo decide el anfitrión
  damage(f, 0, by); f.hp -= dmg; if (f.hp <= 0) killUnit(f, by, 'crash');
}

function removeUnit(u) {
  u.dead = true;
  const i = G.units.indexOf(u); if (i >= 0) G.units.splice(i, 1);
  U.delete(u.id);
  for (const s of G.shots) if (s.tg === u.id) s.tg = 0;
}

function killUnit(u, by, cause) {
  if (u.dead) return;
  if (isClient()) { netReportCrash(u, cause); return; }
  const n = u.type === 'fighter' ? 28 : u.type === 'freighter' ? 46 : 60;
  explode(u.x, u.y, n, TEAMS[u.team].color);
  sfx('collide', u.x, u.y, 1);
  removeUnit(u);
  const inst = UT[u.type].surf || UT[u.type].orb;
  if (inst) {
    const p = G.planets[u.pl];
    if (p.s[u.type] === u.id) p.s[u.type] = 0;
    if (u.type === 'port') {
      for (const k of ['dock', 'sensor']) { const sub = U.get(p.s[k]); if (sub) killUnit(sub, by); }
      for (const f of G.units) if (f.type === 'fighter' && f.st === 'd' && f.pt === u.id) { f.st = 'f'; f.pt = 0; }
    }
  }
  const T = G.teams[u.team];
  if (T.human) {
    if (u.type === 'fighter') {
      tvib(T.id, [60, 40, 140]); tsfx(T.id, 'siren');
      tell(T.id, cause === 'star' ? 'Tu caza cayó en una estrella.' : cause === 'crash' ? 'Tu caza se estrelló.' : 'Tu caza fue destruido.', 'bad');
    } else tell(T.id, `Perdiste: ${UT[u.type].name}${inst ? ' en ' + G.planets[u.pl].name : ''}.`, 'bad');
  }
  if (u.type === 'fighter') onFighterLost(u.team, u);
  if (u.type === 'fighter' && by >= 0 && by !== u.team && G.teams[by] && G.teams[by].human) tell(by, `Derribaste ${alTeam(T)}.`, 'good');
}

/* ---------- caza ---------- */
function updFighter(f, dt) {
  const st = fstats(f.upg);
  f.maxHp = st.maxHp;
  const c = f.ctl;
  f.gcd -= dt; f.mcd -= dt; f.thr = false;
  if (f.st === 'l' || f.st === 'd') {
    if (f.st === 'l') f.a = angLerp(f.a, f.la, dt * 5);
    attachFighter(f);
    if (f.st !== 'f') {
      service(f, st, dt);
      if (c.thrust && G.t - f.landT > 0.35) takeoff(f);
      else { weapons(f, st, c); return; }
    }
  }
  flyStep(f, st, c, dt);
  if (f.dead) return;
  if (f.sh < st.maxSh && G.t - f.lastHit > 4) f.sh = Math.min(st.maxSh, f.sh + 0.8 * dt);
  weapons(f, st, c);
}

// Movimiento en vuelo (giro, gravedad, empuje, límites y choques). Lo usan el anfitrión y cada cliente para su propia nave.
function flyStep(f, st, c, dt) {
  f.a += clamp(c.turn, -1, 1) * C.F_ROT * dt;
  const [gx, gy] = gravityAt(f.x, f.y);
  let ax = gx, ay = gy;
  if (c.thrust) { ax += Math.cos(f.a) * st.thrust; ay += Math.sin(f.a) * st.thrust; f.thr = true; }
  const ps = hyp(f.vx, f.vy);
  f.vx += ax * dt; f.vy += ay * dt;
  let sp = hyp(f.vx, f.vy);
  if (c.thrust && sp > st.maxSpd && sp > ps) { const k = Math.max(ps, st.maxSpd) / sp; f.vx *= k; f.vy *= k; sp *= k; }
  if (sp > st.maxSpd * 1.5) { const k = st.maxSpd * 1.5 / sp; f.vx *= k; f.vy *= k; }
  f.x += f.vx * dt; f.y += f.vy * dt;
  const W = G.W;
  if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx) * 0.5; } else if (f.x > W) { f.x = W; f.vx = -Math.abs(f.vx) * 0.5; }
  if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy) * 0.5; } else if (f.y > W) { f.y = W; f.vy = -Math.abs(f.vy) * 0.5; }
  collideFighter(f);
}

function takeoff(f) {
  const n = f.st === 'l' ? f.la : f.a;
  const bvx = f.st === 'd' ? f.vx : 0, bvy = f.st === 'd' ? f.vy : 0;
  f.st = 'f'; f.pt = 0; f.a = n;
  f.vx = bvx + Math.cos(n) * 45; f.vy = bvy + Math.sin(n) * 45;
  f.x += Math.cos(n) * 3; f.y += Math.sin(n) * 3;
  f.lift = G.t;
}

function service(f, st, dt) {
  let host = null;
  if (f.st === 'l') { const p = G.planets[f.pl]; if (p.owner >= 0 && !foe(p.owner, f.team) && p.s.base) host = U.get(p.s.base); tryInstall(f, p, false); }
  else { const port = U.get(f.pt); if (port && !foe(port.team, f.team)) { host = port; tryInstall(f, G.planets[port.pl], true); } }
  if (f.upg !== st.upg) st = fstats(f.upg);
  f.sh = Math.min(st.maxSh, f.sh + (host ? 10 : 2) * dt);
  f.servicing = false;
  if (!host || host.mat < 0.5) return;
  if (f.hp < st.maxHp) { const a = Math.min(6 * dt, st.maxHp - f.hp); f.hp += a; host.mat = Math.max(0, host.mat - a * 0.3); f.servicing = true; }
  if (f.ammo < st.maxAmmo) { f.rearm += dt; f.servicing = true; if (f.rearm >= 1.0) { f.rearm = 0; f.ammo++; host.mat = Math.max(0, host.mat - 2); } }
}

function weapons(f, st, c) {
  if (c.fire && f.gcd <= 0) {
    f.gcd = C.GUN_CD;
    const ca = Math.cos(f.a), sa = Math.sin(f.a);
    for (const o of (st.twin ? [-6, 6] : [0])) addShot(f.team, f.x + ca * 16 - sa * o, f.y + sa * 16 + ca * o, f.vx + ca * C.GUN_SPD, f.vy + sa * C.GUN_SPD, C.GUN_LIFE, C.GUN_DMG, 0);
    sfx('fire', f.x, f.y, G.teams[f.team].human ? 0.35 : 0.25, 0.09, f.team);
  }
  if (c.mis && f.mcd <= 0 && f.ammo > 0 && st.ammoT) {
    f.mcd = 0.6; f.ammo--;
    const ca = Math.cos(f.a), sa = Math.sin(f.a);
    if (st.ammoT === 1) addShot(f.team, f.x + ca * 16, f.y + sa * 16, f.vx + ca * C.ROCKET_SPD, f.vy + sa * C.ROCKET_SPD, 1.5, C.ROCKET_DMG, 1);
    else { const s = addShot(f.team, f.x + ca * 16, f.y + sa * 16, f.vx + ca * 260, f.vy + sa * 260, 4.0, C.MISSILE_DMG, 2); s.tg = missileTarget(f); }
    sfx('missile', f.x, f.y, 0.6, 0.06, f.team);
  }
}

function missileTarget(f) {
  let best = 0, bs = -1e9;
  for (const u of G.units) {
    if (!foe(u.team, f.team) || !UT[u.type].ship) continue;
    const dx = u.x - f.x, dy = u.y - f.y, d = hyp(dx, dy);
    if (d > 1100) continue;
    const off = Math.abs(angDiff(Math.atan2(dy, dx), f.a));
    if (off > 1.3 && d > 300) continue;
    const s = -d - off * 500;
    if (s > bs) { bs = s; best = u.id; }
  }
  return best;
}

function collideFighter(f) {
  const ai = !G.teams[f.team].human;
  for (const s of G.stars) if (hyp(f.x - s.x, f.y - s.y) < s.r + 6) { killUnit(f, -1, 'star'); return; }
  if (G.t - (f.lift || -9) < 0.3) return;
  for (const p of G.planets) {
    const dx = f.x - p.x, dy = f.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 > 160000) continue;
    const d = Math.sqrt(d2);
    if (d < p.r + C.F_TAIL) { planetContact(f, p, dx / d, dy / d, ai); if (f.dead || f.st !== 'f') return; }
    if (p.s.port) { portContact(f, p, ai); if (f.dead || f.st !== 'f') return; }
  }
}

function planetContact(f, p, nx, ny, ai) {
  const spd = hyp(f.vx, f.vy), la = Math.atan2(ny, nx);
  const err = Math.abs(angDiff(f.a, la));
  const tolV = C.LANDV * (ai ? 1.4 : 1), tolA = ai ? 1.0 : 0.62;
  f.x = p.x + nx * (p.r + C.F_TAIL); f.y = p.y + ny * (p.r + C.F_TAIL);
  if (spd > C.CRASHV) { killUnit(f, -1, 'crash'); return; }
  if (spd > tolV) {
    const vr = f.vx * nx + f.vy * ny;
    if (vr < 0) { f.vx -= 1.4 * vr * nx; f.vy -= 1.4 * vr * ny; }
    hullDamage(f, (spd - tolV) * 0.6 + 3, -1);
    sfx('collide', f.x, f.y, 0.8, 0.3);
    if (!f.dead) tell(f.team, '¡Demasiado rápido para aterrizar!', 'warn', 'fast');
    return;
  }
  f.st = 'l'; f.pl = p.id; f.la = la; f.landT = G.t; f.vx = 0; f.vy = 0; f.rearm = 0;
  if (err > tolA) {
    hullDamage(f, 5 + err * 7, -1);
    sfx('collide', f.x, f.y, 0.7);
    if (f.dead) return;
    tell(f.team, 'Aterrizaje forzoso: la nave se dañó por estar mal orientada.', 'warn');
  }
  if (!isClient()) arrived(f, p, false);
}

function portContact(f, p, ai) {
  const [ox, oy] = portPos(p);
  const dx = f.x - ox, dy = f.y - oy;
  if (dx * dx + dy * dy > 4900) return;
  const port = U.get(p.s.port);
  if (!port) return;
  const pvx = -(oy - p.y) * C.PORT_W, pvy = (ox - p.x) * C.PORT_W;
  let rvx = f.vx - pvx, rvy = f.vy - pvy;
  const [lx, ly] = toLocal(ox, oy, p.pa, f.x, f.y);
  const c = Math.cos(p.pa), s = Math.sin(p.pa);
  const lvx = rvx * c + rvy * s;
  const rsp = hyp(rvx, rvy);
  const rh = angDiff(f.a, p.pa);
  const tolV = C.LANDV * (ai ? 1.4 : 1), tolA = ai ? 0.8 : 0.62;
  if (!foe(port.team, f.team) && lx > 2 && lx < 2 + C.F_TAIL + 4 && Math.abs(ly) < 17 && rsp <= tolV && Math.abs(rh) <= tolA && lvx <= 8) {
    f.st = 'd'; f.pt = port.id; f.landT = G.t; f.rearm = 0;
    attachFighter(f);
    if (!isClient()) arrived(f, p, true);
    return;
  }
  const rects = PORT_SOLID.slice();
  if (p.s.dock) rects.push(HR.dock);
  if (p.s.sensor) rects.push(HR.sensor);
  const r = 10;
  for (const R of rects) {
    const cx = clamp(lx, R[0], R[2]), cy = clamp(ly, R[1], R[3]);
    let ex = lx - cx, ey = ly - cy, ed = hyp(ex, ey), nxl, nyl, push;
    if (ed >= r) continue;
    if (ed < 0.001) {
      const pl = lx - R[0], pr = R[2] - lx, pt = ly - R[1], pb = R[3] - ly, m = Math.min(pl, pr, pt, pb);
      if (m === pl) { nxl = -1; nyl = 0; push = pl + r; } else if (m === pr) { nxl = 1; nyl = 0; push = pr + r; }
      else if (m === pt) { nxl = 0; nyl = -1; push = pt + r; } else { nxl = 0; nyl = 1; push = pb + r; }
    } else { nxl = ex / ed; nyl = ey / ed; push = r - ed; }
    const [wx, wy] = toWorld(ox, oy, p.pa, lx + nxl * push, ly + nyl * push);
    f.x = wx; f.y = wy;
    const nwx = nxl * c - nyl * s, nwy = nxl * s + nyl * c;
    const vn = rvx * nwx + rvy * nwy;
    if (rsp > C.CRASHV) { killUnit(f, -1, 'crash'); return; }
    if (vn < 0) { rvx -= 1.4 * vn * nwx; rvy -= 1.4 * vn * nwy; f.vx = rvx + pvx; f.vy = rvy + pvy; }
    if (-vn > 25) { hullDamage(f, -vn * 0.25, -1); sfx('collide', f.x, f.y, 0.7, 0.3); }
    return;
  }
}

function arrived(f, p, viaPort) {
  const T = G.teams[f.team];
  if (!viaPort && p.owner !== f.team) {
    if (p.owner >= 0 && !foe(p.owner, f.team)) tell(f.team, `${p.name} es de tu aliado: podés repararte si tiene base.`, '', 'ally');
    else if (planetEmpty(p)) {
      const prev = p.owner;
      p.owner = f.team; p.flagA = f.la;
      tell(f.team, `¡${p.name} reclamado! Los cargueros vendrán a construir.`, 'good'); tsfx(f.team, 'install');
      if (prev >= 0 && G.teams[prev].human) tell(prev, `${cap(elTeam(T))} te quitó ${p.name}.`, 'warn');
    } else tell(f.team, `${p.name} tiene instalaciones enemigas: destruilas para reclamarlo.`, 'warn', 'occ');
  }
  if (p.owner === f.team) {
    const site = viaPort ? p.s.dock : p.s.lab;
    if (site && T.site !== site) { T.site = site; tell(f.team, `Los nuevos cazas se construirán en ${p.name}${viaPort ? ' (Dique Espacial)' : ''}.`); }
    tryInstall(f, p, viaPort);
  }
}

function tryInstall(f, p, viaPort) {
  const T = G.teams[f.team];
  if (p.owner !== f.team || !p.s.lab || !(viaPort ? p.s.port : p.s.base) || T.dev <= f.upg) return;
  f.upg = T.dev;
  const st = fstats(f.upg);
  f.maxHp = st.maxHp; f.ammo = st.maxAmmo; f.sh = st.maxSh;
  tell(f.team, `Mejora instalada: ${UPG[f.upg - 1].n}.`, 'good'); tsfx(f.team, 'install');
}

/* ---------- disparos ---------- */
function addShot(team, x, y, vx, vy, life, dmg, k) {
  const s = { id: G.sid = (G.sid || 0) + 1, x, y, px: x, py: y, vx, vy, life, team, dmg, k, tg: 0 };
  G.shots.push(s);
  return s;
}

function hitTest(u, x, y) {
  const t = u.type;
  if (t === 'fighter') { const dx = x - u.x, dy = y - u.y; return dx * dx + dy * dy < 169; }
  if (t === 'freighter') { const [lx, ly] = toLocal(u.x, u.y, u.a, x, y); return lx > -46 && lx < 46 && ly > -13 && ly < 13; }
  const p = G.planets[u.pl], r = HR[t];
  let lx, ly;
  if (UT[t].orb) { const [ox, oy] = portPos(p); [lx, ly] = toLocal(ox, oy, p.pa, x, y); }
  else { lx = x - p.x; ly = y - p.y; }
  return lx > r[0] - 3 && lx < r[2] + 3 && ly > r[1] - 3 && ly < r[3] + 3;
}

function updShots(dt) {
  const out = [];
  for (const s of G.shots) {
    s.life -= dt;
    if (s.life <= 0) continue;
    if (s.k === 2) {
      let t = s.tg ? U.get(s.tg) : null;
      if (!t) s.tg = 0;
      const sp = Math.min(560, hyp(s.vx, s.vy) + 320 * dt);
      let a = Math.atan2(s.vy, s.vx);
      if (t) a += clamp(angDiff(Math.atan2(t.y - s.y, t.x - s.x), a), -2.4 * dt, 2.4 * dt);
      s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
      if (Math.random() < 0.6) addFx(s.x, s.y, -s.vx * 0.05 + rnd(-12, 12), -s.vy * 0.05 + rnd(-12, 12), 0.45, '#9a9a9a', 1.2);
    }
    s.px = s.x; s.py = s.y;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (!shotCollide(s)) out.push(s);
  }
  G.shots = out;
}

function shotCollide(s) {
  for (const st of G.stars) { const dx = s.x - st.x, dy = s.y - st.y; if (dx * dx + dy * dy < st.r * st.r) return true; }
  const mx = (s.x + s.px) / 2, my = (s.y + s.py) / 2;
  for (const u of G.units) {
    if (!foe(u.team, s.team)) continue;
    const dx = u.x - s.x, dy = u.y - s.y;
    if (dx > 90 || dx < -90 || dy > 90 || dy < -90) continue;
    if (hitTest(u, s.x, s.y) || hitTest(u, mx, my)) {
      sparks(s.x, s.y, s.k ? 16 : 5, s.k ? '#ffffff' : TEAMS[s.team].color);
      if (s.k) sfx('collide', s.x, s.y, 0.6, 0.1); else sfx('hit', s.x, s.y, 0.4, 0.08);
      damage(u, s.dmg, s.team);
      return true;
    }
  }
  return false;
}

/* ---------- torretas (bases, puertos y cargueros) ---------- */
function turrets(u, dt) {
  let pts, range, dmg;
  if (u.type === 'freighter') { pts = FR_TURRETS.map(([lx, ly]) => toWorld(u.x, u.y, u.a, lx, ly)); range = C.FTUR_RANGE; dmg = C.FTUR_DMG; }
  else if (u.type === 'base') { const p = G.planets[u.pl]; pts = BASE_TURRETS.map(([lx, ly]) => [p.x + lx, p.y + ly]); range = C.TUR_RANGE; dmg = C.TUR_DMG; }
  else { const p = G.planets[u.pl], [ox, oy] = portPos(p); pts = PORT_TURRETS.map(([lx, ly]) => toWorld(ox, oy, p.pa, lx, ly)); range = C.TUR_RANGE; dmg = C.TUR_DMG; }
  let cands = null;
  for (let i = 0; i < pts.length; i++) {
    u.tcd[i] -= dt;
    if (u.tcd[i] > 0) continue;
    if (!cands) {
      cands = [];
      for (const t of G.units) if (foe(t.team, u.team) && UT[t.type].ship && hyp(t.x - u.x, t.y - u.y) < range + 120) cands.push(t);
    }
    let best = null, bd = range;
    for (const t of cands) { const d = hyp(t.x - pts[i][0], t.y - pts[i][1]); if (d < bd) { bd = d; best = t; } }
    if (!best) { u.tcd[i] = 0.3; continue; }
    const tt = bd / C.TUR_SPD;
    const a = Math.atan2(best.y + best.vy * tt - pts[i][1], best.x + best.vx * tt - pts[i][0]) + rnd(-0.07, 0.07);
    addShot(u.team, pts[i][0], pts[i][1], Math.cos(a) * C.TUR_SPD + (u.vx || 0), Math.sin(a) * C.TUR_SPD + (u.vy || 0), range / C.TUR_SPD + 0.1, dmg, 0).tur = 1;
    u.tcd[i] = (u.type === 'freighter' ? 1.3 : 1.1) + rnd(0, 0.6);
    sfx('fire', pts[i][0], pts[i][1], 0.16, 0.15);
  }
}

/* ---------- cargueros ---------- */
function updFreighter(fr, dt) {
  if (fr.st === 'o') {
    const p = G.planets[fr.opl];
    fr.oa += C.FR_W * dt;
    fr.x = p.x + Math.cos(fr.oa) * C.FR_ORBIT; fr.y = p.y + Math.sin(fr.oa) * C.FR_ORBIT;
    fr.vx = -Math.sin(fr.oa) * C.FR_ORBIT * C.FR_W; fr.vy = Math.cos(fr.oa) * C.FR_ORBIT * C.FR_W;
    fr.a = angLerp(fr.a, fr.oa + Math.PI / 2, dt * 2);
    fr.thr = false;
    fr.jt -= dt;
    if (fr.jt <= 0) { fr.jt = 0.5; freighterWork(fr, p, 0.5); }
    return;
  }
  if (!fr.job) { chooseJob(fr); if (!fr.job) return; }
  const p = G.planets[fr.job.pl];
  const ang = Math.atan2(fr.y - p.y, fr.x - p.x);
  const tx = p.x + Math.cos(ang) * C.FR_ORBIT, ty = p.y + Math.sin(ang) * C.FR_ORBIT;
  const [wx, wy] = detour(fr.x, fr.y, tx, ty, p.id, 300, 170);
  const dx = wx - fr.x, dy = wy - fr.y, d = hyp(dx, dy) || 1;
  const dT = hyp(tx - fr.x, ty - fr.y);
  const acc = 45, sp = Math.min(150, Math.sqrt(2 * acc * 0.8 * dT) + 5);
  let dvx = dx / d * sp - fr.vx, dvy = dy / d * sp - fr.vy;
  const dm = hyp(dvx, dvy), lim = acc * dt;
  if (dm > lim) { dvx *= lim / dm; dvy *= lim / dm; }
  fr.vx += dvx; fr.vy += dvy;
  fr.x += fr.vx * dt; fr.y += fr.vy * dt;
  const vs = hyp(fr.vx, fr.vy);
  if (vs > 5) fr.a = angLerp(fr.a, Math.atan2(fr.vy, fr.vx), dt * 2.5);
  fr.thr = dm > lim * 0.5;
  if (dT < 40 && vs < 60) { fr.st = 'o'; fr.opl = p.id; fr.oa = Math.atan2(fr.y - p.y, fr.x - p.x); fr.jt = 0; }
}

const ART = { base: 'una Base', colony: 'una Colonia', port: 'un Puerto Orbital' };

function freighterWork(fr, p, dt) {
  const T = G.teams[fr.team];
  if (p.owner === fr.team && fr.hp < fr.maxHp) {
    const host = U.get(p.s.port) || U.get(p.s.base);
    if (host && host.team === fr.team && host.mat > 5) { const a = Math.min(4 * dt, fr.maxHp - fr.hp); fr.hp += a; host.mat -= a * 0.25; }
  }
  const job = fr.job;
  if (!job || job.pl !== p.id) { chooseJob(fr); return; }
  if (job.k === 'load') {
    const col = U.get(p.s.colony);
    if (!col || col.team !== fr.team) { chooseJob(fr); return; }
    const a = Math.min(7 * dt, col.mat, 100 - fr.cargo);
    col.mat -= a; fr.cargo += a;
    if (fr.cargo >= 99.9) { fr.cargo = 100; fr.wait = 0; chooseJob(fr); }
    else if (col.mat < 1) { fr.wait = (fr.wait || 0) + dt; if (fr.wait > 8) { fr.wait = 0; chooseJob(fr); } }
  } else if (job.k === 'build') {
    if (p.owner !== fr.team || p.s[job.w] || fr.cargo < 100) { chooseJob(fr); return; }
    const u = spawnInstallation(p, job.w, 0.4, job.w === 'colony' ? 10 : 0);
    tell(T.id, `Un carguero construyó ${ART[job.w]} en ${p.name}.`, 'good'); tsfx(T.id, 'install', u.x, u.y);
    removeUnit(fr);
  } else if (job.k === 'supply') {
    const host = U.get(p.s[job.w]);
    if (!host || host.team !== fr.team || host.mat >= 99 || fr.cargo <= 0.5) { chooseJob(fr); return; }
    const a = Math.min(10 * dt, fr.cargo, 100 - host.mat);
    fr.cargo -= a; host.mat += a;
  } else {
    fr.wait = (fr.wait || 0) + dt;
    if (fr.wait >= 2) { fr.wait = 0; chooseJob(fr); }
  }
}

function chooseJob(fr) {
  const team = fr.team;
  const cols = G.units.filter(u => u.team === team && u.type === 'colony');
  const taken = (k, pl, w) => G.units.some(o => o !== fr && o.type === 'freighter' && o.team === team && o.job && o.job.k === k && o.job.pl === pl && (w === undefined || o.job.w === w));
  const dist = p => hyp(p.x - fr.x, p.y - fr.y);
  let job = null, pendingBuild = false;
  let bd = 1e18;
  for (const p of G.planets) {
    if (p.owner !== team) continue;
    const w = nextBuild(p, cols.length === 0);
    if (!w || taken('build', p.id, w)) continue;
    pendingBuild = true;
    if (fr.cargo >= 100) { const d = dist(p); if (d < bd) { bd = d; job = { k: 'build', pl: p.id, w }; } }
  }
  if (!job && pendingBuild && fr.cargo < 100 && cols.length) job = bestLoad(fr, cols, taken, dist);
  if (!job && fr.cargo > 1) {
    bd = 1e18;
    for (const p of G.planets) {
      if (p.owner !== team) continue;
      for (const w of ['base', 'port']) {
        const h = U.get(p.s[w]); if (!h) continue;
        const need = p.s.colony ? (w === 'port' && h.mat < 40) : h.mat < 70;
        if (!need || taken('supply', p.id, w)) continue;
        const d = dist(p) + h.mat * 30;
        if (d < bd) { bd = d; job = { k: 'supply', pl: p.id, w }; }
      }
    }
  }
  if (!job && fr.cargo < 100 && cols.length) job = bestLoad(fr, cols, taken, dist);
  if (!job) {
    bd = 1e18;
    let best = null;
    for (const p of G.planets) { if (p.owner !== team) continue; const d = dist(p) - (p.s.colony ? 2000 : 0); if (d < bd) { bd = d; best = p; } }
    if (best) job = { k: 'idle', pl: best.id };
  }
  fr.job = job;
  if (job && !(fr.st === 'o' && fr.opl === job.pl)) fr.st = 't';
}

function bestLoad(fr, cols, taken, dist) {
  let bs = -1e18, job = null;
  for (const c of cols) {
    const p = G.planets[c.pl];
    const s = c.mat * 40 - dist(p) - (taken('load', p.id) ? 3000 : 0);
    if (s > bs) { bs = s; job = { k: 'load', pl: p.id }; }
  }
  return job;
}

function detour(x, y, tx, ty, ignorePl, sm, pm) {
  const dx = tx - x, dy = ty - y, L2 = dx * dx + dy * dy;
  if (L2 < 1) return [tx, ty];
  let bestT = 2, wp = null;
  const check = (cx, cy, R) => {
    const t = clamp(((cx - x) * dx + (cy - y) * dy) / L2, 0, 1);
    const px = x + dx * t, py = y + dy * t, d = hyp(px - cx, py - cy);
    if (d >= R || t >= bestT) return;
    if (hyp(x - cx, y - cy) < R * 0.8) return;
    let ox = px - cx, oy = py - cy, od = hyp(ox, oy);
    if (od < 1) { ox = -dy; oy = dx; od = Math.sqrt(L2); }
    bestT = t; wp = [cx + ox / od * (R + 80), cy + oy / od * (R + 80)];
  };
  for (const s of G.stars) check(s.x, s.y, s.r + sm);
  for (const p of G.planets) if (p.id !== ignorePl) check(p.x, p.y, p.r + pm);
  return wp || [tx, ty];
}

/* ---------- IA de los cazas ---------- */
function aiFighter(f, dt) {
  const ai = f.ai, T = G.teams[f.team], P = PERS[T.pers], c = f.ctl;
  c.turn = 0; c.thrust = false; c.fire = false; c.mis = false;
  ai.t -= dt; ai.errT -= dt;
  if (ai.errT <= 0) { ai.errT = rnd(0.4, 1.0); ai.err = (Math.random() * 2 - 1) * (1 - G.skill) * 0.22; }
  if (ai.t <= 0) { ai.t = rnd(0.4, 0.7); aiDecide(f, T, P); }
  const st = fstats(f.upg);
  if (f.st !== 'f') { if (ai.goal !== 'rest') c.thrust = true; return; }
  if (aiSafety(f, st, c)) { aiOpportunistic(f, c); return; }
  if (ai.goal === 'land' || ai.goal === 'claim') { const p = G.planets[ai.tpl]; if (p) { aiLand(f, p, st, c); aiOpportunistic(f, c); return; } }
  if (ai.goal === 'attack') { const t = U.get(ai.tid); if (t) { aiAttack(f, t, st, c); return; } ai.t = 0; }
  aiPatrol(f, st, c);
  aiOpportunistic(f, c);
}

function aiDecide(f, T, P) {
  const ai = f.ai, st = fstats(f.upg), hpF = f.hp / st.maxHp;
  if (f.st !== 'f') {
    let host = null;
    if (f.st === 'l') { const p = G.planets[f.pl]; if (p.owner === f.team && p.s.base) host = U.get(p.s.base); }
    else host = U.get(f.pt);
    const needs = f.hp < st.maxHp * 0.97 || f.sh < st.maxSh * 0.9 || f.ammo < st.maxAmmo;
    if (host && host.team === f.team && host.mat > 3 && needs && G.t - f.landT < 40) { ai.goal = 'rest'; return; }
  }
  const needUpg = T.dev > f.upg;
  if (f.st === 'f' && (hpF < P.retreat || needUpg)) {
    let best = null, bd = 1e18;
    for (const p of G.planets) {
      if (p.owner !== f.team || !p.s.base) continue;
      if (hpF >= P.retreat && !p.s.lab) continue;
      const b = U.get(p.s.base); if (!b || b.mat < 5) continue;
      const d = hyp(p.x - f.x, p.y - f.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && (hpF < P.retreat || bd < 4500)) { ai.goal = 'land'; ai.tpl = best.id; ai.tid = 0; return; }
  }
  let bestS = 0.2, goal = 'patrol', tid = 0, tpl = -1;
  for (const p of G.planets) {
    if (p.owner === f.team || (p.owner >= 0 && !foe(p.owner, f.team)) || !planetEmpty(p)) continue;
    const d = hyp(p.x - f.x, p.y - f.y);
    let s = P.expand * 3000 / (d + 700);
    if (p.owner >= 0) s *= 1.15;
    if (ai.goal === 'claim' && ai.tpl === p.id) s *= P.keep;
    if (s > bestS) { bestS = s; goal = 'claim'; tpl = p.id; tid = 0; }
  }
  for (const u of G.units) {
    if (!foe(u.team, f.team)) continue;
    const d = hyp(u.x - f.x, u.y - f.y);
    let s = 0;
    if (u.type === 'fighter') {
      if (d < 1100) s = P.attack * 2.0 * 1300 / (d + 300);
      if (G.teams[u.team].human) s *= P.n === 'Maníaco' ? 1.5 : 1.1;
    } else if (u.type === 'freighter') s = P.hunt * 2400 / (d + 700);
    else {
      const w = { base: 0.9, colony: 1.25, port: 0.85, lab: 0.75, comm: 0.6, dock: 0.7, sensor: 0.55 }[u.type];
      s = P.attack * w * 1700 / (d + 1100);
      if (!G.teams[u.team].alive) s *= 0.6;
    }
    if (UT[u.type].ship) {
      for (const p of G.planets) {
        if (p.owner !== f.team || planetEmpty(p)) continue;
        if (hyp(u.x - p.x, u.y - p.y) < 900) { s += P.defend * 2600 / (d + 600); break; }
      }
    }
    if (ai.goal === 'attack' && ai.tid === u.id) s *= P.keep;
    if (s > bestS) { bestS = s; goal = 'attack'; tid = u.id; tpl = -1; }
  }
  ai.goal = goal; ai.tid = tid; ai.tpl = tpl;
}

function accelControl(f, ax, ay, c) {
  const st = fstats(f.upg), mag = hyp(ax, ay);
  if (mag < 4) return;
  const diff = angDiff(Math.atan2(ay, ax), f.a);
  c.turn = clamp(diff * 4, -1, 1);
  if (Math.abs(diff) < 0.5) c.thrust = mag >= st.thrust || Math.random() < mag / st.thrust;
}

function steerTo(f, tx, ty, arrive, tvx, tvy, st, c, ignorePl) {
  const [wx, wy] = detour(f.x, f.y, tx, ty, ignorePl, 380, 140);
  const dx = wx - f.x, dy = wy - f.y, d = hyp(dx, dy) || 1;
  const dT = hyp(tx - f.x, ty - f.y);
  const sp = Math.min(st.maxSpd * 0.85, Math.sqrt(2 * st.thrust * 0.4 * dT) + arrive);
  const [gx, gy] = gravityAt(f.x, f.y);
  accelControl(f, (tvx + dx / d * sp - f.vx) * 1.3 - gx, (tvy + dy / d * sp - f.vy) * 1.3 - gy, c);
}

function aiSafety(f, st, c) {
  const [gx, gy] = gravityAt(f.x, f.y);
  for (const s of G.stars) {
    const dx = f.x - s.x, dy = f.y - s.y, d = hyp(dx, dy);
    if (d < s.r + 420) {
      const vr = (f.vx * dx + f.vy * dy) / d;
      if (vr < 60 || d < s.r + 250) { accelControl(f, dx / d * 140 - gx, dy / d * 140 - gy, c); return true; }
    }
  }
  // puertos orbitales: la IA nunca se acopla, así que los esquiva
  for (const p of G.planets) {
    if (!p.s.port) continue;
    const [ox, oy] = portPos(p);
    const dx = f.x - ox, dy = f.y - oy, d = hyp(dx, dy);
    if (d > 190) continue;
    const pvx = -(oy - p.y) * C.PORT_W, pvy = (ox - p.x) * C.PORT_W;
    const closing = -((f.vx - pvx) * dx + (f.vy - pvy) * dy) / d;
    if (d < 80 || closing * 2 > d - 70) {
      accelControl(f, (pvx + dx / d * 90 - f.vx) * 1.5 - gx, (pvy + dy / d * 90 - f.vy) * 1.5 - gy, c);
      return true;
    }
  }
  const landing = (f.ai.goal === 'land' || f.ai.goal === 'claim') ? f.ai.tpl : -1;
  for (const p of G.planets) {
    if (p.id === landing) continue;
    const dx = f.x - p.x, dy = f.y - p.y, d = hyp(dx, dy), alt = d - p.r - C.F_TAIL;
    if (alt > 650) continue;
    const vr = (f.vx * dx + f.vy * dy) / d;
    if ((alt < 70 && vr < 10) || (vr < 0 && -vr * 2.4 > alt - 20)) {
      const want = 60 - vr;
      accelControl(f, dx / d * want * 1.5 - gx, dy / d * want * 1.5 - gy, c);
      return true;
    }
  }
  return false;
}

function aiLand(f, p, st, c) {
  const dx = f.x - p.x, dy = f.y - p.y, d = hyp(dx, dy);
  let nx = dx / d, ny = dy / d;
  const alt = d - p.r - C.F_TAIL;
  if (alt > 320) {
    // punto de aproximación del lado propio, lejos del puerto orbital
    let a = Math.atan2(ny, nx);
    if (p.s.port) { const off = angDiff(a, p.pa); if (Math.abs(off) < 0.9) a = p.pa + (off >= 0 ? 0.9 : -0.9); }
    steerTo(f, p.x + Math.cos(a) * (p.r + 170), p.y + Math.sin(a) * (p.r + 170), 20, 0, 0, st, c, p.id);
    return;
  }
  const desc = clamp(alt * 0.35, 14, 110);
  const [gx, gy] = gravityAt(f.x, f.y);
  accelControl(f, (-nx * desc - f.vx) * 1.8 - gx, (-ny * desc - f.vy) * 1.8 - gy, c);
}

function aiAttack(f, t, st, c) {
  const dx = t.x - f.x, dy = t.y - f.y, d = hyp(dx, dy) || 1;
  const tvx = t.vx || 0, tvy = t.vy || 0, tt = d / C.GUN_SPD;
  const aimA = Math.atan2(t.y + (tvy - f.vy) * tt - f.y, t.x + (tvx - f.vx) * tt - f.x) + f.ai.err;
  const ship = !!UT[t.type].ship, engage = ship ? 360 : 300;
  const rvx = f.vx - tvx, rvy = f.vy - tvy, rsp = hyp(rvx, rvy);
  const ign = t.pl !== undefined ? t.pl : -1;
  if (d > engage + 160) {
    const k = (d - engage) / d;
    steerTo(f, f.x + dx * k, f.y + dy * k, 0, tvx, tvy, st, c, ign);
  } else if (d < 110) {
    const [gx, gy] = gravityAt(f.x, f.y);
    accelControl(f, -dx / d * 120 - gx, -dy / d * 120 - gy, c);
  } else if (rsp > 130) {
    const [gx, gy] = gravityAt(f.x, f.y);
    accelControl(f, -rvx * 1.5 - gx, -rvy * 1.5 - gy, c);
  } else {
    const diff = angDiff(aimA, f.a);
    c.turn = clamp(diff * 5, -1, 1);
    if (Math.abs(diff) < 0.3 && d > engage) c.thrust = Math.random() < 0.3;
  }
  const off = Math.abs(angDiff(aimA, f.a));
  if (d < 560 && off < 0.08 + (1 - G.skill) * 0.1) c.fire = true;
  if (f.ammo > 0 && st.ammoT && d < (st.ammoT === 2 ? 800 : 500) && off < (st.ammoT === 2 ? 0.5 : 0.08) && (ship || t.type === 'base' || t.type === 'port') && Math.random() < 0.012) c.mis = true;
}

function aiOpportunistic(f, c) {
  for (const u of G.units) {
    if (!foe(u.team, f.team)) continue;
    const dx = u.x - f.x, dy = u.y - f.y;
    if (dx > 480 || dx < -480 || dy > 480 || dy < -480) continue;
    const d = hyp(dx, dy);
    if (d < 480 && Math.abs(angDiff(Math.atan2(dy, dx), f.a)) < 0.07) { c.fire = true; return; }
  }
}

function aiPatrol(f, st, c) {
  let best = null, bd = 1e18;
  for (const p of G.planets) { if (p.owner !== f.team) continue; const d = hyp(p.x - f.x, p.y - f.y); if (d < bd) { bd = d; best = p; } }
  if (!best) { const [gx, gy] = gravityAt(f.x, f.y); accelControl(f, -f.vx - gx, -f.vy - gy, c); return; }
  const a = Math.atan2(f.y - best.y, f.x - best.x);
  steerTo(f, best.x + Math.cos(a) * 420, best.y + Math.sin(a) * 420, 0, 0, 0, st, c, best.id);
}

/* ---------- partículas ---------- */
function addFx(x, y, vx, vy, life, color, size) { if (FX.length < 800) FX.push({ x, y, vx, vy, life, max: life, color, size }); }
function explode(x, y, n, color) {
  if (HOOK.fx) HOOK.fx('x', x, y, n, color);
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU), s = rnd(15, 40 + n * 3);
    addFx(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.5, 1.5), Math.random() < 0.45 ? color : (Math.random() < 0.5 ? '#ffffff' : COL.fire), rnd(1.2, 2.6));
  }
  FX.push({ ring: 1, x, y, life: 0.7, max: 0.7, r: n * 2.4, color });
}
function sparks(x, y, n, color) { if (HOOK.fx) HOOK.fx('p', x, y, n, color); for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(20, 110); addFx(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.15, 0.4), color, 1.2); } }
function updFx(dt) {
  for (const p of FX) { p.life -= dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; } }
  FX = FX.filter(p => p.life > 0);
}
