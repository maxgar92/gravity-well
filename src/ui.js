/* ===================== Interfaz ===================== */
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } },
};
const SET = Object.assign({ sound: true, size: 1, vib: true, name: '' }, store.get('gw-settings', {}));
const SCORE = Object.assign({ won: 0, lost: 0 }, store.get('gw-score', {}));
const SIZE_NAMES = ['Chico', 'Normal', 'Grande'];
let mode = 'title';
let paused = false;
let saveTimer = 0, hudTimer = 0, slowTimer = 0, proxNear = false;

/* ---------- sonido (WAV originales, decodificados a mano para que anden en cualquier navegador) ---------- */
const SFX = { ctx: null, bufs: {}, last: {}, gain: null };
function wavToBuffer(ac, b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dv = new DataView(u8.buffer);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= u8.length) {
    const id = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]), sz = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') fmt = { ch: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
    else if (id === 'data') data = { off: pos + 8, len: Math.min(sz, u8.length - pos - 8) };
    pos += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) return null;
  const bps = fmt.bits / 8, n = Math.floor(data.len / bps / fmt.ch), src = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = data.off + i * bps * fmt.ch;
    src[i] = fmt.bits === 8 ? (u8[o] - 128) / 128 : dv.getInt16(o, true) / 32768;
  }
  const rate = 22050, m = Math.max(1, Math.floor(n * rate / fmt.rate)), out = ac.createBuffer(1, m, rate), dst = out.getChannelData(0);
  for (let i = 0; i < m; i++) { const t = i * fmt.rate / rate, j = Math.floor(t), f = t - j; dst[i] = (src[j] || 0) * (1 - f) + (src[j + 1] || 0) * f; }
  return out;
}
function audioInit() {
  if (SFX.ctx) { if (SFX.ctx.state === 'suspended') SFX.ctx.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    SFX.ctx = new AC();
    SFX.gain = SFX.ctx.createGain(); SFX.gain.gain.value = 0.7; SFX.gain.connect(SFX.ctx.destination);
    for (const [k, b64] of Object.entries(ASSETS.sounds)) SFX.bufs[k] = wavToBuffer(SFX.ctx, b64);
    if (SFX.ctx.state === 'suspended') SFX.ctx.resume().catch(() => {});
  } catch (e) { SFX.ctx = null; }
}
function sfx(name, x, y, vol, gap, team) {
  if (NET.role === 'host' && x != null && G && !G.demo && G.online) netSound(name, x, y, vol, team);
  if (!SET.sound || !SFX.ctx || !G || G.demo || paused || !SFX.bufs[name]) return;
  const now = SFX.ctx.currentTime;
  if (SFX.last[name] && now - SFX.last[name] < (gap || 0.06)) return;
  let v = vol == null ? 1 : vol;
  if (x != null) {
    const d = hyp(x - V.x, y - V.y), r = Math.max(V.w, V.h) / V.zoom * 0.6;
    if (d > r * 1.6) return;
    if (d > r) v *= 1 - (d - r) / (r * 0.6);
  }
  if (v <= 0.02) return;
  SFX.last[name] = now;
  try {
    const src = SFX.ctx.createBufferSource(), g = SFX.ctx.createGain();
    src.buffer = SFX.bufs[name]; g.gain.value = v;
    src.connect(g); g.connect(SFX.gain); src.start();
  } catch (e) { /* ignorar */ }
}
function vibrate(p) { if (SET.vib && G && !G.demo && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* no soportado */ } } }

