// Caso real: el anfitrión invita por WhatsApp y Chrome le recarga/cierra la pestaña.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
const BASE = 'http://127.0.0.1:8080/?ps=127.0.0.1:9000';
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const opts = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const errors = [];
  const watch = (p, n) => { p.on('pageerror', e => errors.push(n + ' ' + e.message)); p.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); return p; };
  const hostCtx = await browser.newContext(opts);
  let host = watch(await hostCtx.newPage(), 'HOST');
  await host.goto(BASE); await host.waitForTimeout(500);
  await host.locator('#m-online').tap(); await host.locator('#on-name').fill('Maxi'); await host.locator('#on-create').tap();
  await host.locator('#lobby').waitFor({ state: 'visible', timeout: 10000 });
  const code = (await host.locator('#l-code').innerText()).trim();
  log('1) sala creada', code);

  // A) Chrome descarta la pestaña del anfitrión mientras está en WhatsApp: la cerramos de golpe
  await host.close({ runBeforeUnload: false });
  log('2) pestaña del anfitrión cerrada (simula que Chrome la descartó)');

  // el amigo abre el enlace justo en ese momento: el anfitrión no responde
  const c1ctx = await browser.newContext(opts);
  const c1 = watch(await c1ctx.newPage(), 'JUAN');
  await c1.goto(BASE + '&p=' + code); await c1.waitForTimeout(400);
  await c1.locator('#on-name').fill('Juan'); await c1.locator('#on-join').tap();
  await c1.waitForTimeout(4000);
  log('3) Juan mientras el anfitrión no está:', await c1.locator('#on-msg').innerText());

  // el anfitrión vuelve a Chrome: la página se recarga sola (misma dirección)
  host = watch(await hostCtx.newPage(), 'HOST2');
  await host.goto(BASE); 
  await host.waitForTimeout(800);
  log('4) al volver, el anfitrión ve:', await host.locator('#d-title').isVisible() ? await host.locator('#d-title').innerText() : '(sin diálogo)');
  await host.locator('#lobby').waitFor({ state: 'visible', timeout: 60000 });
  log('5) sala recuperada con código', (await host.locator('#l-code').innerText()).trim(), '(antes', code + ')', '|', await host.locator('#l-msg').innerText());
  await c1.locator('#lobby').waitFor({ state: 'visible', timeout: 60000 });
  await host.waitForTimeout(800);
  log('6) Juan entró solo. Sala del anfitrión:', (await host.locator('#l-slots').innerText()).replace(/\n/g, ' | '));
  await host.screenshot({ path: OUT + '/50-host-recovered-lobby.png' });

  // B) ya en partida: Chrome vuelve a cerrar la pestaña del anfitrión
  await host.locator('#l-start').tap();
  await c1.locator('#play').waitFor({ state: 'visible', timeout: 10000 });
  await host.waitForTimeout(6000); // deja pasar un guardado
  const before = await host.evaluate(() => ({ t: Math.round(G.t), planets: G.planets.map(p => p.owner).join(','), juanTeam: G.teams[1].pname }));
  await host.close({ runBeforeUnload: false });
  await c1.waitForTimeout(19000);
  log('7) Juan durante el corte ve:', await c1.locator('#d-title').innerText(), '|', await c1.locator('#d-foot').innerText());
  await c1.screenshot({ path: OUT + '/51-juan-reconnecting.png' });
  host = watch(await hostCtx.newPage(), 'HOST3');
  await host.goto(BASE);
  await host.locator('#play').waitFor({ state: 'visible', timeout: 60000 });
  await host.waitForTimeout(500);
  const after = await host.evaluate(() => ({ t: Math.round(G.t), planets: G.planets.map(p => p.owner).join(','), paused, dialog: document.getElementById('d-title').textContent }));
  log('8) partida recuperada: tiempo', before.t, '->', after.t, '| planetas iguales:', before.planets === after.planets, '| pausada:', after.paused, after.dialog);
  await c1.locator('#play').waitFor({ state: 'visible', timeout: 60000 });
  await c1.waitForTimeout(1500);
  log('9) Juan volvió con el color', await c1.evaluate(() => ME), '| el anfitrión ve', JSON.stringify(await host.evaluate(() => G.teams.map(t => t.ctl + ':' + t.pname))));
  await host.locator('#d-btns button', { hasText: 'Continuar' }).tap();
  await c1.waitForTimeout(1500);
  log('10) sigue la partida: Juan recibe estado', await c1.evaluate(() => { const a = G.t; return new Promise(r => setTimeout(() => r((G.t - a).toFixed(1) + ' s avanzados en 1 s'), 1000)); }));
  await host.screenshot({ path: OUT + '/52-host-recovered-game.png' });
  // C) el anfitrión termina la partida a propósito: al recargar NO debe recuperarla
  await host.locator('#t-pause').tap(); await host.locator('#d-btns button', { hasText: 'Terminar la partida online' }).tap();
  await host.reload(); await host.waitForTimeout(1200);
  log('11) tras terminar a propósito y recargar, se ve el título:', await host.locator('#title').isVisible(), '| diálogo visible:', await host.locator('#dialog').isVisible());
  log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
