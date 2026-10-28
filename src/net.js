/* ===================== Juego online (anfitrión + clientes con PeerJS) =====================
   El teléfono anfitrión corre la simulación completa. Cada cliente simula SOLO su propia nave
   (respuesta inmediata al tacto) y le reporta posición e intenciones; el anfitrión decide
   impactos, daño, reclamos y todo lo demás, y manda el estado ~12 veces por segundo. */

const PROTO = 1;
const PEER_PREFIX = 'gwell-mx92-';
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SNAP_HZ = 12, STATE_HZ = 20;
const ALLY_NAMES = { 10: 'Equipo A', 11: 'Equipo B' };

Object.assign(NET, {
  peer: null, code: '', phase: 'idle',  // idle | lobby | game
  conns: new Map(),                      // host: peerId -> { conn, team, name, token, open }
  host: null,                            // client: conexión al anfitrión
  lobby: null,                           // host: { slots, size }
  ev: [], teamEv: [[], [], [], []],      // host: eventos pendientes para el próximo snapshot
  snapT: 0, sendT: 0, pingT: 0, instSig: '', snapN: 0,
  lat: 0.06, myF: 0, resync: true, chunks: {}, chunkId: 0, lastSent: '',
  name: '', token: '', lastRx: 0, hostPaused: false,
});

// Latido: cada 2 s todos avisan que siguen ahí; si alguien se calla demasiado, se lo da por desconectado.
let hbLast = 0;
if (typeof window !== 'undefined') setInterval(() => {
  const now = performance.now();
  // si esta pestaña estuvo congelada (otra app en primer plano), no juzgamos a nadie por ese silencio
  const frozen = hbLast && now - hbLast > 6000;
  hbLast = now;
  if (frozen) { for (const rec of NET.conns.values()) rec.lastRx = now; NET.lastRx = now; }
  if (NET.role === 'host') {
    for (const rec of [...NET.conns.values()]) {
      if (!rec.open) continue;
      if (now - rec.lastRx > 9000) { try { rec.conn.close(); } catch (e) { /* nada */ } hostDrop(rec); continue; }
      sendTo(rec.conn, { k: 'ka' });
    }
  } else if (NET.role === 'client' && NET.host && NET.host.open) {
    sendTo(NET.host, { k: 'pi', c: now });
    // el anfitrión manda un latido cada 2 s aunque esté en pausa: 15 s de silencio es un corte
    if (NET.lastRx && now - NET.lastRx > 15000) clientFail('Se cortó la conexión con la partida.');
  }
}, 2000);

function onlineAvailable() { return typeof window !== 'undefined' && typeof window.Peer === 'function'; }

function peerOptions() {
  const opts = { debug: 0 };
  try {
    const ps = new URLSearchParams(location.search).get('ps');   // servidor propio para pruebas: ?ps=host:puerto
    if (ps) { const [host, port] = ps.split(':'); Object.assign(opts, { host, port: +port || 9000, path: '/', secure: false }); }
  } catch (e) { /* sin parámetros */ }
  return opts;
}

function randomCode() { let s = ''; for (let i = 0; i < 4; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; return s; }

/* ---------- envío con troceo (los mensajes grandes se parten en pedazos) ---------- */
const CHUNK = 12000;
function sendTo(conn, obj) {
  if (!conn || !conn.open) return;
  const s = JSON.stringify(obj);
  try {
    if (s.length <= CHUNK) { conn.send(s); return; }
    const id = ++NET.chunkId, n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) conn.send('\u0001' + id + '|' + i + '|' + n + '|' + s.slice(i * CHUNK, (i + 1) * CHUNK));
  } catch (e) { /* conexión cerrándose */ }
}
function recvFrom(key, data) {
  if (typeof data !== 'string') return null;
  if (data.charCodeAt(0) !== 1) { try { return JSON.parse(data); } catch (e) { return null; } }
  const p1 = data.indexOf('|'), p2 = data.indexOf('|', p1 + 1), p3 = data.indexOf('|', p2 + 1);
  const id = key + ':' + data.slice(1, p1), i = +data.slice(p1 + 1, p2), n = +data.slice(p2 + 1, p3);
  const c = NET.chunks[id] || (NET.chunks[id] = { parts: [], got: 0 });
  if (c.parts[i] == null) { c.parts[i] = data.slice(p3 + 1); c.got++; }
  if (c.got < n) return null;
  delete NET.chunks[id];
  try { return JSON.parse(c.parts.join('')); } catch (e) { return null; }
}
function bufferedOf(conn) { try { return conn.dataChannel ? conn.dataChannel.bufferedAmount : 0; } catch (e) { return 0; } }

