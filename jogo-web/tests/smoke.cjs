// Teste de fumaça do Auto Theft Jundiaí (estilo /smoke-check): o caminho principal do jogo funciona?
// Sem internet de propósito (usa a cidade de teste) para o resultado não depender de servidor externo.
// Uso: npm run build && npx vite preview --port 4173 & node tests/smoke.cjs [url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/?hora=12';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route(/overpass|mail\.ru|private\.coffee|openfreemap|nominatim|photon/, (r) => r.abort());
  await p.addInitScript(() => { localStorage.setItem('quality', 'baixo'); localStorage.removeItem('autotheft-save-v1'); });
  const wg = async (s) => { const t0 = await p.evaluate(() => window.game.time); await p.waitForFunction((t) => window.game.time > t, t0 + s, { timeout: 240000, polling: 200 }); };
  try {
    await p.goto(URL);
    await p.waitForSelector('#title .tt-logo', { timeout: 30000 });
    check('abertura aparece', true);
    await p.waitForFunction(() => !document.querySelector('.tt-play')?.disabled, null, { timeout: 240000 });
    check('mapa carrega e libera o JOGAR', true);
    await p.click('.tt-play');
    await p.waitForSelector('#title.intro', { timeout: 10000 });
    await p.click('.tt-intro');
    await p.waitForFunction(() => !document.getElementById('title') && !window.game.paused, null, { timeout: 20000 });
    check('introdução e início do jogo', true);

    const pos = () => p.evaluate(() => [window.game.player.pos.x, window.game.player.pos.z]);
    let a = await pos();
    await p.keyboard.down('KeyW'); await wg(1.5); await p.keyboard.up('KeyW');
    let c = await pos();
    check('André anda (W)', Math.hypot(c[0] - a[0], c[1] - a[1]) > 1, `${Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(1)} m`);

    const n0 = await p.evaluate(() => window.game.npc.peds.slice(0, window.game.npc.active).map((q) => [q.pos.x, q.pos.z]));
    await wg(2);
    const n1 = await p.evaluate(() => window.game.npc.peds.slice(0, window.game.npc.active).map((q) => [q.pos.x, q.pos.z]));
    const moved = n0.filter((q, i) => n1[i] && Math.hypot(n1[i][0] - q[0], n1[i][1] - q[1]) > 0.5).length;
    check('pedestres andam', moved >= Math.ceil(n0.length / 2), `${moved}/${n0.length}`);

    await p.evaluate(() => { const g = window.game; g.player.teleport(g.dom.x + 1, g.dom.z); });
    await wg(0.4);
    await p.keyboard.press('KeyE'); await wg(0.4);
    const bought = await p.evaluate(() => window.game.player.hasGroceries && window.game.player.money < 150);
    check('missão 1: comprar no Dom (E na porta)', bought);
    await p.evaluate(() => { const g = window.game, v = g.myCar.pos; g.player.teleport(v.x + 2.5, v.z); });
    await wg(0.5);
    await p.keyboard.press('KeyE'); await wg(0.4);
    check('entrar no carro (E)', await p.evaluate(() => !!window.game.player.vehicle));
    await wg(4.2);
    check('missão 1 concluída → missão 2', await p.evaluate(() => window.game.missions.i === 1));
    await p.keyboard.down('KeyW'); await wg(2); await p.keyboard.up('KeyW');
    check('carro acelera', await p.evaluate(() => Math.abs(window.game.player.vehicle?.speed || 0) > 4), `${(await p.evaluate(() => Math.abs(window.game.player.vehicle?.speed || 0) * 3.6)).toFixed(0)} km/h`);

    await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
    const paused = await p.evaluate(() => window.game.paused && document.getElementById('pause').classList.contains('show'));
    await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
    const resumed = await p.evaluate(() => !window.game.paused);
    check('pausa (P) abre e fecha', paused && resumed);
    await p.evaluate(() => window.game.save());
    check('progresso salvo', await p.evaluate(() => !!localStorage.getItem('autotheft-save-v1')));
  } catch (e) {
    check('execução sem travar', false, e.message.split('\n')[0]);
  }
  check('sem erros de JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  await b.close();
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${fails ? 'REPROVADO' : 'APROVADO'}: ${results.length - fails}/${results.length} verificações`);
  process.exit(fails ? 1 : 0);
})();
