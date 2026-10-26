/* ---------- pantallas ---------- */
const OVERLAYS = ['title', 'help', 'dialog', 'online', 'lobby'];
function showOverlay(id) { for (const o of OVERLAYS) $(o).hidden = o !== id; }
function setPlaying(on) { $('play').hidden = !on; }

function showTitle() {
  mode = 'title'; paused = false; setPlaying(false);
  $('map').hidden = true; $('units').hidden = true;
  const sv = store.get('gw-save', null);
  const ok = sv && (sv.v === 1 || sv.v === 2) && !sv.over && !sv.online;
  $('m-continue').hidden = !ok;
  if (ok) $('m-continue-sec').textContent = `Sector ${sv.sector}`;
  $('m-online').hidden = !onlineAvailable();
  $('m-score').textContent = `Sectores ganados ${SCORE.won} · perdidos ${SCORE.lost}`;
  refreshOpts();
  showOverlay('title');
}

function refreshOpts() {
  $('o-sound').textContent = `Sonido: ${SET.sound ? 'Sí' : 'No'}`;
  $('o-size').textContent = `Sector: ${SIZE_NAMES[SET.size]}`;
  $('o-vib').textContent = `Vibración: ${SET.vib ? 'Sí' : 'No'}`;
  const ps = $('p-sound');
  if (ps) ps.textContent = `Sonido: ${SET.sound ? 'Sí' : 'No'}`;
  store.set('gw-settings', SET);
}

function startDemo() {
  ME = 0;
  newGame(1, 1, true);
  V.target = 0;
  const f = fighterOf(0);
  if (f) { V.x = f.x; V.y = f.y; }
  V.zoom = V.baseZoom * 0.7;
}

function enterPlay() {
  mode = 'play'; paused = false; NET.hostPaused = false;
  setPlaying(true); showOverlay(null);
  $('map').hidden = true; $('units').hidden = true;
  const f = fighterOf(ME);
  V.target = f ? f.id : 0;
  const t = camTarget();
  if (t) { V.x = t.x; V.y = t.y; }
  V.zoom = V.baseZoom;
  wakeLock();
}

function introToasts() {
  const foes = G.teams.filter(t => foe(t.id, ME)).map(teamName).join(', ');
  const allies = G.teams.filter(t => t.id !== ME && !foe(t.id, ME)).map(teamName);
  toast(`Sector ${G.sector}: ${G.planets.length} planetas alrededor de ${G.stars.length} estrellas. Rivales: ${foes}.${allies.length ? ' Aliados: ' + allies.join(', ') + '.' : ''}`, 'big');
  if (G.online) setTimeout(() => toast(`Jugás con el color ${TEAMS[ME].name.toLowerCase()}.`), 900);
  setTimeout(() => toast('Despegá con EMPUJE y aterrizá despacio en un planeta libre para reclamarlo.'), 1800);
}

function startGame(sector) {
  netClose();
  ME = 0;
  newGame(sector, SET.size, false);
  enterPlay();
  introToasts();
  saveGame();
}

function sectorEnd(winAlly) {
  if (!G || G.over) return;
  G.over = true;
  if (NET.role === 'host') hostBroadcast({ k: 'end', w: winAlly });
  showSectorEnd(winAlly);
}