/* ---------- codificación compacta ---------- */
// tipos: i entero, k ángulo (x1000), h décimas, c centésimas, b booleano, s texto
const SP_F = [['id', 'i'], ['team', 'i'], ['x', 'i'], ['y', 'i'], ['a', 'k'], ['vx', 'i'], ['vy', 'i'], ['hp', 'h'], ['maxHp', 'i'], ['sh', 'h'], ['upg', 'i'], ['ammo', 'i'], ['st', 's'], ['pl', 'i'], ['la', 'k'], ['pt', 'i'], ['thr', 'b'], ['num', 'i'], ['hitT', 'c'], ['lastHit', 'c'], ['servicing', 'b']];
const SP_R = [['id', 'i'], ['team', 'i'], ['x', 'i'], ['y', 'i'], ['a', 'k'], ['vx', 'i'], ['vy', 'i'], ['hp', 'h'], ['cargo', 'i'], ['st', 's'], ['opl', 'i'], ['thr', 'b'], ['num', 'i'], ['hitT', 'c'], ['jk', 's'], ['jpl', 'i']];
const SP_I = [['id', 'i'], ['type', 's'], ['team', 'i'], ['pl', 'i'], ['hp', 'h'], ['mat', 'i'], ['num', 'i'], ['pn', 'i'], ['hitT', 'c']];
const SP_X = [['id', 'i'], ['x', 'i'], ['y', 'i'], ['vx', 'i'], ['vy', 'i'], ['k', 'i'], ['team', 'i'], ['tur', 'b']];
const SP_T = [['alive', 'b'], ['dev', 'i'], ['fBuild', 'h'], ['buildSite', 'i'], ['site', 'i'], ['human', 'b'], ['ally', 'i'], ['pname', 's'], ['pers', 'i'], ['ctl', 's']];
function enc(o, spec) {
  return spec.map(([k, t]) => {
    const v = o[k];
    switch (t) {
      case 'i': return v == null || !isFinite(v) ? -1 : Math.round(v);
      case 'k': return Math.round((v || 0) * 1000);
      case 'h': return Math.round((v || 0) * 10);
      case 'c': return Math.round((v == null ? -99 : v) * 100);
      case 'b': return v ? 1 : 0;
      default: return v == null ? '' : v;
    }
  });
}
function dec(a, spec, o) {
  for (let i = 0; i < spec.length; i++) {
    const [k, t] = spec[i], v = a[i];
    o[k] = t === 'k' ? v / 1000 : t === 'h' ? v / 10 : t === 'c' ? v / 100 : t === 'b' ? !!v : v;
  }
  return o;
}

/* ===================== ANFITRIÓN ===================== */
function hostCreate(onReady, onError) {
  netClose();
  NET.role = 'host'; NET.phase = 'lobby'; NET.code = randomCode();
  NET.lobby = {
    size: SET.size, sector: 1,
    slots: TEAMS.map((_, i) => i === 0 ? { ctl: 'local', pname: NET.name, ally: 0, token: NET.token } : { ctl: 'ai', pname: '', ally: i, token: '', peer: null }),
  };
  hostSaveSession();
  hostOpen({ ready: onReady, error: onError, keepCode: false }, 0);
}

// Abre la "dirección" de la sala en el servicio de PeerJS. Al recuperar una sala se insiste con el mismo
// código: el servicio tarda unos segundos en liberar el de la pestaña que Chrome cerró.
function hostOpen(cbs, attempt) {
  const code = NET.code;
  const peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  NET.peer = peer;
  peer.on('open', () => { hostSaveSession(); if (cbs.ready) cbs.ready(code); });
  peer.on('connection', conn => hostAccept(conn));
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* nada */ } });
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') return;
    if (err.type === 'unavailable-id') {
      try { peer.destroy(); } catch (e) { /* nada */ }
      if (!cbs.keepCode) { NET.code = randomCode(); hostOpen(cbs, 0); return; }
      if (attempt < 40) {
        if (cbs.wait) cbs.wait(attempt + 1);
        setTimeout(() => { if (NET.role === 'host' && NET.code === code) hostOpen(cbs, attempt + 1); }, 3000);
        return;
      }
    }
    if (cbs.error) cbs.error(netErrorText(err));
  });
}