/* ---------- mensajes por equipo (locales o enviados al teléfono de ese jugador) ---------- */
function isRemoteTeam(team) { return NET.role === 'host' && G && G.teams[team] && G.teams[team].ctl === 'remote'; }
function tell(team, msg, kind, key) {
  if (!G || G.demo || team == null || team < 0) return;
  if (team === ME) toast(msg, kind, key);
  else if (isRemoteTeam(team)) netTeamEvent(team, ['m', msg, kind || '', key || '']);
}
function tsfx(team, name, x, y, vol, gap) {
  if (!G || G.demo || team == null || team < 0) return;
  if (team === ME) sfx(name, x, y, vol, gap);
  else if (isRemoteTeam(team)) netTeamEvent(team, ['S', name, vol == null ? 1 : vol]);
}
function tvib(team, p) {
  if (team === ME) vibrate(p);
  else if (isRemoteTeam(team)) netTeamEvent(team, ['v', p]);
}
function onFighterLost(team) { if (team === ME) V.target = 0; }
function onFighterSpawn(team, f) { if (team === ME) V.target = f.id; }

/* ---------- mensajes ---------- */
const toastKeys = {};
function toast(msg, kind, key) {
  if (!G || G.demo) return;
  if (key) { if (toastKeys[key] && G.t - toastKeys[key] < 5) return; toastKeys[key] = G.t; }
  const box = $('toasts'), el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), kind === 'big' ? 6500 : 4300);
  setTimeout(() => el.remove(), kind === 'big' ? 7100 : 4900);
}

let lastStatus = '';
function updStatus() {
  const el = $('status');
  let txt = '', cls = '';
  if (G && !G.demo && mode === 'play') {
    const T = G.teams[ME], f = fighterOf(ME);
    if (!T.alive) { txt = 'Te eliminaron: estás mirando la partida'; cls = 'warn'; }
    else if (!f) {
      const site = U.get(T.buildSite);
      if (site) {
        const h = hostOf(site);
        txt = h && h.mat >= 50 ? `Construyendo caza en ${G.planets[site.pl].name}… ${Math.max(1, Math.ceil(5 - T.fBuild))} s` : `Sin caza: faltan materiales en ${G.planets[site.pl].name}`;
      } else txt = 'Sin caza: no te quedan laboratorios ni diques espaciales';
      cls = 'warn';
    } else if (f.st === 'l' || f.st === 'd') {
      const p = f.st === 'l' ? G.planets[f.pl] : G.planets[(U.get(f.pt) || {}).pl];
      txt = (f.st === 'l' ? 'Aterrizado en ' : 'Acoplado en ') + (p ? p.name : '') + (f.servicing ? ' · reparando' : '');
      if (labFlash(T) && p && !(p.owner === ME && p.s.lab)) txt += ' · la mejora necesita laboratorio';
      cls = 'ok';
    } else if (labFlash(T)) {
      txt = `Mejora lista: ${UPG[T.dev - 1].n} · aterrizá donde tengas laboratorio`; cls = 'dev';
    } else {
      const p = nearest(f, G.planets);
      if (p) {
        const dx = f.x - p.x, dy = f.y - p.y, d = hyp(dx, dy), alt = d - p.r;
        const vr = (f.vx * dx + f.vy * dy) / d, spd = hyp(f.vx, f.vy);
        if (alt < 260 && vr < 5) {
          if (spd <= C.LANDV) { txt = `Velocidad de aterrizaje correcta`; cls = 'ok'; }
          else { txt = `Muy rápido para aterrizar (${Math.round(spd)} / ${C.LANDV})`; cls = 'warn'; }
        }
      }
    }
  }
  const key = txt + cls;
  if (key === lastStatus) return;
  lastStatus = key;
  el.textContent = txt; el.className = cls; el.hidden = !txt;
}

/* ---------- entrada: teclado y toques ---------- */
const INPUT = { left: false, right: false, thrust: false, fire: false, mis: false };
const KEYS = {};
const PTRS = new Map();
let BTNS = [];
let pinch = null;

function playerControl(f) {
  const c = f.ctl;
  c.turn = (INPUT.right ? 1 : 0) - (INPUT.left ? 1 : 0);
  c.thrust = INPUT.thrust; c.fire = INPUT.fire; c.mis = INPUT.mis;
}