function showSectorEnd(winAlly) {
  if (!G) return;
  sfx('siren');
  G.over = true; paused = true;
  const meT = G.teams[ME];
  const win = winAlly != null && meT.ally === winAlly;
  SCORE[win ? 'won' : 'lost']++;
  store.set('gw-score', SCORE);
  if (!G.online) store.del('gw-save');
  const next = G.sector + 1;
  const winners = winAlly == null ? [] : G.teams.filter(t => t.ally === winAlly);
  const losers = G.teams.filter(t => !winners.includes(t));
  let title, body;
  if (win) {
    const others = losers.map(teamName).join(', ');
    if (winners.length > 1) { title = '¡Tu equipo ganó el sector!'; body = `Ganaron ${winners.map(teamName).join(' y ')}. ${others}: sin posiciones viables en la región.`; }
    else { title = '¡Sector conquistado!'; body = `Ganaste este sector. ${others} fueron derrotados: ninguno tiene ya una posición viable en la región. Disfrutá la victoria, que el próximo sector espera y tus oponentes van a estar ahí, listos.`; }
  } else if (winners.length) {
    title = 'Sector perdido';
    body = `${winners.map(teamName).join(' y ')} ${winners.length > 1 ? 'ganaron' : 'ganó'} este sector.${meT.alive ? '' : ' Te quedaste sin colonias ni cargueros.'}`;
  } else {
    let strongest = null, sp = -1;
    for (const T of G.teams) { if (!T.alive) continue; const n = G.planets.filter(p => p.owner === T.id).length; if (n > sp) { sp = n; strongest = T; } }
    title = 'Sector perdido';
    const many = G.teams.filter(t => t.ctl !== 'ai').length > 1;
    body = `${strongest ? cap(elTeam(strongest)) + ' quedó al frente del sector. ' : ''}${many ? 'Ningún jugador conserva colonias ni cargueros.' : 'Todas tus colonias fueron destruidas y no te quedan cargueros para fundar una nueva.'} Retirada al próximo sector.`;
  }
  const foot = `Sectores ganados ${SCORE.won} · perdidos ${SCORE.lost}`;
  if (NET.role === 'client') {
    dialog(title, body, [{ t: 'Salir de la partida', f: leaveOnline }], foot + ' · Esperando que el anfitrión arranque el próximo sector…');
  } else if (NET.role === 'host') {
    dialog(title, body, [
      { t: `Seguir al sector ${next}`, primary: true, f: () => { hostStartGame(next); enterPlay(); introToasts(); } },
      { t: 'Terminar la partida online', f: leaveOnline },
    ], foot);
  } else {
    dialog(title, body, [
      { t: win ? `Avanzar al sector ${next}` : `Retirarse al sector ${next}`, primary: true, f: () => startGame(next) },
      { t: 'Menú principal', f: () => { startDemo(); showTitle(); } },
    ], foot);
  }
}

function leaveOnline() { netClose(); startDemo(); showTitle(); }

function dialog(title, body, buttons, foot) {
  $('d-title').textContent = title;
  $('d-body').textContent = body;
  $('d-foot').textContent = foot || '';
  const box = $('d-btns');
  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'mb' + (b.primary ? ' primary' : '');
    el.textContent = b.t;
    if (b.id) el.id = b.id;
    el.addEventListener('click', () => { audioInit(); b.f(); });
    box.appendChild(el);
  }
  showOverlay('dialog');
}

function pause(on) {
  if (mode !== 'play' || !G || G.over) return;
  PTRS.clear(); for (const k in KEYS) KEYS[k] = false; recomputeInput();
  if (NET.role === 'client') { if (on) clientMenu(); else showOverlay(null); return; }
  paused = on;
  if (NET.role === 'host') hostBroadcast({ k: 'pz', on });
  if (!on) { showOverlay(null); return; }
  saveGame();
  const T0 = G.teams[ME];
  const mine = G.planets.filter(p => p.owner === ME).length;
  const host = NET.role === 'host';
  const btns = [{ t: 'Continuar', primary: true, f: () => pause(false) }];
  if (host) btns.push({ t: `Invitar (código ${NET.code})`, f: shareInvite });
  btns.push({ t: 'Cómo se juega', f: () => { HELP_BACK = 'dialog'; showOverlay('help'); } });
  btns.push({ t: `Sonido: ${SET.sound ? 'Sí' : 'No'}`, id: 'p-sound', f: () => { SET.sound = !SET.sound; refreshOpts(); } });
  btns.push(host ? { t: 'Terminar la partida online', f: leaveOnline } : { t: 'Guardar y salir al menú', f: () => { saveGame(); startDemo(); showTitle(); } });
  dialog('Pausa', `Sector ${G.sector} · ${mine} de ${G.planets.length} planetas son tuyos · mejoras desarrolladas: ${T0.dev} de ${UPG.length}.`, btns,
    host ? 'La partida está en pausa para todos los jugadores.' : `Sectores ganados ${SCORE.won} · perdidos ${SCORE.lost} · La partida se guarda sola en este dispositivo.`);
}
let HELP_BACK = 'title';