/* ---------- la sala sobrevive si Chrome cierra la pestaña (por ejemplo al ir a WhatsApp) ---------- */
const HOST_KEY = 'gw-host', CLIENT_KEY = 'gw-client', SESSION_TTL = 45 * 60 * 1000;
function hostSaveSession() {
  if (NET.role !== 'host' || !NET.code || !NET.lobby) return;
  const sess = {
    v: 1, code: NET.code, ts: Date.now(), phase: NET.phase,
    lobby: { size: NET.lobby.size, sector: NET.lobby.sector || 1, slots: NET.lobby.slots.map(s => ({ ctl: s.ctl, pname: s.pname || '', ally: s.ally, token: s.token || '' })) },
    g: NET.phase === 'game' && G && G.online && !G.demo ? G : null,
  };
  try { localStorage.setItem(HOST_KEY, JSON.stringify(sess)); } catch (e) { /* sin almacenamiento */ }
}
function loadSession(key) {
  try { const s = JSON.parse(localStorage.getItem(key) || 'null'); if (s && s.v === 1 && Date.now() - s.ts < SESSION_TTL) return s; } catch (e) { /* nada */ }
  return null;
}
function clearSessions() { try { localStorage.removeItem(HOST_KEY); localStorage.removeItem(CLIENT_KEY); } catch (e) { /* nada */ } }
function saveClientSession(code) { try { localStorage.setItem(CLIENT_KEY, JSON.stringify({ v: 1, code, ts: Date.now() })); } catch (e) { /* nada */ } }

function hostRestore(sess, cbs) {
  netClose();
  NET.role = 'host'; NET.code = sess.code;
  NET.lobby = {
    size: sess.lobby.size, sector: sess.lobby.sector || 1,
    slots: sess.lobby.slots.map((s, i) => i === 0 ? { ctl: 'local', pname: NET.name, ally: s.ally, token: NET.token } : { ctl: 'ai', pname: s.pname, ally: s.ally, token: s.token, peer: null }),
  };
  NET.ev = []; NET.teamEv = [[], [], [], []]; NET.instSig = ''; NET.snapN = 0;
  if (sess.g && !sess.g.over) {
    G = migrateGame(sess.g); ME = 0; rebuildIndex(); FX = [];
    for (const T of G.teams) if (T.ctl === 'remote') { T.ctl = 'ai'; T.human = false; T.peer = null; }
    for (const u of G.units) if (u.type === 'fighter') u.rem = null;
    NET.phase = 'game';
  } else {
    if (sess.g && sess.g.over) NET.lobby.sector = sess.g.sector + 1;
    NET.phase = 'lobby';
  }
  hostOpen(Object.assign({ keepCode: true }, cbs), 0);
}

function hostAccept(conn) {
  const rec = { conn, team: -1, name: '', token: '', open: false, lastRx: performance.now() };
  NET.conns.set(conn.peer, rec);
  conn.on('data', d => { rec.lastRx = performance.now(); const m = recvFrom(conn.peer, d); if (m) hostOnMsg(rec, m); });
  conn.on('close', () => hostDrop(rec));
  conn.on('error', () => hostDrop(rec));
}

function hostOnMsg(rec, m) {
  switch (m.k) {
    case 'hi': {
      if (m.v !== PROTO) { sendTo(rec.conn, { k: 'err', msg: 'Versión distinta del juego: recargá la página.' }); return; }
      rec.name = String(m.name || '').slice(0, 14) || 'Jugador'; rec.token = String(m.token || '').slice(0, 24); rec.open = true;
      if (NET.phase === 'lobby') {
        const sl = NET.lobby.slots;
        let i = sl.findIndex((s, j) => j > 0 && s.token && s.token === rec.token && s.ctl !== 'local');
        if (i >= 0) for (const o of NET.conns.values()) if (o !== rec && o.team === i) { o.team = -1; try { o.conn.close(); } catch (e) { /* nada */ } }
        if (i < 0) i = sl.findIndex((s, j) => j > 0 && s.ctl === 'ai' && !s.token);
        if (i < 0) i = sl.findIndex((s, j) => j > 0 && s.ctl === 'ai');
        if (i < 0) { sendTo(rec.conn, { k: 'full' }); setTimeout(() => rec.conn.close(), 300); return; }
        Object.assign(sl[i], { ctl: 'remote', pname: rec.name, token: rec.token, peer: rec.conn.peer });
        rec.team = i;
        sendTo(rec.conn, { k: 'wel', team: i, code: NET.code, phase: 'lobby' });
        hostLobbyChanged();
      } else if (NET.phase === 'game') hostJoinMidGame(rec);
      break;
    }
    case 'st': {
      if (!G || rec.team < 0) return;
      const f = U.get(m.id);
      if (f && f.type === 'fighter' && f.team === rec.team && G.teams[rec.team].ctl === 'remote') { m.t = G.t; f.rem = m; }
      break;
    }
    case 'dm': { const f = myFighterOf(rec); if (f && m.id === f.id) hullDamage(f, +m.v || 0, -1); break; }
    case 'cr': { const f = myFighterOf(rec); if (f && m.id === f.id) killUnit(f, -1, m.c === 'star' ? 'star' : 'crash'); break; }
    case 'pi': sendTo(rec.conn, { k: 'po', c: m.c }); break;
  }
}
function myFighterOf(rec) { return rec.team >= 0 && G ? fighterOf(rec.team) : null; }