function ctlHits(p) {
  const hits = [];
  let nearestB = null, nd = 1e9;
  for (const b of BTNS) {
    if (b.cluster !== p.cluster) continue;
    const r = b.el.getBoundingClientRect();
    const dx = Math.max(r.left - p.x, 0, p.x - r.right), dy = Math.max(r.top - p.y, 0, p.y - r.bottom), d = hyp(dx, dy);
    if (d === 0 || (p.cluster === 'R' && d < 12)) hits.push(b.ctl);
    if (d < nd) { nd = d; nearestB = b.ctl; }
  }
  if (!hits.length && nd < 40) hits.push(nearestB);
  return hits;
}

function recomputeInput() {
  const s = { left: false, right: false, thrust: false, fire: false, mis: false };
  for (const p of PTRS.values()) if (p.kind === 'ctl') for (const h of ctlHits(p)) s[h] = true;
  const K = KEYS;
  INPUT.left = s.left || !!(K.ArrowLeft || K.KeyA);
  INPUT.right = s.right || !!(K.ArrowRight || K.KeyD);
  INPUT.thrust = s.thrust || !!(K.ArrowUp || K.KeyW);
  INPUT.fire = s.fire || !!(K.Space || K.ArrowDown || K.KeyS);
  INPUT.mis = s.mis || !!(K.KeyX || K.ControlLeft || K.ControlRight || K.ShiftLeft || K.KeyM);
  for (const b of BTNS) b.el.classList.toggle('on', INPUT[b.ctl]);
}

function screenToWorld(x, y) { return [V.x + (x - V.w / 2) / V.zoom, V.y + (y - V.h / 2) / V.zoom]; }

function tapView(x, y) {
  if (!G || G.demo) return;
  const [wx, wy] = screenToWorld(x, y);
  let best = null, bd = 44 / V.zoom;
  for (const u of G.units) {
    if (u.team !== ME) continue;
    const d = hyp(u.x - wx, u.y - wy);
    if (d < bd) { bd = d; best = u; }
  }
  if (best) { V.target = best.id; if (unitsOpen()) renderUnits(); }
}

function setZoom(z) { V.zoom = clamp(z, V.baseZoom * 0.18, V.baseZoom * 3); }

