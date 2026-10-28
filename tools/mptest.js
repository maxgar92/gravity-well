// Prueba multijugador real: 3 celulares emulados, WebRTC entre ellos vía servidor PeerJS local.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
const BASE = 'http://127.0.0.1:8080/?ps=127.0.0.1:9000';
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name, w = 844, h = 390) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(name + ' PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|stun|turn|ICE|WebSocket/i.test(m.text())) page.errors.push(name + ' CONSOLE ' + m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    page.ctx = ctx; page.cdp = await ctx.newCDPSession(page);
    return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const ev = (p, f, a) => p.evaluate(f, a);
  const host = await mk('HOST');
  await host.goto(BASE); await host.waitForTimeout(600);
  await host.locator('#m-online').tap();
  await host.locator('#on-name').fill('Maxi');
  await host.locator('#on-create').tap();
  await host.locator('#lobby').waitFor({ state: 'visible', timeout: 10000 });
  const code = (await host.locator('#l-code').innerText()).trim();
  log('lobby code', code, 'link', await host.locator('#l-link').innerText());
  await shot(host, '40-host-lobby');

  const c1 = await mk('JUAN'), c2 = await mk('ANA', 390, 844);
  for (const [c, n] of [[c1, 'Juan'], [c2, 'Ana']]) {
    await c.goto(BASE + '&p=' + code); await c.waitForTimeout(500);
    log(n, 'panel title:', await c.locator('#on-title').innerText(), '| create hidden:', await c.locator('#on-create').isHidden());
    await c.locator('#on-name').fill(n);
    await c.locator('#on-join').tap();
    await c.locator('#lobby').waitFor({ state: 'visible', timeout: 15000 });
  }
  await host.waitForTimeout(800);
  log('host slots:', await host.locator('#l-slots').innerText());
  log('Juan slots:', await c1.locator('#l-slots').innerText());
  await shot(c2, '41-client-lobby-portrait');
  // equipos 2 contra 2: Azul+Rojo contra Púrpura+Amarillo
  await host.locator('#l-2v2').tap(); await host.waitForTimeout(400);
  log('after 2v2 (Ana sees):', (await c2.locator('#l-slots').innerText()).replace(/\n/g, ' | '));
  await shot(host, '42-host-lobby-2v2');
  await host.locator('#l-start').tap();
  await c1.locator('#play').waitFor({ state: 'visible', timeout: 10000 });
  await c2.locator('#play').waitFor({ state: 'visible', timeout: 10000 });
  await host.waitForTimeout(1500);
  const info = await ev(host, () => ({ teams: G.teams.map(t => [t.ctl, t.pname, t.ally]), conns: NET.conns.size }));
  log('host teams', JSON.stringify(info));
  log('client MEs', await ev(c1, () => ME), await ev(c2, () => ME));
  // contar snapshots en el cliente
  await ev(c1, () => { window.__n = 0; window.__bytes = 0; const o = window.applySnapshot; window.applySnapshot = function (m) { window.__n++; return o(m); }; });
  // Juan mantiene EMPUJE apretado 1.5 s
  const tb = await c1.locator('#b-thrust').boundingBox();
  await c1.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2, id: 0 }] });
  await c1.waitForTimeout(1500);
  const local = await ev(c1, () => { const f = U.get(NET.myF); return { st: f.st, x: Math.round(f.x), y: Math.round(f.y), spd: Math.round(Math.hypot(f.vx, f.vy)) }; });
  const onHost = await ev(host, () => { const f = fighterOf(1); return { st: f.st, x: Math.round(f.x), y: Math.round(f.y), hasRem: !!f.rem }; });
  log('Juan local fighter', JSON.stringify(local), '| as seen by host', JSON.stringify(onHost));
  const onAna = await ev(c2, () => { const f = fighterOf(1); return f && { st: f.st, x: Math.round(f.x + f.cx), y: Math.round(f.y + f.cy) }; });
  log('Juan as seen by Ana', JSON.stringify(onAna));
  await c1.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  log('snapshots received by Juan in ~1.5s:', await ev(c1, () => window.__n), '| lat est', await ev(c1, () => NET.lat.toFixed(3)));
  await shot(host, '43-host-play'); await shot(c1, '44-juan-play'); await shot(c2, '45-ana-play-portrait');
  // Juan dispara: el anfitrión debe crear disparos del equipo 1
  const fb = await c1.locator('#b-fire').boundingBox();
  await c1.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fb.x + fb.width / 2, y: fb.y + fb.height / 2, id: 0 }] });
  await c1.waitForTimeout(600);
  const hostShots = await ev(host, () => G.shots.filter(s => s.team === 1 && !s.tur).length);
  const anaShots = await ev(c2, () => G.shots.filter(s => s.team === 1 && !s.tur).length);
  await c1.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  log('Juan firing -> shots on host:', hostShots, '| on Ana:', anaShots);
  // pausa del anfitrión
  await host.locator('#t-pause').tap(); await c1.waitForTimeout(600);
  log('Juan sees pause dialog:', await c1.locator('#dialog').isVisible(), await c1.locator('#d-body').innerText());
  await host.screenshot({ path: `${OUT}/48-host-paused.png` });
  log('host dialog buttons:', JSON.stringify(await host.locator('#d-btns button').allInnerTexts()), '| dialog visible', await host.locator('#dialog').isVisible());
  await host.locator('#d-btns button', { hasText: 'Continuar' }).tap({ timeout: 5000 }); await c1.waitForTimeout(600);
  log('Juan dialog after resume visible:', await c1.locator('#dialog').isVisible());
  // Juan se va y vuelve enseguida desde el mismo teléfono (mismo almacenamiento -> mismo token)
  const juanState = await c1.ctx.storageState();
  await c1.ctx.close();
  await host.waitForTimeout(800);
  const c3ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: juanState });
  const c3 = await c3ctx.newPage(); c3.errors = []; c3.on('pageerror', e => c3.errors.push('JUAN2 ' + e.message));
  await c3.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await c3.goto(BASE + '&p=' + code); await c3.waitForTimeout(500);
  log('Juan name prefilled:', await c3.locator('#on-name').inputValue(), '| auto-join msg:', await c3.locator('#on-msg').innerText());
  if (await c3.locator('#on-join').isVisible()) await c3.locator('#on-join').tap();
  await c3.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
  await c3.waitForTimeout(1200);
  log('Juan rejoined as team', await ev(c3, () => ME), '| host teams', JSON.stringify(await ev(host, () => G.teams.map(t => t.ctl + ':' + t.pname))));
  await shot(c3, '46-juan-rejoined');
  // Ana cierra el navegador y no vuelve: el anfitrión lo detecta por el latido
  await c2.ctx.close();
  const t0 = Date.now();
  let dropped = false;
  while (Date.now() - t0 < 16000) { await host.waitForTimeout(1000); if (await ev(host, () => G.teams[2].ctl === 'ai')) { dropped = true; break; } }
  log('Ana dropped after', ((Date.now() - t0) / 1000).toFixed(1), 's ->', dropped, '| host toasts:', (await host.locator('#toasts').innerText()).replace(/\n/g, ' | '));
  log('Juan toasts:', (await c3.locator('#toasts').innerText()).replace(/\n/g, ' | '));
  // fin de sector forzado en el anfitrión
  await ev(host, () => { for (const T of G.teams) if (T.ally === 11) for (const u of G.units.slice()) if (u.team === T.id && (u.type === 'colony' || u.type === 'freighter')) removeUnit(u); });
  await c3.waitForTimeout(1500);
  log('host end dialog:', await host.locator('#d-title').innerText(), '|', await host.locator('#d-body').innerText());
  log('Juan end dialog:', await c3.locator('#d-title').innerText(), '|', await c3.locator('#d-foot').innerText());
  await shot(c3, '47-juan-end');
  await host.locator('#d-btns button', { hasText: 'Seguir al sector 2' }).tap();
  await c3.waitForTimeout(1500);
  log('sector 2: host', await ev(host, () => G.sector), '| Juan', await ev(c3, () => G.sector + ' play=' + !document.getElementById('play').hidden + ' ME=' + ME));
  const errs = [...host.errors, ...c2.errors, ...c3.errors];
  log('ERRORS', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