function hostJoinMidGame(rec) {
  // el mismo teléfono que vuelve recupera su color (aunque la conexión vieja todavía no se haya cortado)
  let T = G.teams.find(t => t.id !== ME && t.token && t.token === rec.token && (t.ctl === 'ai' || t.ctl === 'remote'));
  if (T && T.ctl === 'remote') for (const o of NET.conns.values()) if (o !== rec && o.team === T.id) { o.team = -1; try { o.conn.close(); } catch (e) { /* nada */ } }
  if (!T) T = G.teams.find(t => t.ctl === 'ai' && t.alive && t.id !== ME);
  if (!T) { sendTo(rec.conn, { k: 'full' }); setTimeout(() => rec.conn.close(), 300); return; }
  Object.assign(T, { ctl: 'remote', human: true, pname: rec.name, token: rec.token, peer: rec.conn.peer });
  rec.team = T.id;
  const f = fighterOf(T.id); if (f) f.rem = null;
  sendTo(rec.conn, { k: 'wel', team: T.id, code: NET.code, phase: 'game' });
  sendTo(rec.conn, { k: 'ini', team: T.id, g: G, paused });
  for (const O of G.teams) if (O.human && O.id !== T.id) tell(O.id, `${rec.name} se sumó con el color ${TEAMS[T.id].name.toLowerCase()}.`);
  tell(ME, `${rec.name} se sumó con el color ${TEAMS[T.id].name.toLowerCase()}.`);
}

function hostDrop(rec) {
  if (!NET.conns.has(rec.conn.peer)) return;
  NET.conns.delete(rec.conn.peer);
  if (rec.team < 0) return;
  if (NET.phase === 'lobby' && NET.lobby) {
    const s = NET.lobby.slots[rec.team];
    if (s && s.peer === rec.conn.peer) Object.assign(s, { ctl: 'ai', pname: '', peer: null });
    hostLobbyChanged();
  } else if (NET.phase === 'game' && G) {
    const T = G.teams[rec.team];
    if (T && T.ctl === 'remote' && (!T.peer || T.peer === rec.conn.peer)) {
      T.ctl = 'ai'; T.human = false;
      const f = fighterOf(T.id); if (f) f.rem = null;
      const msg = `${rec.name} se desconectó: la computadora maneja el color ${TEAMS[T.id].name.toLowerCase()} hasta que vuelva.`;
      for (const O of G.teams) if (O.human) tell(O.id, msg, 'warn');
      checkSectorEnd();
    }
  }
}

function hostLobbyChanged() {
  hostSaveSession();
  const info = lobbyInfo();
  for (const rec of NET.conns.values()) if (rec.open && rec.team >= 0) sendTo(rec.conn, { k: 'lob', lobby: info, team: rec.team });
  if (typeof renderLobby === 'function') renderLobby();
}
function lobbyInfo() { return { size: NET.lobby.size, slots: NET.lobby.slots.map(s => ({ ctl: s.ctl, pname: s.pname, ally: s.ally })) }; }

function hostStartGame(sector) {
  const slots = NET.phase === 'lobby'
    ? NET.lobby.slots.map(s => ({ ctl: s.ctl, pname: s.pname, ally: s.ally, token: s.token }))
    : G.teams.map(T => ({ ctl: T.ctl, pname: T.ctl === 'ai' ? '' : T.pname, ally: T.ally, token: T.token, peer: T.peer }));
  NET.phase = 'game'; NET.lobby.sector = sector;
  newGame(sector, NET.lobby.size, false, { online: true, slots });
  ME = 0;
  slots.forEach((sl, i) => { G.teams[i].peer = sl.peer || null; });
  NET.ev = []; NET.teamEv = [[], [], [], []]; NET.instSig = ''; NET.snapN = 0;
  for (const rec of NET.conns.values()) {
    if (!rec.open || rec.team < 0) continue;
    const T = G.teams[rec.team];
    if (T.ctl !== 'remote') continue;
    sendTo(rec.conn, { k: 'ini', team: rec.team, g: G, paused: false });
  }
  hostSaveSession();
}

