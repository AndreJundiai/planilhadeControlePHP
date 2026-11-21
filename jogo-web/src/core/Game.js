import * as THREE from 'three';
import { CONFIG, START, getSpawnOverride, getHour } from '../config.js';
import { geocode } from '../map/Geocoder.js';
import { nextFrame } from './math.js';
import { Input } from './Input.js';
import { Quality } from './Quality.js';
import { Projection } from '../map/Projection.js';
import { WorldStreamer } from '../map/WorldStreamer.js';
import { uniforms, groundMaterial, warmupMaterials } from '../map/WorldBuilder.js';
import { RoadGraph } from '../map/RoadGraph.js';
import { Physics } from '../physics/Physics.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Vehicle } from '../player/Vehicle.js';
import { NPCController } from '../ai/NPCController.js';
import { TrafficController } from '../ai/TrafficController.js';
import { WantedSystem } from '../systems/WantedSystem.js';
import { MissionManager } from '../systems/MissionManager.js';
import { HUD } from '../ui/HUD.js';
import { Profiler } from './Profiler.js';
import { loadSave, writeSave, clearSave } from '../systems/SaveGame.js';
import { PauseMenu } from '../ui/PauseMenu.js';
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
import { loadRealHuman } from '../entities/RealHuman.js';
import { RealCrowd } from '../render/RealCrowd.js';
import { sampleTimecyc, sunDirection } from '../render/Timecyc.js';
import { SkyDome } from '../render/SkyDome.js';
import { BlobShadows } from '../render/BlobShadows.js';
import { PostFX } from '../render/PostFX.js';
import { CrowdRenderer } from '../render/CrowdRenderer.js';
import { setCarEnvMap } from '../player/Vehicle.js';
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
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 700);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
      this.postfx?.setSize(innerWidth, innerHeight);
    });
    this._lights();
    this.postfx = new PostFX(r, this.scene, this.camera);

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

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.hud = new HUD(this.proj);
    this.input = new Input(canvas);
    if (isTouchDevice()) this.touch = new TouchControls(this.input, this);
    this._findDom();
    this.spawnPoint = this.dom.spawn;
    this.player = new Player(this.scene, this.phys, this.spawnPoint.x, this.spawnPoint.z);
    this.rig = new CameraRig(this.camera, this.phys);
    this.parked = [];
    const myCar = (this.myCar = new Vehicle(0xc81e1e)); // o carro do André, parado na rua do Dom
    this.placeOnRoad(myCar, this._nearestOnStreet(this.dom.x, this.dom.z, START.street, 6));
    this.scene.add(myCar.mesh);
    this.parked.push(myCar);
    this.phys.teleport(this.phys.carBody, myCar.pos.x, 0, myCar.pos.z, myCar.heading);

    this.blobs = new BlobShadows(this.scene);
    this.crowd = new CrowdRenderer(this.scene, CONFIG.maxPeds + 4);
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
    try { warmupMaterials(this.renderer, this.scene, this.camera); } catch { /* só otimização */ }
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

  // veículos parados de eventos + ônibus: entram nas colisões e no "obstáculo à frente" do trânsito
  extraCars() { return [...(this.cityEvents?.cars || []), ...(this.bus?.ok ? [this.bus] : [])]; }

  onNewDay(day) { this.hud.toast(`☀ Dia ${day} em Jundiaí`, '#ffd400'); this.save(); }

  _lights() {
    const tc = (this.tc = sampleTimecyc(this.hour));
    this.sunDir = sunDirection(this.hour);
    this.scene.background = tc.horizon.clone();
    this.scene.fog = new THREE.Fog(tc.horizon.clone(), 90, 420);
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
    setCarEnvMap(pm.fromScene(envScene, 0, 0.1, 2000).texture);
    pm.dispose();
    this.haze = !tc.night && this.hour >= 10 && this.hour <= 16 ? 1 : 0; // ondulação de calor em dia de sol
  }

  // Localiza o Dom Olívio nos comércios do mapa (ou usa o ponto achado pela busca) e a porta na calçada.
  _findDom() {
    const shop = this.streamer.places.find((p) => START.name.test(p.name));
    const x = shop ? shop.x : 0, z = shop ? shop.z : 0;
    const n = this.pedGraph.nearest(x, z), door = this._sidewalk(n);
    // André começa uns metros antes da porta, na mesma calçada
    const e = n.edges[0];
    const spawn = e ? this.pedGraph.pointOn(n.id, e.to, Math.min(9, e.len * 0.6), 1) : { x: door.x + 6, z: door.z };
    this.dom = { name: shop?.name || 'Dom Olívio', x: door.x, z: door.z, found: !!shop, spawn };
    this._domSign();
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

  // Letreiro do Dom Olívio em cima da porta.
  _domSign() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#ffd400'; g.fillRect(0, 108, 512, 20);
    g.fillStyle = '#fff'; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(this.dom.name.toUpperCase().slice(0, 16), 256, 58);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: true }));
    sign.scale.set(4, 1, 1);
    sign.position.set(this.dom.x, 4.2, this.dom.z);
    this.scene.add(sign);
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
      visible: (x, z) => this.frustum.containsPoint(this._v.set(x, 1, z)) && Math.hypot(x - p.x, z - p.z) < 180,
      pushPlayer: (dx, dz) => {
        const v = P.vehicle;
        v.pos.x += dx;
        v.pos.z += dz;
        this.phys.carBody.setTranslation({ x: v.pos.x, y: 0, z: v.pos.z }, true);
      },
      onCrash: (c, rel) => {
        this._event('crash', p.x, p.z);
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
        const imp = P.updateCar(dt, I);
        if (imp > 6) { this._event('crash', P.pos.x, P.pos.z); this.sound.crash(imp); if (imp > 12) P.health -= (imp - 12) * 2; }
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
    if (parkedHit > 3) { this._event('crash', P.pos.x, P.pos.z); this.sound.crash(parkedHit); }
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
    this.sun.position.set(p.x + this.sunDir.x * 150, this.sunDir.y * 150, p.z + this.sunDir.z * 150);
    this.sun.target.position.set(p.x, 0, p.z);
    this.skyDome.follow(this.camera);
    this.serra.follow(this.camera, this.serraXZ);
    updateTrafficLights(this.time);
    let siren = null;
    for (const c of this.traffic.police()) if (c.chasing && c.active) { const d = Math.hypot(c.v.pos.x - p.x, c.v.pos.z - p.z); if (siren === null || d < siren) siren = d; }
    this.sound.update({ driving: !!P.vehicle, speed: P.vehicle?.speed || 0, throttle: I.down('KeyW', 'ArrowUp'), drift: Math.abs(P.vehicle?.lat || 0) + (I.down('Space') && P.vehicle ? 4 : 0),
      horn: !!P.vehicle && I.down('KeyH'), siren, footSpeed: P.vehicle || this.bus.riding ? 0 : P.footSpeed, night: this.night, rain: this.clock.rain, festa: this.cityEvents.festaNear(), dt });

    // a cada 0,4 s: blocos do mapa e nome da rua (não precisa ser todo quadro)
    if ((this._slowT -= dt) <= 0) {
      this._slowT = 0.4;
      this.streamer.update(p.x, p.z);
      this.lights = this.streamer.nearbyLights(p.x, p.z, 220);
      this.streamer.updateLOD(p.x, p.z, this.quality.key === 'baixo' ? 220 : 330);
      this._street = this.carGraph.streetName(p.x, p.z) || this.spawnInfo.name;
    }

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
      mk.push(this.home.marker, ...this.cityEvents.markers(), ...this.bus.markers);
      this.hud.minimap(p.x, p.z, this.rig.yaw, P.vehicle ? P.vehicle.heading : P.heading, mk, this.carGraph);
    }
    this.hud.bubbles(this.npc.bubbles(), this.camera);
    this.prof.mark('hud');
    this._updateBlobs();
    const real = this.realCrowd.update(dt, this.npc.peds.slice(0, this.npc.active), p.x, p.z);
    this.crowd.begin();
    this.npc.draw(this.crowd, real);
    this.crowd.end();
    this.prof.mark('multidao');
    I.endFrame();
    this.postfx.render(this.time, this.haze);
    this.prof.mark('desenho');
    this.prof.end();
  }

  // Sombras simples (blob) embaixo de André, pedestres e carros próximos.
  _updateBlobs() {
    const B = this.blobs, P = this.player, p = P.pos, near = (o) => Math.hypot(o.x - p.x, o.z - p.z) < 70;
    B.begin();
    if (P.vehicle) B.add(p.x, p.z, 2.4, 5.0, P.vehicle.heading);
    else B.add(p.x, p.z, 0.9, 0.9, 0);
    for (const v of this.parked) if (near(v.pos)) B.add(v.pos.x, v.pos.z, 2.4, 5.0, v.heading);
    for (const c of this.traffic.cars) if (c.active && c.spawned && c.v.mesh.visible && near(c.v.pos)) B.add(c.v.pos.x, c.v.pos.z, 2.4, 5.0, c.v.heading);
    for (let i = 0; i < this.npc.active; i++) {
      const n = this.npc.peds[i];
      if (n.spawned && n.mesh.visible && n.state !== 'CAIDO' && near(n.pos)) B.add(n.pos.x, n.pos.z, 0.85, 0.85, 0);
    }
    for (const n of this.npc.statics) B.add(n.pos.x, n.pos.z, 0.85, 0.85, 0);
    B.end();
  }
}
