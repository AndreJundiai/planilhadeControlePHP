import * as THREE from 'three';
import { CONFIG, START, getSpawnOverride, getHour } from '../config.js';
import { geocode } from '../map/Geocoder.js';
import { nextFrame } from './math.js';
import { Input } from './Input.js';
import { Quality } from './Quality.js';
import { Projection } from '../map/Projection.js';
import { WorldStreamer } from '../map/WorldStreamer.js';
import { uniforms, groundMaterial, warmupMaterials, setWaterEnvMap } from '../map/WorldBuilder.js';
import { Landmarks } from '../map/Landmarks.js';
import { DomOlivio, DOM } from '../map/DomOlivio.js';
import { Particles } from '../render/Particles.js';
import { setAnisotropy, signTexture } from '../render/ProceduralTextures.js';
import { loadTerrain, heightAt, TerrainGround, flattenArea } from '../render/Terrain.js';
import { RoadGraph } from '../map/RoadGraph.js';
import { Physics } from '../physics/Physics.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Vehicle, driveArcade } from '../player/Vehicle.js';
import { NPCController } from '../ai/NPCController.js';
import { TrafficController } from '../ai/TrafficController.js';
import { WantedSystem } from '../systems/WantedSystem.js';
import { MissionManager } from '../systems/MissionManager.js';
import { HUD } from '../ui/HUD.js';
import { Profiler } from './Profiler.js';
import { loadSave, writeSave, clearSave } from '../systems/SaveGame.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { Ending } from '../ui/Ending.js';
import { resolveOnFoot, resolveParked } from '../systems/Collisions.js';
import { Clock, RainFX } from '../live/Clock.js';
import { Jobs } from '../live/Jobs.js';
import { Home } from '../live/Home.js';
import { CityEvents } from '../live/CityEvents.js';
import { Bus } from '../live/Bus.js';
import { SerraDoJapi, SERRA } from '../render/SerraDoJapi.js';
import { TitleScreen } from '../ui/TitleScreen.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';
import { Sound } from '../audio/Sound.js';
import { loadRealHuman, makeRealHuman, REAL_VARIANTS } from '../entities/RealHuman.js';
import { RealCrowd } from '../render/RealCrowd.js';
import { sampleTimecyc, sunDirection } from '../render/Timecyc.js';
import { SkyDome } from '../render/SkyDome.js';
import { BlobShadows } from '../render/BlobShadows.js';
import { PostFX } from '../render/PostFX.js';
import { CrowdRenderer } from '../render/CrowdRenderer.js';
import { setCarEnvMap, setCarLightsNight } from '../player/Vehicle.js';
import { setFurnitureNight, updateTrafficLights } from '../map/StreetFurniture.js';