/* nave de un jugador remoto, del lado del anfitrión */
function remoteFighter(f, dt) {
  const st = fstats(f.upg);
  f.maxHp = st.maxHp; f.gcd -= dt; f.mcd -= dt;
  const r = f.rem;
  if (!r || G.t - r.t > 3) { aiFighter(f, dt); updFighter(f, dt); return; } // sin noticias del teléfono: la computadora lo sostiene
  if (r.st !== f.st || (r.st === 'l' && r.pl !== f.pl)) {
    if (r.st === 'l' && G.planets[r.pl]) {
      f.st = 'l'; f.pl = r.pl; f.la = r.la; f.landT = G.t; f.rearm = 0;
      arrived(f, G.planets[r.pl], false);
    } else if (r.st === 'd') {
      const port = U.get(r.pt);
      if (port && port.type === 'port' && !foe(port.team, f.team)) { f.st = 'd'; f.pt = r.pt; f.landT = G.t; f.rearm = 0; arrived(f, G.planets[port.pl], true); }
      else f.st = 'f';
    } else { f.st = 'f'; f.pt = 0; }
  }
  if (f.st === 'f') {
    const age = Math.min(G.t - r.t, 0.4);
    f.x = r.x + r.vx * age; f.y = r.y + r.vy * age; f.vx = r.vx; f.vy = r.vy; f.a = r.a;
    if (f.sh < st.maxSh && G.t - f.lastHit > 4) f.sh = Math.min(st.maxSh, f.sh + 0.8 * dt);
  } else {
    attachFighter(f);
    if (f.st !== 'f') service(f, st, dt);
  }
  f.thr = !!r.thr;
  f.ctl.fire = !!r.fi; f.ctl.mis = !!r.mi;
  weapons(f, st, f.ctl);
}

/* eventos para el próximo snapshot */
function netSound(name, x, y, vol, team) {
  if (NET.ev.length > 60) return;
  NET.ev.push(['s', name, Math.round(x), Math.round(y), Math.round((vol == null ? 1 : vol) * 100), team == null ? -1 : team]);
}
HOOK.fx = (kind, x, y, n, color) => {
  if (NET.role !== 'host' || !G || G.demo || NET.ev.length > 80) return;
  NET.ev.push([kind, Math.round(x), Math.round(y), n, color]);
};
function netTeamEvent(team, ev) { if (NET.teamEv[team] && NET.teamEv[team].length < 30) NET.teamEv[team].push(ev); }

function hostSnapshot() {
  NET.snapN++;
  const S = [], R = [], I = [], X = [];
  let sig = '';
  for (const u of G.units) {
    if (u.type === 'fighter') S.push(enc(u, SP_F));
    else if (u.type === 'freighter') { u.jk = u.job ? u.job.k : ''; u.jpl = u.job ? u.job.pl : -1; R.push(enc(u, SP_R)); }
    else { I.push(enc(u, SP_I)); sig += u.id + ','; }
  }
  for (const s of G.shots) X.push(enc(s, SP_X));
  const P = G.planets.map(p => [p.owner, Math.round(p.flagA * 1000), Math.round(p.pa * 1000), p.s.base, p.s.colony, p.s.lab, p.s.comm, p.s.port, p.s.dock, p.s.sensor]);
  const T = G.teams.map(t => enc(t, SP_T));
  const snap = { k: 's', t: Math.round(G.t * 1000) / 1000, P, T, S, R, X, E: NET.ev, over: G.over ? 1 : 0 };
  if (sig !== NET.instSig || NET.snapN % 3 === 0) { snap.I = I; NET.instSig = sig; }
  NET.ev = [];
  for (const rec of NET.conns.values()) {
    if (!rec.open || rec.team < 0) continue;
    const M = NET.teamEv[rec.team];
    if (bufferedOf(rec.conn) > 200000) continue;   // conexión lenta: salteamos este envío
    snap.M = M.length ? M : undefined;
    sendTo(rec.conn, snap);
    NET.teamEv[rec.team] = [];
  }
}

function hostBroadcast(obj) { for (const rec of NET.conns.values()) if (rec.open && rec.team >= 0) sendTo(rec.conn, obj); }

function netHostTick(dt) {
  if (NET.role !== 'host' || NET.phase !== 'game' || !G) return;
  NET.snapT += dt; NET.saveT = (NET.saveT || 0) + dt;
  if (NET.snapT >= 1 / SNAP_HZ) { NET.snapT = 0; hostSnapshot(); }
  if (NET.saveT >= 5) { NET.saveT = 0; hostSaveSession(); }
}

