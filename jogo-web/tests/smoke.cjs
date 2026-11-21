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

    // física: André não afunda e não atravessa o carro estacionado
    check('André não afunda no chão', await p.evaluate(() => window.game.player.mesh.position.y >= 0.0), `y=${(await p.evaluate(() => window.game.player.mesh.position.y)).toFixed(2)}`);
    await p.evaluate(() => { const g = window.game, v = g.myCar, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      g.player.teleport(v.pos.x - fz * 3, v.pos.z + fx * 3); g.rig.yaw = Math.atan2(-fz, fx) + Math.PI; });
    // anda reto na direção do carro (de lado) por 2 s
    await p.evaluate(() => { const g = window.game, v = g.myCar; const dx = v.pos.x - g.player.pos.x, dz = v.pos.z - g.player.pos.z; g.rig.yaw = Math.atan2(-dx, -dz); g.rig.update = () => {}; });
    await p.keyboard.down('KeyW'); await wg(2); await p.keyboard.up('KeyW');
    const gap = await p.evaluate(() => { const g = window.game, v = g.myCar, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const px = g.player.pos.x - v.pos.x, pz = g.player.pos.z - v.pos.z; return Math.abs(-px * fz + pz * fx); });
    check('André não atravessa o carro', gap >= 1.1, `distância do centro do carro: ${gap.toFixed(2)} m (meia largura 0,95 + 0,35)`);
    await p.evaluate(() => { delete window.game.rig.update; });

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

    // volante analógico: gira aos poucos (não vira tudo num quadro)
    const st = await p.evaluate(() => { const g = window.game, v = g.player.vehicle; v.steer = 0; g.input.axis.x = -1; g.input.axis.y = -0.6; g.input.axis.active = true; return 0; });
    await wg(0.1);
    const s1 = await p.evaluate(() => window.game.player.vehicle.steer);
    await wg(0.8);
    const s2 = await p.evaluate(() => { const g = window.game; const v = g.player.vehicle.steer; g.input.axis.active = false; g.input.axis.x = g.input.axis.y = 0; return v; });
    check('volante analógico suave', s1 > 0.05 && s1 < 0.9 && s2 > s1, `0,1 s: ${s1.toFixed(2)} · 0,9 s: ${s2.toFixed(2)}`);
    check('som ativo após toque', await p.evaluate(() => window.game.sound.ctx?.state === 'running'), await p.evaluate(() => window.game.sound.ctx?.state || 'sem contexto'));

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