function clientMenu() {
  dialog('Menú', `Jugás con el color ${TEAMS[ME].name.toLowerCase()} en la partida ${NET.code}. La partida sigue mientras mirás este menú.`, [
    { t: 'Seguir jugando', primary: true, f: () => showOverlay(null) },
    { t: 'Cómo se juega', f: () => { HELP_BACK = 'dialog'; showOverlay('help'); } },
    { t: `Sonido: ${SET.sound ? 'Sí' : 'No'}`, id: 'p-sound', f: () => { SET.sound = !SET.sound; refreshOpts(); } },
    { t: 'Salir de la partida', f: leaveOnline },
  ]);
}

function hostPausedOverlay(on) {
  NET.hostPaused = on;
  if (mode !== 'play' || (G && G.over)) return;
  if (on) dialog('Pausa', 'El anfitrión pausó la partida. Sigue cuando vuelva.', [{ t: 'Salir de la partida', f: leaveOnline }]);
  else if (!$('dialog').hidden && $('d-title').textContent === 'Pausa') showOverlay(null);
}

function saveGame() {
  if (!G || G.demo || G.over || G.online) return;
  try { localStorage.setItem('gw-save', JSON.stringify(G)); } catch (e) { /* sin almacenamiento */ }
}
function loadGame(data) {
  const s = typeof data === 'string' ? JSON.parse(data) : data;
  if (!s || (s.v !== 1 && s.v !== 2) || !Array.isArray(s.units) || s.online) return false;
  G = migrateGame(s); ME = 0; rebuildIndex(); FX = [];
  return true;
}

let wakeSentinel = null;
async function wakeLock() {
  try { if (navigator.wakeLock && !wakeSentinel) { wakeSentinel = await navigator.wakeLock.request('screen'); wakeSentinel.addEventListener('release', () => { wakeSentinel = null; }); } } catch (e) { wakeSentinel = null; }
}

/* ---------- online: crear, unirse y sala de espera ---------- */
function myToken() {
  let t = store.get('gw-token', '');
  if (!t) { t = Math.random().toString(36).slice(2, 12); store.set('gw-token', t); }
  return t;
}
function openOnline(code) {
  $('on-name').value = SET.name || '';
  $('on-code').value = code || '';
  $('on-title').textContent = code ? `Te invitaron a la partida ${code}` : 'Jugar online';
  $('on-create').hidden = !!code;
  onlineMsg('');
  showOverlay('online');
}
function onlineMsg(t, bad) { const el = $('on-msg'); el.textContent = t || ''; el.hidden = !t; el.classList.toggle('bad', !!bad); }
function readName() {
  const n = $('on-name').value.trim().replace(/\s+/g, ' ').slice(0, 14);
  SET.name = n; refreshOpts();
  NET.name = n || 'Jugador'; NET.token = myToken();
}

function createOnline() {
  if (!onlineAvailable()) { onlineMsg('Este navegador no permite jugar online.', true); return; }
  readName();
  onlineMsg('Creando la partida…');
  hostCreate(() => showLobby(), err => { if (mode === 'lobby') { leaveOnline(); openOnline(); } onlineMsg(err, true); });
}