/* ===================== CLIENTE ===================== */
function clientJoin(code, handlers) {
  netClose();
  NET.role = 'client'; NET.phase = 'joining'; NET.code = code.toUpperCase();
  NET.handlers = handlers || {};
  const peer = new window.Peer(undefined, peerOptions());
  NET.peer = peer;
  let opened = false;
  const failTimer = setTimeout(() => { if (!opened) clientFail('No se pudo conectar con la partida. Revisá el código y que el anfitrión tenga el juego abierto.'); }, 15000);
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + NET.code, { serialization: 'raw', reliable: true, metadata: { v: PROTO } });
    NET.host = conn;
    conn.on('open', () => { opened = true; clearTimeout(failTimer); sendTo(conn, { k: 'hi', v: PROTO, name: NET.name, token: NET.token }); });
    conn.on('data', d => { NET.lastRx = performance.now(); const m = recvFrom('h', d); if (m) clientOnMsg(m); });
    conn.on('close', () => { if (NET.role === 'client') clientFail('Se cortó la conexión con la partida.'); });
    conn.on('error', () => { if (NET.role === 'client') clientFail('Se cortó la conexión con la partida.'); });
  });
  peer.on('error', err => {
    clearTimeout(failTimer);
    if (err.type === 'peer-unavailable') clientFail(`No se encontró la partida ${NET.code}. Puede que el anfitrión la haya cerrado.`);
    else clientFail(netErrorText(err), err.type === 'browser-incompatible');
  });
}

function clientFail(msg, fatal) {
  if (NET.role !== 'client') return;
  const h = NET.handlers || {};
  netClose();
  if (h.fail) h.fail(msg, !!fatal);
}

function clientOnMsg(m) {
  const h = NET.handlers || {};
  switch (m.k) {
    case 'wel': ME = m.team; NET.phase = m.phase; saveClientSession(NET.code); if (h.welcome) h.welcome(m); break;
    case 'lob': ME = m.team; if (h.lobby) h.lobby(m.lobby); break;
    case 'ini': {
      G = migrateGame(m.g); ME = m.team; rebuildIndex(); FX = [];
      G.over = false; NET.phase = 'game'; NET.myF = 0; NET.resync = true; NET.shotMap = new Map();
      for (const u of G.units) if (u.type !== 'fighter' || u.team !== ME) { u.cx = 0; u.cy = 0; u.ta = u.a; }
      for (const s of G.shots) { s.cx = 0; s.cy = 0; NET.shotMap.set(s.id, s); }
      adoptOwnFighter();
      if (h.start) h.start(m);
      if (m.paused && h.pause) h.pause(true);
      break;
    }
    case 's': if (G && NET.phase === 'game') applySnapshot(m); break;
    case 'end': if (h.end) h.end(m); break;
    case 'pz': NET.hostPaused = !!m.on; if (h.pause) h.pause(m.on); break;
    case 'po': { const rtt = (performance.now() - m.c) / 1000; NET.lat = clamp(NET.lat * 0.7 + rtt / 2 * 0.3, 0.01, 0.35); break; }
    case 'full': clientFail('La partida está completa: los 3 lugares para amigos ya están ocupados.', true); break;
    case 'err': clientFail(m.msg || 'El anfitrión rechazó la conexión.', true); break;
  }
}

function adoptOwnFighter() {
  const f = fighterOf(ME);
  if (!f) { if (NET.myF) { NET.myF = 0; onFighterLost(ME, null); } return; }
  if (f.id !== NET.myF || NET.resync) {
    const isNew = f.id !== NET.myF;
    NET.myF = f.id; NET.resync = false;
    f.frozen = false; f.gcd = 0; f.mcd = 0; f.lift = -9; f.landT = G.t;
    if (!f.ctl) f.ctl = { turn: 0, thrust: false, fire: false, mis: false };
    f.cx = 0; f.cy = 0;
    if (isNew) onFighterSpawn(ME, f);
  }
}