function bindInput() {
  BTNS = [...document.querySelectorAll('[data-ctl]')].map(el => ({ el, ctl: el.dataset.ctl, cluster: el.closest('#ctl-left') ? 'L' : 'R' }));
  const play = $('app');
  play.addEventListener('pointerdown', e => {
    audioInit();
    const box = e.target.closest('.ctl');
    if (box) {
      PTRS.set(e.pointerId, { kind: 'ctl', cluster: box.id === 'ctl-left' ? 'L' : 'R', x: e.clientX, y: e.clientY });
      try { if (e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
      recomputeInput(); e.preventDefault();
    } else if (e.target === cv) {
      PTRS.set(e.pointerId, { kind: 'view', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
      const views = [...PTRS.values()].filter(p => p.kind === 'view');
      if (views.length === 2) { pinch = { d: hyp(views[0].x - views[1].x, views[0].y - views[1].y) || 1, z: V.zoom }; views.forEach(v => { v.moved = true; }); }
    }
  });
  window.addEventListener('pointermove', e => {
    const p = PTRS.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.kind === 'ctl') { recomputeInput(); return; }
    if (hyp(p.x - p.sx, p.y - p.sy) > 10) p.moved = true;
    const views = [...PTRS.values()].filter(q => q.kind === 'view');
    if (views.length === 2 && pinch) setZoom(pinch.z * (hyp(views[0].x - views[1].x, views[0].y - views[1].y) || 1) / pinch.d);
  });
  const up = e => {
    const p = PTRS.get(e.pointerId);
    if (!p) return;
    PTRS.delete(e.pointerId);
    if (p.kind === 'ctl') { recomputeInput(); return; }
    if (![...PTRS.values()].some(q => q.kind === 'view')) pinch = null;
    if (e.type === 'pointerup' && !p.moved && performance.now() - p.t < 400) tapView(p.x, p.y);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('blur', () => { PTRS.clear(); for (const k in KEYS) KEYS[k] = false; recomputeInput(); });
  cv.addEventListener('wheel', e => { e.preventDefault(); setZoom(V.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') { if (mode === 'play' && !G.over) pause(!paused); return; }
    if (mode !== 'play' || paused) return;
    KEYS[e.code] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Equal' || e.code === 'NumpadAdd') setZoom(V.zoom * 1.25);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') setZoom(V.zoom / 1.25);
    if (e.code === 'Digit0' || e.code === 'Home') { setZoom(V.baseZoom); viewLeader(ME); }
    if (/^(Digit|F)[1-4]$/.test(e.code)) { e.preventDefault(); viewLeader(+e.code.slice(-1) - 1); }
    if (e.code === 'KeyP') pause(true);
    audioInit();
    recomputeInput();
  });
  window.addEventListener('keyup', e => { KEYS[e.code] = false; recomputeInput(); });

  // panel de estado: radar abre el mapa, cuadros de color muestran a cada líder
  $('hudc').addEventListener('click', e => {
    if (!G || G.demo) return;
    const r = $('hudc').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < HUD.size) { openMap(); return; }
    if (y >= HUD.rows.teams[0] - 3 && y <= HUD.rows.teams[1] + 3) { viewLeader(clamp(Math.floor(x / ((HUD.size - 6) / 4 + 2)), 0, 3)); return; }
    viewLeader(ME);
  });
}

function viewLeader(i) {
  const f = fighterOf(i);
  if (f) V.target = f.id;
  else if (i === ME) V.target = 0;
  else toast(`${cap(elTeam(G.teams[i]))} no tiene caza en este momento.`, '', 'nolead');
}

/* ---------- lista de unidades ---------- */
function unitsOpen() { return !$('units').hidden; }
function renderUnits() {
  const list = $('ulist');
  const own = G.units.filter(u => u.team === ME && u.type !== 'fighter').sort((a, b) => a.num - b.num);
  if (!own.length) { list.innerHTML = '<p class="empty">No te quedan unidades además del caza.</p>'; return; }
  let html = '';
  for (const u of own) {
    const where = u.type === 'freighter' ? freighterWhere(u) : G.planets[u.pl].name;
    const hpW = (u.maxHp / 180 * 100).toFixed(1), hpF = (u.hp / u.maxHp * 100).toFixed(1);
    let mat = '';
    if (u.type === 'base' || u.type === 'port') mat = `<i class="mbar fin" style="--f:${u.mat.toFixed(1)}%"></i>`;
    else if (u.type === 'colony') mat = `<i class="mbar raw" style="--f:${u.mat.toFixed(1)}%"></i>`;
    else if (u.type === 'freighter') mat = `<i class="mbar raw" style="--f:${u.cargo.toFixed(1)}%"></i>`;
    html += `<button class="unit${u.id === V.target ? ' sel' : ''}" data-id="${u.id}"><span class="un">${unitLabel(u)}</span><span class="uw">${where}</span><i class="hbar" style="--w:${hpW}%;--f:${hpF}%"></i>${mat}</button>`;
  }
  list.innerHTML = html;
}
function freighterWhere(fr) {
  const j = fr.job;
  if (!j) return 'sin tarea';
  const p = G.planets[j.pl].name;
  const verb = { load: 'cargar en', build: 'construir en', supply: 'abastecer', idle: 'espera en' }[j.k];
  return `${verb} ${p}`;
}

/* ---------- mapa grande ---------- */
function openMap() { $('map').hidden = false; drawMap(); }
function drawMap() {
  const c = $('mapc'), r = c.getBoundingClientRect(), d = V.dpr, s = Math.floor(Math.min(r.width, r.height));
  if (c.width !== s * d) { c.width = s * d; c.height = s * d; }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  drawRadar(g, 0, 0, s, true);
}