function joinOnline() {
  const code = $('on-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { onlineMsg('El código tiene 4 letras o números.', true); return; }
  if (!onlineAvailable()) { onlineMsg('Este navegador no permite jugar online.', true); return; }
  readName();
  onlineMsg('Conectando con la partida…');
  clientJoin(code, {
    welcome: m => { if (m.phase === 'lobby') showLobby(); },
    lobby: info => { NET.clientLobby = info; renderLobby(); },
    start: () => { enterPlay(); introToasts(); },
    end: m => showSectorEnd(m.w),
    pause: on => hostPausedOverlay(on),
    fail: msg => {
      const wasPlaying = mode === 'play' || mode === 'lobby';
      startDemo(); mode = 'title'; setPlaying(false);
      if (wasPlaying) dialog('Se cortó la conexión', msg, [
        { t: 'Reconectar', primary: true, f: () => { openOnline(code); joinOnline(); } },
        { t: 'Menú principal', f: showTitle },
      ]);
      else { openOnline(code); onlineMsg(msg, true); }
    },
  });
}

function showLobby() { mode = 'lobby'; setPlaying(false); renderLobby(); showOverlay('lobby'); }

function renderLobby() {
  if (mode !== 'lobby') return;
  const host = NET.role === 'host';
  const info = host ? lobbyInfo() : NET.clientLobby;
  $('l-code').textContent = NET.code;
  $('l-link').textContent = shareLink();
  const ul = $('l-slots');
  ul.innerHTML = '';
  if (info) info.slots.forEach((sl, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<i class="sw"></i><span class="who"></span><button class="chip team" data-i="${i}"></button>`;
    li.querySelector('.sw').style.background = TEAMS[i].color;
    const who = sl.ctl === 'ai' ? 'computadora' : (sl.pname || 'Jugador') + (i === ME ? ' (vos)' : '');
    li.querySelector('.who').textContent = `${TEAMS[i].name}: ${who}`;
    if (sl.ctl === 'ai') li.classList.add('ai');
    const b = li.querySelector('.team');
    b.textContent = ALLY_NAMES[sl.ally] || 'Sin equipo';
    b.dataset.ally = sl.ally === 10 ? 'A' : sl.ally === 11 ? 'B' : '';
    b.disabled = !host;
    ul.appendChild(li);
  });
  const humans = info ? info.slots.filter(s => s.ctl !== 'ai').length : 1;
  $('l-count').textContent = humans <= 1 ? 'Por ahora estás solo: los colores libres los maneja la computadora.' : `${humans} jugadores en la sala. Los colores libres los maneja la computadora.`;
  $('l-host').hidden = !host;
  $('l-wait').hidden = host;
  $('l-size').textContent = `Sector: ${SIZE_NAMES[info ? info.size : SET.size]}`;
  $('l-size').disabled = !host;
}

function lobbyMsg(t) { const el = $('l-msg'); el.textContent = t || ''; el.hidden = !t; }

function setAllies(fn) {
  if (NET.role !== 'host') return;
  NET.lobby.slots.forEach((s, i) => { s.ally = fn(s, i); });
  lobbyMsg('');
  hostLobbyChanged();
}

function hostStartFromLobby() {
  const groups = new Set(NET.lobby.slots.map(s => s.ally));
  if (groups.size < 2) { lobbyMsg('Tiene que haber al menos dos bandos distintos.'); return; }
  hostStartGame(1);
  enterPlay();
  introToasts();
}

async function shareInvite() {
  const url = shareLink(), text = `Sumate a mi partida de Gravity Well (código ${NET.code}):`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Gravity Well', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
}
async function copyLink() {
  try { await navigator.clipboard.writeText(shareLink()); lobbyMsg('Enlace copiado.'); }
  catch (e) {
    const r = document.createRange(); r.selectNodeContents($('l-link'));
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    lobbyMsg('Copiá el enlace seleccionado.');
  }
}

/* ---------- botones ---------- */
function bindUI() {
  bindInput();
  const on = (id, f) => $(id).addEventListener('click', e => { audioInit(); f(e); });
  on('m-new', () => startGame(1));
  on('m-continue', () => { const sv = store.get('gw-save', null); if (sv && loadGame(sv)) { enterPlay(); pause(true); } else startGame(1); });
  on('m-online', () => openOnline());
  on('m-help', () => { HELP_BACK = 'title'; showOverlay('help'); });
  on('h-close', () => showOverlay(HELP_BACK === 'dialog' && mode === 'play' ? 'dialog' : 'title'));
  on('o-sound', () => { SET.sound = !SET.sound; refreshOpts(); });
  on('o-size', () => { SET.size = (SET.size + 1) % 3; refreshOpts(); });
  on('o-vib', () => { SET.vib = !SET.vib; refreshOpts(); if (SET.vib) vibrate(30); });
  if (document.fullscreenEnabled) {
    $('o-fs').hidden = false;
    on('o-fs', async () => {
      try {
        if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }
        else await document.exitFullscreen();
      } catch (e) { /* no permitido aquí */ }
    });
  }
  // online
  on('on-create', createOnline);
  on('on-join', joinOnline);
  on('on-back', () => { netClose(); showTitle(); });
  $('on-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('on-form').addEventListener('submit', e => { e.preventDefault(); audioInit(); if ($('on-code').value) joinOnline(); else createOnline(); });
  on('l-share', shareInvite);
  on('l-copy', copyLink);
  on('l-leave', leaveOnline);
  on('l-start', hostStartFromLobby);
  on('l-size', () => { if (NET.role !== 'host') return; NET.lobby.size = (NET.lobby.size + 1) % 3; SET.size = NET.lobby.size; refreshOpts(); hostLobbyChanged(); });
  on('l-ffa', () => setAllies((s, i) => i));
  on('l-coop', () => setAllies(s => s.ctl === 'ai' ? 11 : 10));
  on('l-2v2', () => setAllies((s, i) => i < 2 ? 10 : 11));
  $('l-slots').addEventListener('click', e => {
    const b = e.target.closest('.team');
    if (!b || NET.role !== 'host') return;
    const s = NET.lobby.slots[+b.dataset.i], i = +b.dataset.i;
    s.ally = s.ally === i ? 10 : s.ally === 10 ? 11 : i;
    lobbyMsg(''); hostLobbyChanged();
  });
  // juego
  on('t-pause', () => pause(true));
  on('t-zin', () => setZoom(V.zoom * 1.3));
  on('t-zout', () => setZoom(V.zoom / 1.3));
  on('t-center', () => { setZoom(V.baseZoom); viewLeader(ME); });
  on('t-units', () => { const u = $('units'); u.hidden = !u.hidden; if (!u.hidden) renderUnits(); });
  on('u-close', () => { $('units').hidden = true; });
  $('ulist').addEventListener('click', e => { const b = e.target.closest('.unit'); if (b) { V.target = +b.dataset.id; renderUnits(); } });
  on('map-close', () => { $('map').hidden = true; });
  $('mapc').addEventListener('click', e => {
    const r = $('mapc').getBoundingClientRect(), s = Math.min(r.width, r.height);
    const wx = (e.clientX - r.left) / s * G.W, wy = (e.clientY - r.top) / s * G.W;
    let best = null, bd = 1e18;
    for (const u of G.units) { if (u.team !== ME) continue; const d = hyp(u.x - wx, u.y - wy); if (d < bd) { bd = d; best = u; } }
    if (best) V.target = best.id;
    $('map').hidden = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (mode === 'play' && G && !G.over && NET.role !== 'client') { saveGame(); if (!paused) pause(true); }
    } else {
      if (NET.role === 'client') NET.resync = true;
      if (wakeSentinel === null && mode === 'play') wakeLock();
    }
  });
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
}

/* ---------- bucle principal ---------- */
let lastT = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.3 && NET.role === 'client') NET.resync = true;
  if (dt > 0.1) dt = 0.1;
  if (!G) return;
  if (NET.role === 'client' && !G.demo) {
    if (NET.phase === 'game' && !NET.hostPaused && !G.over) clientFrame(dt);
  } else if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { step(STEP); acc -= STEP; n++; if (G.over) break; }
    if (n === 6) acc = 0;
    if (NET.role === 'host' && !G.demo) netHostTick(dt);
    if (G.demo && (G.over || G.t > 900)) { const z = V.zoom; startDemo(); V.zoom = z; }
  }
  updCamera(dt);
  render();
  hudTimer += dt;
  if (hudTimer >= 1 / 30) {
    hudTimer = 0;
    if (mode === 'play') { drawHud(); updStatus(); if (!$('map').hidden) drawMap(); }
  }
  slowTimer += dt;
  if (slowTimer >= 0.5) {
    slowTimer = 0;
    if (mode === 'play' && !paused) {
      if (unitsOpen()) renderUnits();
      const f = fighterOf(ME);
      if (f) {
        const ne = nearestEnemy(f, true);
        const near = ne && ne.d < 650;
        if (near && !proxNear) sfx('prox', null, null, 0.6, 3);
        proxNear = near ? true : (ne && ne.d < 900 ? proxNear : false);
      }
      saveTimer += 0.5;
      if (saveTimer >= 15) { saveTimer = 0; saveGame(); }
    }
  }
}

function start(data) {
  resize();
  bindUI();
  NET.name = SET.name || 'Jugador'; NET.token = myToken();
  let resumed = false;
  if (data && data.save) { try { resumed = loadGame(data.save); } catch (e) { resumed = false; } }
  if (resumed) { enterPlay(); pause(true); }
  else {
    startDemo(); showTitle();
    let code = '';
    try { code = (new URLSearchParams(location.search).get('p') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); } catch (e) { code = ''; }
    if (code && onlineAvailable()) openOnline(code);
  }
  requestAnimationFrame(t => { lastT = t; frame(t); });
}

if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
  try { window.claude.hot.snapshot(() => ({ save: G && !G.demo && !G.over && !G.online ? JSON.stringify(G) : null })); } catch (e) { /* sin recarga en caliente */ }
}
if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