function applySnapshot(s) {
  const lat = NET.lat;
  G.t = s.t + lat;
  s.P.forEach((a, i) => {
    const p = G.planets[i]; if (!p) return;
    p.owner = a[0]; p.flagA = a[1] / 1000; p.pa = a[2] / 1000 + C.PORT_W * lat;
    p.s.base = a[3]; p.s.colony = a[4]; p.s.lab = a[5]; p.s.comm = a[6]; p.s.port = a[7]; p.s.dock = a[8]; p.s.sensor = a[9];
  });
  s.T.forEach((a, i) => { if (G.teams[i]) dec(a, SP_T, G.teams[i]); });
  const seen = new Set();
  const own = NET.myF && !NET.resync ? U.get(NET.myF) : null;
  for (const a of s.S) {
    const o = dec(a, SP_F, {});
    seen.add(o.id);
    if (own && o.id === own.id) {
      for (const k of ['hp', 'maxHp', 'sh', 'upg', 'ammo', 'num', 'hitT', 'lastHit', 'servicing']) own[k] = o[k];
      continue;
    }
    upsertMoving(o, 'fighter', lat);
  }
  for (const a of s.R) {
    const o = dec(a, SP_R, {});
    o.job = o.jk ? { k: o.jk, pl: o.jpl } : null;
    seen.add(o.id);
    upsertMoving(o, 'freighter', lat);
  }
  if (s.I) {
    for (const a of s.I) {
      const o = dec(a, SP_I, {});
      seen.add(o.id);
      let u = U.get(o.id);
      if (!u) { u = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, a: 0, maxHp: UT[o.type].hp }, o); G.units.push(u); U.set(u.id, u); }
      else Object.assign(u, o);
      u.maxHp = UT[u.type].hp;
      placeInst(u);
    }
  }
  // quitar lo que ya no existe
  const keep = [];
  for (const u of G.units) {
    const inst = UT[u.type].surf || UT[u.type].orb;
    let alive;
    if (inst) alive = s.I ? seen.has(u.id) : G.planets[u.pl] && G.planets[u.pl].s[u.type] === u.id;
    else alive = seen.has(u.id);
    if (alive) keep.push(u); else U.delete(u.id);
  }
  G.units = keep;
  // disparos
  const ns = [], map = new Map();
  for (const a of s.X) {
    const o = dec(a, SP_X, {});
    const ex = o.x + o.vx * lat, ey = o.y + o.vy * lat;
    let sh = NET.shotMap && NET.shotMap.get(o.id);
    if (sh) { sh.vx = o.vx; sh.vy = o.vy; const dx = ex - sh.x, dy = ey - sh.y; if (dx * dx + dy * dy > 6400) { sh.x = ex; sh.y = ey; sh.cx = 0; sh.cy = 0; } else { sh.cx = dx; sh.cy = dy; } }
    else { sh = Object.assign(o, { x: ex, y: ey, cx: 0, cy: 0 }); }
    ns.push(sh); map.set(sh.id, sh);
  }
  G.shots = ns; NET.shotMap = map;
  // eventos
  for (const e of s.E || []) playEvent(e);
  for (const e of s.M || []) playEvent(e);
  adoptOwnFighter();
}

function upsertMoving(o, type, lat) {
  let u = U.get(o.id);
  const ex = o.x + o.vx * lat, ey = o.y + o.vy * lat;
  if (!u) {
    u = Object.assign({ type }, o, { x: ex, y: ey, cx: 0, cy: 0, ta: o.a });
    if (type === 'fighter') u.ctl = { turn: 0, thrust: false, fire: false, mis: false };
    G.units.push(u); U.set(u.id, u);
    return;
  }
  const px = u.x, py = u.y, pa = u.a;
  Object.assign(u, o);
  u.x = px; u.y = py; u.a = pa; u.ta = o.a;
  const dx = ex - px, dy = ey - py;
  if (dx * dx + dy * dy > 62500) { u.x = ex; u.y = ey; u.cx = 0; u.cy = 0; u.a = o.a; } else { u.cx = dx; u.cy = dy; }
}

function playEvent(e) {
  switch (e[0]) {
    case 's': if (e[5] === ME && (e[1] === 'fire' || e[1] === 'missile')) return; sfx(e[1], e[2], e[3], e[4] / 100); break;
    case 'x': explode(e[1], e[2], e[3], e[4]); break;
    case 'p': sparks(e[1], e[2], e[3], e[4]); break;
    case 'm': toast(e[1], e[2], e[3]); break;
    case 'S': sfx(e[1], null, null, e[2]); break;
    case 'v': vibrate(e[1]); break;
  }
}