// Orquestra tudo: mapa real em blocos, física, IA, missões, qualidade gráfica e o loop a cada quadro.
export class Game {
  async start() {
    const loading = document.getElementById('loading');
    loading.innerHTML = '<div class="ld-box"><div class="ld-text"></div><div class="ld-bar"><div class="ld-fill"></div></div><div class="ld-pct">0%</div><div class="ld-sub"></div></div>';
    const $t = loading.querySelector('.ld-text'), $f = loading.querySelector('.ld-fill'), $p = loading.querySelector('.ld-pct'), $s = loading.querySelector('.ld-sub');
    let pct = 0;
    // abertura: aparece na hora; o mapa carrega por trás
    this.paused = true;
    this.title = new TitleScreen({
      onPlay: (save) => this.play(save),
      save: loadSave(),
      onNew: () => clearSave(),
      onQuality: () => this._titleQuality(),
      onSound: () => this.sound?.toggleMute(),
      qualityLabel: () => this.quality ? this.quality.p.label + (this.quality.auto ? ' (auto)' : '') : this._savedQuality(),
      soundLabel: () => (this.sound?.muted ? 'Desligado' : 'Ligado'),
    });
    const status = (t, p = pct, sub = '') => {
      pct = Math.max(pct, Math.min(100, p));
      this.title?.progress(pct, t);
      $t.textContent = t;
      $f.style.width = pct.toFixed(0) + '%';
      $p.textContent = pct.toFixed(0) + '%';
      $s.textContent = sub;
    };
    // ponto de partida: Dom Olívio, na Rua do Retiro (procurado uma vez e salvo)
    status('Procurando o Dom Olívio na Rua do Retiro...', 1);
    let sp = getSpawnOverride();
    if (!sp) {
      const g = await geocode(START.queries);
      sp = g ? { name: START.label, lat: g.lat, lon: g.lon, found: g.query } : { ...CONFIG.presets.jundiai, notFound: true };
    }
    this.spawnInfo = sp;
    this.proj = new Projection(sp.lon, sp.lat);
    this.serraXZ = this.proj.toXZ(SERRA.lon, SERRA.lat);
    uniforms.uCentro.value.set(...this.proj.toXZ(-46.8845, -23.1866)); // Catedral / Centro de Jundiaí
    this.hour = getHour();
    this.night = this.hour < 6 || this.hour >= 19;

    const canvas = document.getElementById('game');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap; // sombras de borda suave
    r.shadowMap.autoUpdate = false; // o mapa de sombra é redesenhado só quando precisa (ver _shadowUpdate)
    setAnisotropy(r.capabilities.getMaxAnisotropy()); // texturas do chão nítidas olhando de lado
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 700);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
      this.postfx?.setSize(innerWidth, innerHeight);
      this.particles?.resize(innerHeight, this.camera.fov);
    });
    this._lights();
    this.postfx = new PostFX(r, this.scene, this.camera);

    status('Carregando o relevo de Jundiaí (ladeiras e morros)...', 2);
    try {
      const teste = new URLSearchParams(location.search).get('mapa') === 'teste';
      this.terrain = await loadTerrain(this.proj, { synthetic: teste });
      if (this.terrain) console.info('relevo', this.terrain);
    } catch (e) { console.warn('relevo não carregou (chão plano)', e); this.terrain = null; }
    status('Iniciando física (Rapier3D)...', 2);
    this.phys = await Physics.create();
    status('Carregando pessoas realistas...', 3);
    try { await loadRealHuman(); } catch (e) { console.warn('modelo realista não carregou', e); }
    this.sound = new Sound();
    this.carGraph = new RoadGraph('car');
    this.pedGraph = new RoadGraph('ped');
    this.streamer = new WorldStreamer(this);

    // Etapas da barra: servidor preparando 5-20%, download 20-85%, montagem 3D 85-100%
    status(`Pedindo o mapa de ${sp.name} ao OpenStreetMap...`, 5);
    this.streamer.onProgress = (stage, f, bytes, info = {}) => {
      if (stage === 'cache') status('Mapa de Jundiaí já salvo no computador', 85, 'não precisa baixar de novo');
      else if (stage === 'wait') {
        // a barra continua andando devagar (nunca fica parada) e mostra os segundos e o servidor
        const secs = info.secs || 0;
        status(`Esperando ${info.label || 'o servidor'}... ${secs} s`, 5 + 14 * (1 - Math.exp(-secs / 20)),
          `tentando ${info.tried || 1} de ${info.total || 1} servidores · se demorar, entra o próximo sozinho`);
        if (secs >= 15) $skip.style.display = 'inline-block';
      } else status(`Baixando o mapa de ${sp.name}...`, 20 + f * 65, `${(bytes / 1e6).toFixed(1)} MB recebidos · ${info.label || ''}`);
    };
    const $skip = document.createElement('button');
    $skip.className = 'ld-skip';
    $skip.textContent = 'Jogar agora (cidade de teste)';
    $skip.onclick = () => { $skip.disabled = true; this.streamer.skipFirst?.abort(); };
    loading.querySelector('.ld-box').appendChild($skip);
    await this.streamer.loadFirst(0, 0);
    this.source = this.streamer.offline ? 'fallback' : 'osm';
    status('Montando a cidade em 3D...', 90, this.streamer.offline ? 'sem internet: cidade de teste' : `${this.streamer.buildings} prédios reais neste bloco`);
    await nextFrame();

    // chão: grade de 1,6 km que acompanha o jogador e mostra as ladeiras (com relevo) — ou plano sem ele
    this.ground = new TerrainGround(this.scene, groundMaterial());

    this.hud = new HUD(this.proj);
    this.input = new Input(canvas);
    if (isTouchDevice()) this.touch = new TouchControls(this.input, this);
    status('Montando o Empório Dom Olívio...', 93);
    await this._findDom();
    this.spawnPoint = this.dom.spawn;
    this.player = new Player(this.scene, this.phys, this.spawnPoint.x, this.spawnPoint.z);
    this.rig = new CameraRig(this.camera, this.phys);
    this.rig.heightAt = heightAt; // a câmera sobe e desce com o terreno
    this.heightAt = heightAt; // console e testes
    this.parked = [];
    const myCar = (this.myCar = new Vehicle(0xc81e1e)); // o carro do André, parado na rua do Dom
    this.placeOnRoad(myCar, this._nearestOnStreet(this.dom.x, this.dom.z, START.street, 6));
    this.scene.add(myCar.mesh);
    this.parked.push(myCar);
    this.phys.teleport(this.phys.carBody, myCar.pos.x, 0, myCar.pos.z, myCar.heading);

    this.blobs = new BlobShadows(this.scene);
    this.particles = new Particles(this.scene, isTouchDevice());
    this.particles.resize(innerHeight, this.camera.fov);
    this.landmarks = new Landmarks(this);
    this.landmarks.scan();
    this.crowd = new CrowdRenderer(this.scene, CONFIG.maxPeds + 24); // + funcionários e clientes do Dom
    this.realCrowd = new RealCrowd(this.scene);
    this.npc = new NPCController(this.scene, this.pedGraph, CONFIG.maxPeds);
    this.traffic = new TrafficController(this.scene, this.carGraph, { count: CONFIG.maxTraffic, police: CONFIG.police });
    this.wanted = new WantedSystem(this.hud);
    this.quality = new Quality(this);
    this.quality.apply();
    this.events = [];
    this.time = 0;
    this.bustT = 0;
    this.dead = false;
    this.frustum = new THREE.Frustum();
    this._m4 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._mmT = 0;
    this._slowT = 0;
    this._street = '';
    this.missions = new MissionManager(this);
    this.ending = new Ending(this); // tela de FIM depois da missão final
    this.streamer.update(0, 0); // começa a carregar os blocos vizinhos em segundo plano

    status('Pronto!', 100);
    loading.style.display = 'none';
    // Jundiaí Vivo: relógio ao vivo, chuva, entregas, casa, eventos na rua e ônibus
    const urlHour = new URLSearchParams(location.search).get('hora');
    this.clock = new Clock(this, urlHour !== null ? +urlHour : 7, 1);
    this.rainFx = new RainFX(this.scene, this.touch ? 500 : 1400);
    this.jobs = new Jobs(this);
    this.home = new Home(this);
    this.cityEvents = new CityEvents(this);
    this.bus = new Bus(this);
    try { warmupMaterials(this.renderer, this.scene, this.camera); await this._warmShaders(); } catch (e) { console.warn('pré-aquecimento', e); /* só otimização */ }
    this.title.ready(); // botão JOGAR liberado
    this.prof = new Profiler(r);
    this.pause = new PauseMenu(this);
    this._saveT = 15;
    // PC: soltar o mouse (Esc) durante o jogo abre a pausa
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && !this.paused && !this.touch) this.pause.show(); });
    if (this.source === 'fallback') this.hud.toast('Sem acesso ao mapa — usando cidade de teste', '#ffb347');
    else if (this.spawnInfo.notFound) this.hud.toast('Não achei o Dom Olívio na internet — começando no centro', '#ffb347');
    this.frameTimer = new THREE.Clock();
    r.setAnimationLoop(() => this._frame());
    window.game = this; // útil para depurar no console
    window.Vehicle = Vehicle;
    window.Vehicle.drive = driveArcade; // usado pelo teste de passo fixo
  }

  // Iluminação estilo San Andreas: cores do "timecyc" pela hora, névoa densa, sem PBR.
  // JOGAR na abertura: libera o jogo e repete a ligação da missão atual (ela tocou atrás do título)
  play(save = null) {
    this.paused = false;
    this.frameTimer.getDelta();
    this.sound?.start();
    if (save) { // continuar de onde parou
      this.player.money = save.money;
      if (save.day) { this.clock.day = save.day; this.clock.hour = save.hour ?? 7; this.clock.apply(); }
      this.jobs.done = save.jobs || 0;
      this.player.teleport(save.x, save.z);
      this.missions.start(Math.min(save.mission, this.missions.count));
      this.hud.toast('Jogo carregado', '#9fd3ff');
    } else if (!this.missions.pending) this.missions.start(this.missions.i);
  }

  save() { if (!this.paused || this.menuPaused) writeSave(this); }

  _savedQuality() {
    try { const q = localStorage.getItem('quality'); return q ? { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' }[q] : 'Automático'; } catch { return 'Automático'; }
  }

  _titleQuality() {
    if (this.quality) return this.quality.cycle();
    const order = [null, 'baixo', 'medio', 'alto'];
    let cur = null;
    try { cur = localStorage.getItem('quality'); } catch { /* sem localStorage */ }
    const next = order[(order.indexOf(cur) + 1) % order.length];
    try { if (next) localStorage.setItem('quality', next); else localStorage.removeItem('quality'); } catch { /* sem localStorage */ }
  }

  // Compila AGORA, atrás da tela de título, cada variante de shader que o jogo vai usar: todos os
  // modelos de carro (e a viatura com sirene), faróis, fumaça, faíscas, dia e noite, com sombras.
  // Sem isso, cada coisa nova travava o jogo na primeira vez que aparecia (~0,7 s no PC; mais no celular).
  async _warmShaders() {
    const t0 = performance.now(), cam = this.camera, fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const base = cam.position.clone().addScaledVector(fwd, 14), protos = [];
    for (const [i, t] of ['sedan', 'hatch', 'suv', 'coupe', 'pickup', 'van', 'taxi'].entries()) {
      const v = new Vehicle(0x8899aa, false, t);
      v.place(base.x + (i - 3) * 2.5, base.z, 0);
      protos.push(v);
    }
    const cop = new Vehicle(0xf4f4f4, true, 'sedan');
    cop.place(base.x, base.z + 5, 0); cop.siren(true, 0.1);
    protos.push(cop);
    for (const v of protos) { v.mesh.traverse((o) => { o.frustumCulled = false; }); this.scene.add(v.mesh); }
    // pessoas realistas animadas (malha com esqueleto = variante própria de shader), com e sem roupa trocada
    const people = [];
    try {
      for (const variant of [null, REAL_VARIANTS[0]]) { const h = makeRealHuman(variant); h.root.position.set(base.x, 0, base.z + 2); h.mixer.update(0.1); this.scene.add(h.root); people.push(h.root); }
    } catch { /* modelo realista não carregou */ }
    // totem de letreiro (textura + emissiva) e o que está escondido agora (marcador de missão, chuva, halos)
    const tex = signTexture('JUNDIAÍ', '', '#1f4fa8');
    const totem = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff }));
    totem.position.copy(base);
    this.scene.add(totem);
    // tudo o que já está na cena (totens, árvores, blocos fora da câmera) entra no desenho de aquecimento
    const culled = [], hidden = [];
    this.scene.traverse((o) => {
      if (!o.visible && o !== this.scene && (o.isMesh || o.isPoints || o.isLine)) { o.visible = true; hidden.push(o); }
      if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.frustumCulled = false; culled.push(o); }
    });
    this.particles.sparks(base.x, 0.6, base.z, 12);
    this.particles.smoke(base.x, base.z, 0, 0, 1, 0);
    const hour = this.clock.hour, before = this.renderer.info.programs.length;
    for (const h of [12, 22, hour]) { // dia, noite (faróis, janelas, letreiros) e de volta à hora certa
      this.clock.hour = h; this.clock.apply();
      this.renderer.shadowMap.needsUpdate = true;
      this.postfx.render(0, 0);
      await nextFrame();
    }
    for (const v of protos) this.scene.remove(v.mesh);
    for (const r of people) this.scene.remove(r);
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
    this.scene.remove(totem);
    this._warmKeep = totem; // não liberar: dispose() do material apagaria o shader que acabou de compilar
    console.info(`shaders pré-compilados: ${this.renderer.info.programs.length - before} novos em ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // veículos parados de eventos + ônibus: entram nas colisões e no "obstáculo à frente" do trânsito
  extraCars() { return [...(this.cityEvents?.cars || []), ...(this.bus?.ok ? [this.bus] : [])]; }

  onNewDay(day) { this.hud.toast(`☀ Dia ${day} em Jundiaí`, '#ffd400'); this.save(); }

  _lights() {
    const tc = (this.tc = sampleTimecyc(this.hour));
    this.sunDir = sunDirection(this.hour);
    this.scene.background = tc.horizon.clone();
    this.scene.fog = new THREE.FogExp2(tc.horizon.clone(), 2 / 420); // neblina exponencial (densidade pela qualidade)
    uniforms.uNight.value = tc.night;
    uniforms.uSky.value.copy(tc.horizon).lerp(tc.skyTop, 0.35); // cor refletida nas poças
    setFurnitureNight(tc.night > 0.5);
    this.hemi = new THREE.HemisphereLight(tc.ambSky, tc.ambGround, tc.ambIntensity);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(tc.sun, tc.sunIntensity));
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.skyDome = new SkyDome(tc, this.sunDir);
    this.scene.add(this.skyDome.mesh);
    this.serra = new SerraDoJapi();
    this.scene.add(this.serra.mesh);
    // reflexo do céu só na lataria dos carros (environment map gerado uma vez)
    const envScene = new THREE.Scene();
    envScene.add(new SkyDome(tc, this.sunDir).mesh);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromScene(envScene, 0, 0.1, 2000).texture;
    setCarEnvMap(env);
    setWaterEnvMap(env); // lagos refletem o mesmo céu
    pm.dispose();
    // Luzes noturnas reais (número fixo desde o início: ligar/desligar só muda a intensidade, sem recompilar
    // shaders). No celular ficam de fora: lá a noite usa só halos e faróis falsos, que não custam nada.
    this.nightLights = [];
    if (!isTouchDevice()) {
      const head = (this.headlight = new THREE.SpotLight(0xfff0d0, 0, 55, 0.42, 0.55, 1.1)); // farol do carro do André
      this.scene.add(head, head.target);
      for (let i = 0; i < 4; i++) { // 4 postes mais próximos iluminam de verdade o chão e os carros
        const L = new THREE.PointLight(0xffc27a, 0, 24, 1.4);
        L.position.set(0, -50, 0);
        this.scene.add(L);
        this.nightLights.push(L);
      }
    }
    this.haze = !tc.night && this.hour >= 10 && this.hour <= 16 ? 1 : 0; // ondulação de calor em dia de sol
  }

  // Localiza o Dom Olívio nos comércios do mapa (ou usa o ponto achado pela busca) e ergue o prédio
  // modelado (DomOlivio.js) de frente para a rua: terreno nivelado, prédios genéricos do mapa retirados
  // dali e os blocos em volta reconstruídos (tudo atrás da tela de título).
  async _findDom() {
    const shop = this.streamer.places.find((p) => START.name.test(p.name));
    const x = shop ? shop.x : 0, z = shop ? shop.z : 0;
    const n = this._nearestOnStreet(x, z, START.street);
    let e = n.edges.reduce((a, b) => (b.len > (a?.len || 0) ? b : a), null);
    const o = e ? this.carGraph.nodes.get(e.to) : null;
    let dx = o ? o.x - n.x : 1, dz = o ? o.z - n.z : 0;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    let nx = -dz, nz = dx; // normal da rua apontando para o lado da loja
    if ((x - n.x) * nx + (z - n.z) * nz < 0) { nx = -nx; nz = -nz; }
    const along0 = shop ? (x - n.x) * dx + (z - n.z) * dz : 0, h = Math.atan2(-nx, -nz);
    // desliza ao longo da rua até achar o lugar onde nenhuma outra rua atravessa o prédio
    const intrusions = (o) => {
      const c = Math.cos(o.h), s = Math.sin(o.h);
      let k = 0;
      for (const a of this.carGraph.nodesNear(o.x, o.z, 140)) for (const e of a.edges) {
        const b = this.carGraph.nodes.get(e.to); if (!b) continue;
        for (let t = 0; t <= 1; t += 0.1) {
          const px = a.x + (b.x - a.x) * t - o.x, pz = a.z + (b.z - a.z) * t - o.z, lx = px * c - pz * s, lz = px * s + pz * c;
          if (Math.abs(lx) < DOM.W / 2 + 4 && lz < 3 && lz > -DOM.D - 4) k++;
        }
      }
      return k;
    };
    let origin = null, best = Infinity;
    for (let off = 0; off <= 70 && best > 0; off += 2) for (const sg of off ? [1, -1] : [1]) {
      const al = along0 + off * sg, o = { x: n.x + dx * al + nx * DOM.SET, z: n.z + dz * al + nz * DOM.SET, h };
      const k = intrusions(o);
      if (k < best) { best = k; origin = o; }
      if (k === 0) break;
    }
    const R = DomOlivio.footprint(origin);
    flattenArea(R); // terraplenagem: a loja fica no plano
    await this.streamer.excludeArea(R); // sem prédio genérico do mapa em cima do Dom
    this.domModel = new DomOlivio(this, origin);
    const c = this.domModel.counterWorld;
    this.dom = { name: shop?.name || 'Dom Olívio', x: c.x, z: c.z, found: !!shop, spawn: this.domModel.spawnWorld, door: this.domModel.doorWorld };
  }

  // Nó de rua mais perto de (x,z), dando preferência a ruas cujo nome bate com `street` (Rua do Retiro).
  _nearestOnStreet(x, z, street, minDist = 0) {
    let best = null, bd = Infinity;
    for (const n of this.carGraph.nodesNear(x, z, 150)) {
      const d = Math.hypot(n.x - x, n.z - z) - (n.edges.some((e) => street.test(e.name)) ? 60 : 0);
      if (Math.hypot(n.x - x, n.z - z) >= minDist && d < bd) { bd = d; best = n; }
    }
    return best || this.carGraph.nearest(x, z);
  }

  // Ponto na calçada ao lado de um nó do grafo de pedestres.
  _sidewalk(n) {
    for (const e of n.edges) {
      const p = this.pedGraph.pointOn(n.id, e.to, 2, 1);
      if (!this.streamer.insideBuilding(p.x, p.z)) return p;
    }
    return { x: n.x, z: n.z };
  }

  placeOnRoad(v, node) {
    const e = node.edges[0];
    if (!e) { v.place(node.x, node.z, 0); return; }
    const p = this.carGraph.pointOn(node.id, e.to, Math.min(6, e.len / 2), 1);
    v.place(p.x, p.z, p.h);
  }

  _ctx() {
    const P = this.player, p = P.pos;
    return {
      px: p.x, pz: p.z, speed: P.speed, inVehicle: !!P.vehicle, onFoot: !P.vehicle, playerVeh: P.vehicle,
      lights: this.lights, wanted: this.wanted.level, hour: this.hour, night: this.night, time: this.time, events: this.events, parked: this.parked.concat(this.extraCars()),
      visible: (x, z) => this.frustum.containsPoint(this._v.set(x, 1 + heightAt(x, z), z)) && Math.hypot(x - p.x, z - p.z) < 180,
      pushPlayer: (dx, dz) => {
        const v = P.vehicle;
        v.pos.x += dx;
        v.pos.z += dz;
        this.phys.carBody.setTranslation({ x: v.pos.x, y: 0, z: v.pos.z }, true);
      },
      onCrash: (c, rel) => {
        this._event('crash', p.x, p.z);
        this.particles.sparks((p.x + c.v.pos.x) / 2, 0.7, (p.z + c.v.pos.z) / 2, rel);
        this.sound.crash(rel);
        if (c.kind === 'traffic' && rel > 9) this.wanted.add(1, 'Colisão grave');
        if (c.kind === 'police' && rel > 5) this.wanted.add(1, 'Bateu na viatura');
        if (c.kind === 'target') c.v.health -= Math.max(0, rel - 5) * 7;
        if (rel > 8) P.health -= (rel - 8) * 2;
      },
      onRunOver: (c, spd) => {
        P.health -= spd * 2.5;
        this._event('crash', p.x, p.z);
        this.hud.toast('Você foi atropelado!', '#ff8080');
      },
    };
  }

  _event(type, x, z) { this.events.push({ type, x, z, t: this.time }); }

  _interact() {
    const P = this.player;
    if (P.vehicle) {
      if (Math.abs(P.vehicle.speed) < 4) this.parked.push(P.exitVehicle((x, z) => this.streamer.insideBuilding(x, z)));
      this._trimParked();
      return;
    }
    if (this.bus.interact()) return;
    if (this.missions.interact()) return;
    if (this.home.interact() || this.cityEvents.interact() || this._domSnack()) return;
    let best = null, bd = 3.6;
    for (const v of this.parked) { const d = Math.hypot(v.pos.x - P.pos.x, v.pos.z - P.pos.z); if (d < bd) { bd = d; best = v; } }
    if (best) {
      this.parked = this.parked.filter((v) => v !== best);
      P.enterVehicle(best);
      return;
    }
    const c = this.traffic.nearestCar(P.pos.x, P.pos.z, 4);
    if (c) {
      const v = this.traffic.take(c);
      this._event('carjack', v.pos.x, v.pos.z);
      if (this.traffic.policeNear(P.pos.x, P.pos.z, 60)) this.wanted.add(1, 'Roubo de veículo');
      this.hud.toast('Você pegou o carro!');
      P.enterVehicle(v);
    }
  }

  _trimParked() {
    const p = this.player.pos;
    const keep = new Set([this.missions.d.car].filter(Boolean));
    while (this.parked.length > 6) {
      let far = null, fd = -1;
      for (const v of this.parked) { const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z); if (!keep.has(v) && d > fd) { fd = d; far = v; } }
      if (!far) break;
      this.scene.remove(far.mesh);
      this.parked = this.parked.filter((v) => v !== far);
    }
  }

  _prompt() {
    const P = this.player;
    const m = this.bus.prompt() || this.missions.prompt() || this.home.prompt() || this.cityEvents.prompt() || this._domSnackPrompt();
    if (m) return m;
    if (P.vehicle) return Math.abs(P.vehicle.speed) < 4 ? '[E] Sair do veículo' : '';
    if (this.parked.some((v) => Math.hypot(v.pos.x - P.pos.x, v.pos.z - P.pos.z) < 3.6)) return '[E] Entrar no carro';
    if (this.traffic.nearestCar(P.pos.x, P.pos.z, 4)) return '[E] Pegar este carro';
    return '';
  }

  _die(text) {
    this.dead = true;
    this.deadT = 3;
    this.hud.toast(text, '#ff3030');
  }

  // lanche no Dom Olívio depois da primeira missão
  _domNear() { return this.missions.i >= 1 && !this.player.vehicle && Math.hypot(this.player.pos.x - this.dom.x, this.player.pos.z - this.dom.z) < 3.5; }
  _domSnackPrompt() { return this._domNear() ? `[E] Lanche no ${this.dom.name} (R$ 12,00)` : ''; }
  _domSnack() {
    if (!this._domNear()) return false;
    const P = this.player;
    if (P.money < 12) { this.hud.toast('Dinheiro insuficiente', '#ff5050'); return true; }
    P.money -= 12; P.health = Math.min(100, P.health + 30);
    this.sound.cash();
    this.hud.toast('Coxinha e café no Dom! +30 de vida — R$ 12,00', '#7dff7d');
    return true;
  }

  _respawn() {
    const P = this.player;
    // acorda em casa, perde 20% do dinheiro e algumas horas do dia
    if (this.bus.riding) { this.bus.riding = false; P.mesh.visible = true; P.collider.setEnabled(true); }
    P.teleport(this.home.x + 1.5, this.home.z);
    P.money = Math.round(P.money * 80) / 100;
    this.clock.hour = (this.clock.hour + 3) % 24;
    this.hud.call('Casa', `Você acordou em casa. Perdeu 20% do dinheiro (agora R$ ${P.money.toFixed(2).replace('.', ',')}).`);
    P.health = 100;
    this.wanted.clear();
    this.traffic.resetPolice();
    this.dead = false;
    this.missions.fail('Você foi pego');
  }

  _frame() {
    const raw = this.frameTimer.getDelta(), dt = Math.min(raw, 0.05);
    if (this.input.hit('KeyP')) { if (this.menuPaused) this.pause.resume(); else if (!this.paused) this.pause.show(); }
    if (this.paused) { // atrás da tela de título / pausa: só desenha a cidade
      this.rig.update(dt, this.input, this.player);
      this.skyDome.follow(this.camera);
      this.input.endFrame();
      this.postfx.render(this.time, 0);
      return;
    }
    this.touch?.update();
    this.prof.begin();
    if (this.input.hit('F3')) this.prof.toggle();
    this.time += dt;
    const I = this.input, P = this.player;
    this.events = this.events.filter((e) => this.time - e.t < 1);
    this.quality.update(raw);
    if (I.hit('KeyG')) this.quality.cycle();
    if (I.hit('KeyM')) this.hud.toast(this.sound.toggleMute() ? 'Som desligado (M)' : 'Som ligado (M)');

    if (this.dead) {
      if ((this.deadT -= dt) <= 0) this._respawn();
    } else {
      if (I.hit('KeyE') || I.hit('KeyF')) this._interact();
      if (I.hit('KeyH') && P.vehicle) this._event('horn', P.pos.x, P.pos.z);
      if (P.vehicle) {
        const imp = P.updateCar(dt, I), v = P.vehicle;
        if (imp > 6) {
          this._event('crash', P.pos.x, P.pos.z); this.sound.crash(imp); if (imp > 12) P.health -= (imp - 12) * 2;
          const fx = Math.sin(v.heading), fz = Math.cos(v.heading), back = this._lastSpeed < 0 ? -1 : 1;
          this.particles.sparks(v.pos.x + fx * 2.2 * back, 0.6, v.pos.z + fz * 2.2 * back, imp, fx * back, fz * back);
        }
        if (v) {
          const ax = I.axis;
          this.particles.tyres(v, dt, {
            throttle: ax.active ? Math.max(0, -ax.y) : I.down('KeyW', 'ArrowUp') ? 1 : 0,
            brake: ax.active ? Math.max(0, ax.y) : I.down('KeyS', 'ArrowDown') ? 1 : 0,
            hand: I.down('Space'), wet: this.clock?.rain || 0,
          });
          this._lastSpeed = v.speed;
        }
      } else if (!this.bus.riding) P.updateFoot(dt, I, this.rig.yaw);
      if (I.hit('KeyJ')) this.jobs.accept();
    }
    this.prof.mark('jogador');
    this.phys.step(dt);
    this.prof.mark('fisica');

    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this._m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const ctx = this._ctx();
    this.traffic.update(dt, ctx);
    resolveOnFoot(this);
    const parkedHit = resolveParked(this);
    if (parkedHit > 3) { this._event('crash', P.pos.x, P.pos.z); this.sound.crash(parkedHit); if (parkedHit > 5) this.particles.sparks(P.pos.x, 0.6, P.pos.z, parkedHit); }
    this.prof.mark('transito');
    for (const c of this.traffic.police()) if (c.chasing && c.active) this._event('siren', c.v.pos.x, c.v.pos.z);
    if (P.vehicle && Math.abs(P.vehicle.speed) > 3) {
      for (const h of this.npc.hitTest(P.vehicle)) { this.wanted.add(1, 'Atropelamento'); this._event('hit', h.pos.x, h.pos.z); }
    }
    this.npc.update(dt, ctx);
    this.prof.mark('pedestres');
    this.wanted.update(dt, P.pos.x, P.pos.z, this.traffic.police());

    // Preso: viatura colada e jogador parado por 3 s
    const cop = this.wanted.level > 0 && this.traffic.policeNear(P.pos.x, P.pos.z, 6) && P.speed < 2;
    this.bustT = cop ? this.bustT + dt : Math.max(0, this.bustT - dt);
    if (!this.dead && this.bustT > 3) { this.bustT = 0; this._die('PRESO!'); }
    if (!this.dead && P.health <= 0) this._die('VOCÊ DESMAIOU');

    this.prof.mark('policia');
    if ((this._saveT -= dt) <= 0) { this._saveT = 15; this.save(); }
    this.clock.update(dt);
    this.jobs.update(dt);
    this.cityEvents.update(dt);
    this.bus.update(dt);
    this.rainFx.update(dt, this.camera, this.clock.rain);
    this.missions.update(dt);
    this.rig.update(dt, I, P);
    const p = P.pos;
    this._shadowUpdate(p);
    this.skyDome.follow(this.camera);
    this.serra.follow(this.camera, this.serraXZ);
    uniforms.uTime.value = this.time;
    this.particles.update(dt);
    this._nightLightsUpdate();
    this.ground.update(p.x, p.z);
    this.domModel?.update(dt, p.x, p.z);
    updateTrafficLights(this.time);
    let siren = null, sirenRel = 0, passBy = 99;
    for (const c of this.traffic.police()) if (c.chasing && c.active) {
      const d = Math.hypot(c.v.pos.x - p.x, c.v.pos.z - p.z);
      if (siren === null || d < siren) { siren = d; sirenRel = ((this._sirD ?? d) - d) / Math.max(dt, 1e-3); }
    }
    this._sirD = siren;
    for (const c of this.traffic.cars) if (c.active && c.spawned && Math.abs(c.v.speed) > 4) passBy = Math.min(passBy, Math.hypot(c.v.pos.x - p.x, c.v.pos.z - p.z));
    if (I.hit('KeyR')) this.hud.toast(this.sound.toggleRadio() ? '📻 Rádio Jundiaí FM (R)' : '📻 Rádio desligado (R)', '#9fd3ff');
    const ax = I.axis;
    this.sound.update({ driving: !!P.vehicle, carType: P.vehicle?.type, speed: P.vehicle?.speed || 0,
      throttle: ax.active ? Math.max(0, -ax.y) : I.down('KeyW', 'ArrowUp') ? 1 : 0, drift: Math.abs(P.vehicle?.lat || 0) + (I.down('Space') && P.vehicle ? 4 : 0),
      horn: !!P.vehicle && I.down('KeyH'), siren, sirenRel, passBy, footSpeed: P.vehicle || this.bus.riding ? 0 : P.footSpeed, night: this.night, rain: this.clock.rain, festa: this.cityEvents.festaNear(), dt });

    // tarefas lentas do mundo, UMA por quadro em rodízio (antes eram todas juntas a cada 0,4 s e
    // davam um soluço de ~15 ms num celular). Cada uma ainda roda umas 10 vezes por segundo.
    // os quarteirões são pedidos por TEMPO (0,4 s), não por quadro: num celular lento o mapa não pode atrasar
    if ((this._slowT -= dt) <= 0) { this._slowT = 0.4; this.streamer.update(p.x, p.z); }
    const slow = this._slowTasks ??= [
      () => { this.lights = this.streamer.nearbyLights(p.x, p.z, 220); },
      () => this.streamer.updateLOD(p.x, p.z, this.quality.key === 'baixo' ? 220 : 330),
      () => { this._street = this.carGraph.streetName(p.x, p.z) || this.spawnInfo.name; },
      () => this.landmarks.update(p.x, p.z),
      () => { this._lamps = this.nightLights.length ? this.streamer.nearbyLamps(p.x, p.z, this.nightLights.length) : []; },
    ];
    this._slowI = ((this._slowI ?? -1) + 1) % slow.length;
    slow[this._slowI]();

    const M = this.missions;
    this.prof.mark('mundo');
    this.hud.update(dt, {
      title: M.title, objective: this.bustT > 0 ? `Polícia te cercando! Fuja! (${(3 - this.bustT).toFixed(1)} s)` : M.objective,
      clock: `${this.clock.label} · Dia ${this.clock.day}${this.clock.rain > 0.15 ? ' · 🌧' : this.night ? ' · 🌙' : ' · ☀'}`, job: this.jobs.line,
      timer: M.timer, stars: this.wanted.level, health: P.health, briefcase: P.hasBriefcase, groceries: P.hasGroceries, money: P.money,
      speed: P.vehicle ? Math.round(Math.abs(P.vehicle.speed) * 3.6) : null,
      street: this._street + (this.streamer.offline ? ' (cidade de teste)' : ''),
      prompt: this.dead ? '' : this._prompt(),
      perf: `Gráficos: ${this.quality.p.label}${this.quality.auto ? ' (auto)' : ''} · ${this.quality.fps} FPS · G muda` +
        (this.streamer.pending ? ` · carregando ${this.streamer.pending} bloco(s) do mapa...` : ''),
    });
    if ((this._mmT -= dt) <= 0) {
      this._mmT = 0.12;
      const mk = [];
      for (const c of this.traffic.cars) {
        if (!c.active || !c.spawned) continue;
        if (c.kind === 'police') mk.push({ x: c.v.pos.x, z: c.v.pos.z, color: c.chasing && Math.floor(this.time * 4) % 2 ? '#ff3030' : '#3060ff', r: 6 });
      }
      for (const v of this.parked) mk.push({ x: v.pos.x, z: v.pos.z, color: '#cccccc', r: 4 });
      if (M.marker) mk.push({ x: M.marker.x, z: M.marker.z, color: M.marker.color, r: 9, edge: true });
      if (this.jobs.marker) mk.push(this.jobs.marker);
      mk.unshift(...this.landmarks.markers(p.x, p.z)); // mercados e pontos turísticos (embaixo dos outros)
      mk.push(this.home.marker, ...this.cityEvents.markers(), ...this.bus.markers);
      this.hud.minimap(p.x, p.z, this.rig.yaw, P.vehicle ? P.vehicle.heading : P.heading, mk, this.carGraph);
    }
    this.hud.bubbles(this.npc.bubbles().map((b) => ({ ...b, y: b.y + heightAt(b.x, b.z) })), this.camera);
    this.prof.mark('hud');
    this._updateBlobs();
    const real = this.realCrowd.update(dt, this.npc.peds.slice(0, this.npc.active), p.x, p.z);
    this.crowd.begin();
    this.npc.draw(this.crowd, real);
    this.domModel?.draw(this.crowd);
    this.crowd.end();
    this.prof.mark('multidao');
    I.endFrame();
    this.postfx.render(this.time, this.haze, P.vehicle?.speed || 0);
    this.prof.mark('desenho');
    this.prof.end();
  }

  // Sombra do sol no estilo dos jogos de mundo aberto: a câmera de sombra anda em degraus do tamanho
  // de um texel (a sombra não "tremula" ao andar) e o mapa só é redesenhado a cada 2–3 quadros ou quando
  // o jogador anda/o sol muda — o passe de sombra deixa de custar todo quadro.
  _shadowUpdate(p) {
    const sun = this.sun, sh = sun.shadow, cam = sh.camera;
    const texel = (cam.right - cam.left) / sh.mapSize.x * 2;
    const sx = Math.round(p.x / texel) * texel, sz = Math.round(p.z / texel) * texel;
    const sy = Math.round(heightAt(p.x, p.z));
    sun.position.set(sx + this.sunDir.x * 150, sy + this.sunDir.y * 150, sz + this.sunDir.z * 150);
    sun.target.position.set(sx, sy, sz);
    if (!sun.castShadow) return;
    // entre duas atualizações o jogo usa o mapa e a matriz antigos juntos, então a sombra continua no lugar
    this._shF = (this._shF || 0) + 1;
    const sunMoved = !this._shD || this._shD.distanceToSquared(this.sunDir) > 1e-6;
    const fast = Math.abs(this.player.vehicle?.speed || 0) > 12; // em alta velocidade a sombra do carro não pode atrasar muito
    const every = fast ? 2 : this.quality.key === 'alto' ? 2 : 3;
    if (sunMoved || this._shF % every === 0) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shD = (this._shD || this.sunDir.clone()).copy(this.sunDir);
    }
  }

  // Faróis do carro do André (SpotLight real) e os 4 postes mais próximos (PointLight) à noite.
  _nightLightsUpdate() {
    const k = uniforms.uNight.value, v = this.player.vehicle;
    if (this.headlight) {
      if (v && k > 0.35) {
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const hx = v.pos.x + fx * 2.3, hz = v.pos.z + fz * 2.3, tx = v.pos.x + fx * 16, tz = v.pos.z + fz * 16;
        this.headlight.position.set(hx, 0.85 + heightAt(hx, hz), hz);
        this.headlight.target.position.set(tx, heightAt(tx, tz), tz);
        this.headlight.intensity = 28 * k;
      } else this.headlight.intensity = 0;
    }
    this.nightLights.forEach((L, i) => {
      const lp = this._lamps?.[i];
      if (lp && k > 0.35) { L.position.set(lp[1], 6.2 + heightAt(lp[1], lp[2]), lp[2]); L.intensity = 45 * k; } else L.intensity = 0;
    });
  }

  // Sombras simples (blob) embaixo de André e dos pedestres; carros só quando a sombra real está desligada.
  _updateBlobs() {
    const B = this.blobs, P = this.player, p = P.pos, near = (o) => Math.hypot(o.x - p.x, o.z - p.z) < 70, carBlob = !this.sun.castShadow;
    B.begin();
    if (P.vehicle) { if (carBlob) B.add(p.x, p.z, 2.4, 5.0, P.vehicle.heading); }
    else B.add(p.x, p.z, 0.9, 0.9, 0);
    if (carBlob) {
      for (const v of this.parked) if (near(v.pos)) B.add(v.pos.x, v.pos.z, 2.4, 5.0, v.heading);
      for (const c of this.traffic.cars) if (c.active && c.spawned && c.v.mesh.visible && near(c.v.pos)) B.add(c.v.pos.x, c.v.pos.z, 2.4, 5.0, c.v.heading);
    }
    for (let i = 0; i < this.npc.active; i++) {
      const n = this.npc.peds[i];
      if (n.spawned && n.mesh.visible && n.state !== 'CAIDO' && near(n.pos)) B.add(n.pos.x, n.pos.z, 0.85, 0.85, 0);
    }
    for (const n of this.npc.statics) B.add(n.pos.x, n.pos.z, 0.85, 0.85, 0);
    B.end();
  }
}
