// Teste de fumaça do Auto Theft Jundiaí (estilo /smoke-check): o caminho principal do jogo funciona?
// Sem internet de propósito (usa a cidade de teste) para o resultado não depender de servidor externo.
// Uso: npm run build && npx vite preview --port 4173 & node tests/smoke.cjs [url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/?hora=12&mapa=teste'; // mapa=teste: ignora o mapa pré-processado (resultado sempre igual)
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

    // ---------- Jundiaí Vivo ----------
    const h0 = await p.evaluate(() => window.game.clock.hour);
    await wg(3);
    const h1 = await p.evaluate(() => window.game.clock.hour);
    check('relógio do dia anda', h1 > h0, `${h0.toFixed(3)} → ${h1.toFixed(3)} h`);
    await p.evaluate(() => { const c = window.game.clock; c.rain = c.rainTarget = 1; c.apply(); });
    await wg(0.6);
    check('chuva molha a pista e aparece', await p.evaluate(async () => { const { uniforms } = await import('/src/map/WorldBuilder.js').catch(() => ({})); return window.game.rainFx.mesh.visible; }));
    await p.evaluate(() => { const c = window.game.clock; c.rain = c.rainTarget = 0; c.weatherT = 999; c.apply(); });
    // entrega: força uma oferta, aceita com J, teleporta para retirada e entrega
    await p.evaluate(() => { const g = window.game; if (g.player.vehicle) g._interact(); g.jobs.offer = null; g.jobs.job = null; g.jobs.nextOffer = 0; });
    await wg(0.4);
    const hasOffer = await p.evaluate(() => !!window.game.jobs.offer);
    await p.keyboard.press('KeyJ'); await wg(0.3);
    const money0 = await p.evaluate(() => window.game.player.money);
    await p.evaluate(() => { const g = window.game, j = g.jobs.job; g.player.teleport(j.pickup.x + 1, j.pickup.z); });
    await wg(0.5);
    await p.evaluate(() => { const g = window.game, j = g.jobs.job; if (j) g.player.teleport(j.drop.x + 1, j.drop.z); });
    await wg(0.5);
    const money1 = await p.evaluate(() => window.game.player.money);
    check('entrega: oferta → aceitar (J) → retirar → entregar → pagamento', hasOffer && money1 > money0, `+R$ ${(money1 - money0).toFixed(2)}`);
    // casa: dormir pula para 7h do dia seguinte
    const day0 = await p.evaluate(() => window.game.clock.day);
    await p.evaluate(() => { const g = window.game; g.player.teleport(g.home.x + 1, g.home.z); });
    await wg(0.3);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(3500);
    const sl = await p.evaluate(() => ({ h: window.game.clock.hour, d: window.game.clock.day }));
    check('dormir em casa → 7h do dia seguinte', Math.abs(sl.h - 7) < 0.3 && sl.d === day0 + 1, `dia ${sl.d}, ${sl.h.toFixed(2)} h`);
    // eventos na rua
    await p.evaluate(() => { window.game.cityEvents.nextT = 0; });
    await wg(0.4);
    await p.evaluate(() => { window.game.cityEvents.nextT = 0; });
    await wg(0.4);
    const evs = await p.evaluate(() => window.game.cityEvents.list.map((e) => e.type));
    check('eventos na rua (acidente/blitz) aparecem', evs.length >= 1, evs.join(', '));
    // ônibus: espera parar num ponto, embarca e desce no próximo
    const busOk = await p.evaluate(() => window.game.bus.ok && window.game.bus.stops.length >= 2);
    let rode = false;
    if (busOk) {
      await p.evaluate(() => { const b = window.game.bus, s = b.stops[0]; b.seg = s.seg; b.t = s.t - 0.5; b.dwell = 0; b._place(true); });
      await p.waitForFunction(() => window.game.bus.dwell > 0, null, { timeout: 120000, polling: 200 });
      await p.evaluate(() => { const g = window.game, s = g.bus.at; g.player.teleport(s.x + 1, s.z); });
      await wg(0.3);
      await p.keyboard.press('KeyE'); await wg(0.3);
      const riding = await p.evaluate(() => window.game.bus.riding);
      await p.evaluate(() => { const b = window.game.bus, s = b.stops[1]; b.seg = s.seg; b.t = s.t - 0.5; b.dwell = 0; });
      await p.waitForFunction(() => window.game.bus.dwell > 0, null, { timeout: 120000, polling: 200 });
      await p.keyboard.press('KeyE'); await wg(0.3);
      rode = riding && (await p.evaluate(() => !window.game.bus.riding));
    }
    check('ônibus: embarcar no ponto e descer no próximo', busOk && rode, busOk ? '' : 'rota de ônibus não criada');
    // Festa da Uva (força o dia da festa)
    await p.evaluate(() => { const g = window.game; g.clock.day = 5; g.clock.hour = 12; });
    await wg(0.4);
    const festa = await p.evaluate(() => !!window.game.cityEvents.festa);
    let grape = false;
    if (festa) {
      await p.evaluate(() => { const g = window.game, t = g.cityEvents.festa.tents[0]; g.player.teleport(t.x + 1.5, t.z); });
      await wg(0.3);
      const m0 = await p.evaluate(() => window.game.player.money);
      await p.keyboard.press('KeyE'); await wg(0.3);
      grape = (await p.evaluate(() => window.game.player.money)) === m0 - 10;
    }
    check('Festa da Uva: barracas e compra de uva', festa && grape);

    // espera o jogo processar a tecla (no CI sem placa de vídeo um quadro pode levar quase 1 s)
    const until = (fn) => p.waitForFunction(fn, null, { timeout: 15000, polling: 100 }).then(() => true, () => false);
    await p.keyboard.down('KeyP');
    const paused = await until(() => window.game.paused && document.getElementById('pause').classList.contains('show'));
    await p.keyboard.up('KeyP');
    await p.keyboard.down('KeyP');
    const resumed = await until(() => !window.game.paused);
    await p.keyboard.up('KeyP');
    check('pausa (P) abre e fecha', paused && resumed);
    const cars = await p.evaluate(async () => {
      const { Vehicle, CAR_TYPES } = await import('/src/player/Vehicle.js').catch(() => ({ Vehicle: window.Vehicle, CAR_TYPES: null }));
      const types = CAR_TYPES || ['sedan', 'hatch', 'suv', 'coupe', 'pickup', 'van', 'taxi'];
      return types.filter((t) => { try { const v = new window.Vehicle(0x3366aa, false, t); return v.mesh.children.length === 2; } catch { return false; } });
    });
    check('7 modelos de carro (1 malha + faróis cada)', cars.length === 7, cars.join(', '));
    // passo fixo: acelerando e virando por 2 s, o carro termina no MESMO lugar a 30 e a 120 FPS
    // (a física antiga, de passo variável, errava 0,19 m e 0,023 rad entre as duas taxas)
    const steady = await p.evaluate(() => {
      const run = (fps) => {
        const v = new window.Vehicle(0xffffff, false, 'sedan');
        const inp = { axis: { active: false }, down: (...k) => k.includes('KeyW') || k.includes('KeyA') };
        const phys = { carBody: { setNextKinematicRotation() {} }, move: (c, b, col, d) => ({ pos: { x: v.pos.x + d.x, y: 0, z: v.pos.z + d.z }, moved: d }) };
        for (let i = 0; i < 2 * fps; i++) window.Vehicle.drive(v, 1 / fps, inp, phys);
        return [v.pos.x, v.pos.z, v.heading];
      };
      const a = run(30), b = run(120);
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    });
    check('carro anda igual a 30 e a 120 FPS (passo fixo)', steady < 0.02, `diferença ${steady.toFixed(3)} m`);
    // relevo: a cidade de teste tem morros sintéticos; a rua sobe e desce e o carro sente a ladeira
    const relevo = await p.evaluate(() => {
      const g = window.game, H = g.heightAt;
      let lo = Infinity, hi = -Infinity;
      for (let x = -300; x <= 300; x += 25) for (let z = -300; z <= 300; z += 25) { const h = H(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      // mesmo carro, mesmo acelerador: morro acima termina mais devagar que no plano
      const drive = (heading) => {
        const v = new window.Vehicle(0xffffff, false, 'sedan');
        const inp = { axis: { active: false }, down: (...k) => k.includes('KeyW') };
        const phys = { carBody: { setNextKinematicRotation() {} }, move: (c, b, col, d) => ({ pos: { x: v.pos.x + d.x, y: 0, z: v.pos.z + d.z }, moved: d }) };
        v.place(420, 380, heading); // longe do Dom Olívio (o terreno dele é nivelado)
        for (let i = 0; i < 120; i++) window.Vehicle.drive(v, 1 / 60, inp, phys);
        return v.speed;
      };
      let up = null, down = null;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) { const s = drive(a); if (up === null || s < up) up = s; if (down === null || s > down) down = s; }
      return { on: !!g.terrain, range: hi - lo, up, down };
    });
    check('relevo carregado (ladeiras)', relevo.on && relevo.range > 5, `desnível ${relevo.range.toFixed(1)} m na área de teste`);
    check('carro sente a ladeira (sobe mais devagar do que desce)', relevo.down - relevo.up > 0.5, `${(relevo.up * 3.6).toFixed(1)} vs ${(relevo.down * 3.6).toFixed(1)} km/h após 2 s`);
    const signs = await p.evaluate(() => window.game.landmarks.list.map((x) => x.text));
    check('letreiros dos supermercados aparecem', signs.length > 0, [...new Set(signs)].join(', '));
    const fx = await p.evaluate(() => {
      const g = window.game, P = g.particles, v = { pos: { x: 0, z: 0 }, heading: 0, speed: 14, lat: 6 };
      for (let i = 0; i < 10; i++) P.tyres(v, 0.05, { hand: true });
      P.sparks(0, 0.6, 0, 15);
      return [P.smokePool.alive, P.sparkPool.alive];
    });
    check('derrapagem solta fumaça e batida solta faíscas', fx[0] > 0 && fx[1] > 0, `fumaça ${fx[0]} · faíscas ${fx[1]}`);
    const night = await p.evaluate(() => { const g = window.game; g.clock.hour = 22; g.clock.apply(); return g.landmarks.list[0]?.face.emissiveIntensity || 0; });
    check('à noite os letreiros acendem', night > 0.5, `brilho ${night.toFixed(2)}`);
    await p.evaluate(() => window.game.save());
    // regressão (travada): ao chegar numa área nova, todos os pedestres ficavam longe e reapareciam NO MESMO quadro,
    // cada um calculando uma rota (A*). Agora no máximo 2 por quadro.
    const burst = await p.evaluate(() => {
      const g = window.game, n = g.npc, P = g.player;
      const far = { x: P.pos.x + 600, z: P.pos.z }, ctx = { ...g._ctx(), px: far.x, pz: far.z, visible: () => false };
      const before = n.peds.slice(0, n.active).map((q) => q.path);
      n.update(1 / 60, ctx);
      return n.peds.slice(0, n.active).filter((q, i) => q.path !== before[i]).length;
    });
    check('pedestres reaparecem aos poucos (sem rajada num quadro)', burst <= 2, `${burst} rotas novas num quadro`);
    // missões 5 a 8 começam e mostram objetivo; o final, ao chegar em casa, abre a tela de FIM
    const ms = await p.evaluate(() => {
      const m = window.game.missions, out = [];
      for (let i = 4; i < m.count; i++) { m.pending = null; m.start(i); m.update(0.016); out.push(m.objective ? m.current.title : 'SEM OBJETIVO: ' + m.current.title); if (i < m.count - 1) m.current.cleanup(m); }
      return { count: m.count, out };
    });
    check('8 missões (5 a 8 começam)', ms.count === 8 && ms.out.every((t) => !t.startsWith('SEM')), ms.out.join(' · '));
    await p.evaluate(() => { const g = window.game, m = g.missions; m.d.stage = 1; g.wanted.clear(); g.player.vehicle && g.player.exitVehicle(); g.player.teleport(g.home.x, g.home.z); });
    const ended = await p.waitForFunction(() => document.querySelector('#ending.show'), null, { timeout: 20000, polling: 200 }).then(() => true, () => false);
    if (ended) await p.click('#ending .en-go');
    // depois do FIM o jogo volta a rodar e a história fica concluída (o texto de modo livre vem após 3,5 s de jogo)
    const freed = ended && await p.waitForFunction(() => { const g = window.game, m = g.missions; return !g.paused && (m.i >= m.count || m.pending?.next === m.count); }, null, { timeout: 15000 }).then(() => true, () => false);
    check('final: tela de FIM e depois modo livre', ended && freed);
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