/* cada cuadro en el cliente: extrapolar lo ajeno y simular la nave propia */
function clientFrame(dt) {
  if (!G) return;
  G.t += dt;
  for (const p of G.planets) p.pa += C.PORT_W * dt;
  const k = 1 - Math.exp(-dt * 10);
  for (const u of G.units) {
    if (UT[u.type].surf || UT[u.type].orb) { placeInst(u); continue; }
    if (u.id === NET.myF) continue;
    if (u.type === 'fighter' && (u.st === 'l' || u.st === 'd')) { attachFighter(u); if (u.st !== 'f') { u.a = angLerp(u.a, u.ta, k); continue; } }
    u.x += u.vx * dt + u.cx * k; u.y += u.vy * dt + u.cy * k;
    u.cx -= u.cx * k; u.cy -= u.cy * k;
    if (u.ta != null) u.a = angLerp(u.a, u.ta, Math.min(1, k * 1.6));
  }
  for (const s of G.shots) { s.x += s.vx * dt + s.cx * k; s.y += s.vy * dt + s.cy * k; s.cx -= s.cx * k; s.cy -= s.cy * k; }
  const f = NET.myF ? U.get(NET.myF) : null;
  if (f) clientFighterStep(f, dt);
  updFx(dt);
  NET.sendT += dt; NET.pingT += dt;
  if (f && NET.sendT >= 1 / STATE_HZ) { NET.sendT = 0; clientSendState(f, false); }
  if (NET.pingT >= 2) { NET.pingT = 0; sendTo(NET.host, { k: 'pi', c: performance.now() }); }
}

function clientFighterStep(f, dt) {
  if (f.frozen) { if (G.t - f.frozenT > 2) f.frozen = false; return; }
  const st = fstats(f.upg), c = f.ctl;
  playerControl(f);
  f.thr = false; f.gcd -= dt; f.mcd -= dt;
  if (c.fire && f.gcd <= 0) { f.gcd = C.GUN_CD; sfx('fire', f.x, f.y, 0.35, 0.09); }
  if (c.mis && f.mcd <= 0 && f.ammo > 0 && st.ammoT) { f.mcd = 0.6; sfx('missile', f.x, f.y, 0.6); }
  const prevSt = f.st;
  if (f.st === 'l' || f.st === 'd') {
    if (f.st === 'l') f.a = angLerp(f.a, f.la, dt * 5);
    attachFighter(f);
    if (f.st !== 'f') { if (c.thrust && G.t - f.landT > 0.35) takeoff(f); }
  } else flyStep(f, st, c, dt);
  if (f.st !== prevSt) { if (f.st !== 'f') f.landT = G.t; clientSendState(f, true); }
}

function clientSendState(f, force) {
  const m = { k: 'st', id: f.id, x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, vx: Math.round(f.vx * 10) / 10, vy: Math.round(f.vy * 10) / 10,
    a: Math.round(f.a * 1000) / 1000, st: f.st, pl: f.st === 'l' ? f.pl : -1, la: Math.round((f.la || 0) * 1000) / 1000, pt: f.st === 'd' ? f.pt : 0,
    thr: f.thr ? 1 : 0, fi: f.ctl.fire ? 1 : 0, mi: f.ctl.mis ? 1 : 0 };
  sendTo(NET.host, m);
}

function netReportDamage(f, dmg) {
  if (f.id !== NET.myF) return;
  f.hp -= dmg; f.hitT = G.t;
  sendTo(NET.host, { k: 'dm', id: f.id, v: Math.round(dmg * 10) / 10 });
  if (f.hp <= 0) netReportCrash(f, 'crash');
}
function netReportCrash(f, cause) {
  if (f.id !== NET.myF || f.frozen) return;
  f.frozen = true; f.frozenT = G.t; f.vx = 0; f.vy = 0;
  sendTo(NET.host, { k: 'cr', id: f.id, c: cause });
}

/* ===================== comunes ===================== */
function netClose() {
  try { if (NET.host) NET.host.close(); } catch (e) { /* nada */ }
  for (const rec of NET.conns.values()) { try { rec.conn.close(); } catch (e) { /* nada */ } }
  try { if (NET.peer && !NET.peer.destroyed) NET.peer.destroy(); } catch (e) { /* nada */ }
  NET.conns = new Map(); NET.host = null; NET.peer = null; NET.role = null; NET.phase = 'idle'; NET.myF = 0; NET.lastRx = 0; NET.hostPaused = false;
}

function netErrorText(err) {
  switch (err && err.type) {
    case 'browser-incompatible': return 'Este navegador no permite jugar online. Probá con Chrome o Safari actualizados.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'No se pudo conectar al servicio de partidas. Revisá tu conexión a internet y probá de nuevo.';
    default: return 'Hubo un problema con la conexión. Probá de nuevo.';
  }
}

function shareLink() { return `${location.origin}${location.pathname}?p=${NET.code}`; }
