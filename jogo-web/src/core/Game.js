import * as THREE from 'three';
import { CONFIG, getSpawn, getHour } from '../config.js';
import { nextFrame } from './math.js';
import { Input } from './Input.js';
import { Quality } from './Quality.js';
import { Projection } from '../map/Projection.js';
import { WorldStreamer } from '../map/WorldStreamer.js';
import { uniforms, groundMaterial } from '../map/WorldBuilder.js';
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
import { sampleTimecyc, sunDirection } from '../render/Timecyc.js';
import { SkyDome } from '../render/SkyDome.js';
import { BlobShadows } from '../render/BlobShadows.js';
import { PostFX } from '../render/PostFX.js';
import { setCarEnvMap } from '../player/Vehicle.js';

// Orquestra tudo: mapa real em blocos, física, IA, missões, qualidade gráfica e o loop a cada quadro.
export class Game {
  async start() {
    const loading = document.getElementById('loading');
    loading.innerHTML = '<div class="ld-box"><div class="ld-text"></div><div class="ld-bar"><div class="ld-fill"></div></div><div class="ld-pct">0%</div><div class="ld-sub"></div></div>';
    const $t = loading.querySelector('.ld-text'), $f = loading.querySelector('.ld-fill'), $p = loading.querySelector('.ld-pct'), $s = loading.querySelector('.ld-sub');
    let pct = 0;
    const status = (t, p = pct, sub = '') => {
      pct = Math.max(pct, Math.min(100, p));
      $t.textContent = t;
      $f.style.width = pct.toFixed(0) + '%';
      $p.textContent = pct.toFixed(0) + '%';
      $s.textContent = sub;
    };
    const sp = (this.spawnInfo = getSpawn());
    this.proj = new Projection(sp.lon, sp.lat);
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
    this.carGraph = new RoadGraph('car');
    this.pedGraph = new RoadGraph('ped');
    this.streamer = new WorldStreamer(this);

    // Etapas da barra: servidor preparando 5-20%, download 20-85%, montagem 3D 85-100%
    status(`Pedindo o mapa de ${sp.name} ao OpenStreetMap...`, 5);
    let waitTimer = null;
    this.streamer.onProgress = (stage, f, bytes) => {
      clearInterval(waitTimer);
      if (stage === 'cache') status('Mapa encontrado no computador', 85, 'sem precisar baixar');
      else if (stage === 'wait') waitTimer = setInterval(() => status('O servidor está preparando o mapa...', Math.min(19, pct + 0.4), 'isso pode levar alguns segundos'), 400);
      else status(`Baixando o mapa de ${sp.name}...`, 20 + f * 65, `${(bytes / 1e6).toFixed(1)} MB recebidos`);
    };
    await this.streamer.loadFirst(0, 0);
    clearInterval(waitTimer);
    this.source = this.streamer.offline ? 'fallback' : 'osm';
    status('Montando a cidade em 3D...', 90, this.streamer.offline ? 'sem internet: cidade de teste' : `${this.streamer.buildings} prédios reais neste bloco`);
    await nextFrame();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.hud = new HUD(this.proj);
    this.input = new Input(canvas);
    this.spawnPoint = this._sidewalk(this.pedGraph.nearest(0, 0));
    this.player = new Player(this.scene, this.phys, this.spawnPoint.x, this.spawnPoint.z);
    this.rig = new CameraRig(this.camera, this.phys);
    this.parked = [];
    const myCar = new Vehicle(0xc81e1e); // o carro do André
    this.placeOnRoad(myCar, this.carGraph.nearest(this.spawnPoint.x, this.spawnPoint.z));
    this.scene.add(myCar.mesh);
    this.parked.push(myCar);
    this.phys.teleport(this.phys.carBody, myCar.pos.x, 0, myCar.pos.z, myCar.heading);

    this.blobs = new BlobShadows(this.scene);
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
    if (this.source === 'fallback') this.hud.toast('Sem acesso ao OpenStreetMap — usando cidade de teste', '#ffb347');
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this._frame());
    window.game = this; // útil para depurar no console
  }

  // Iluminação estilo San Andreas: cores do "timecyc" pela hora, névoa densa, sem PBR.
  _lights() {
    const tc = (this.tc = sampleTimecyc(this.hour));
    this.sunDir = sunDirection(this.hour);
    this.scene.background = tc.horizon.clone();
    this.scene.fog = new THREE.Fog(tc.horizon.clone(), 90, 420);
    uniforms.uNight.value = tc.night;
    this.scene.add(new THREE.HemisphereLight(tc.ambSky, tc.ambGround, tc.ambIntensity));
    const sun = (this.sun = new THREE.DirectionalLight(tc.sun, tc.sunIntensity));
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.skyDome = new SkyDome(tc, this.sunDir);
    this.scene.add(this.skyDome.mesh);
    // reflexo do céu só na lataria dos carros (environment map gerado uma vez)
    const envScene = new THREE.Scene();
    envScene.add(new SkyDome(tc, this.sunDir).mesh);
    const pm = new THREE.PMREMGenerator(this.renderer);
    setCarEnvMap(pm.fromScene(envScene, 0, 0.1, 2000).texture);
    pm.dispose();
    this.haze = !tc.night && this.hour >= 10 && this.hour <= 16 ? 1 : 0; // ondulação de calor em dia de sol
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
      wanted: this.wanted.level, hour: this.hour, night: this.night, time: this.time, events: this.events, parked: this.parked,
      visible: (x, z) => this.frustum.containsPoint(this._v.set(x, 1, z)) && Math.hypot(x - p.x, z - p.z) < 180,
      pushPlayer: (dx, dz) => {
        const v = P.vehicle;
        v.pos.x += dx;
        v.pos.z += dz;
        this.phys.carBody.setTranslation({ x: v.pos.x, y: 0, z: v.pos.z }, true);
      },
      onCrash: (c, rel) => {
        this._event('crash', p.x, p.z);
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
    if (this.missions.interact()) return;
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
    const m = this.missions.prompt();
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

  _respawn() {
    const P = this.player;
    P.teleport(this.spawnPoint.x, this.spawnPoint.z);
    P.health = 100;
    this.wanted.clear();
    this.traffic.resetPolice();
    this.dead = false;
    this.missions.fail('Você foi pego');
  }

  _frame() {
    const raw = this.clock.getDelta(), dt = Math.min(raw, 0.05);
    this.time += dt;
    const I = this.input, P = this.player;
    this.events = this.events.filter((e) => this.time - e.t < 1);
    this.quality.update(raw);
    if (I.hit('KeyG')) this.quality.cycle();

    if (this.dead) {
      if ((this.deadT -= dt) <= 0) this._respawn();
    } else {
      if (I.hit('KeyE') || I.hit('KeyF')) this._interact();
      if (I.hit('KeyH') && P.vehicle) this._event('horn', P.pos.x, P.pos.z);
      if (P.vehicle) {
        const imp = P.updateCar(dt, I);
        if (imp > 6) { this._event('crash', P.pos.x, P.pos.z); if (imp > 12) P.health -= (imp - 12) * 2; }
      } else P.updateFoot(dt, I, this.rig.yaw);
    }
    this.phys.step(dt);

    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this._m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const ctx = this._ctx();
    this.traffic.update(dt, ctx);
    for (const c of this.traffic.police()) if (c.chasing && c.active) this._event('siren', c.v.pos.x, c.v.pos.z);
    if (P.vehicle && Math.abs(P.vehicle.speed) > 3) {
      for (const h of this.npc.hitTest(P.vehicle)) { this.wanted.add(1, 'Atropelamento'); this._event('hit', h.pos.x, h.pos.z); }
    }
    this.npc.update(dt, ctx);
    this.wanted.update(dt, P.pos.x, P.pos.z, this.traffic.police());

    // Preso: viatura colada e jogador parado por 3 s
    const cop = this.wanted.level > 0 && this.traffic.policeNear(P.pos.x, P.pos.z, 6) && P.speed < 2;
    this.bustT = cop ? this.bustT + dt : Math.max(0, this.bustT - dt);
    if (!this.dead && this.bustT > 3) { this.bustT = 0; this._die('PRESO!'); }
    if (!this.dead && P.health <= 0) this._die('VOCÊ DESMAIOU');

    this.missions.update(dt);
    this.rig.update(dt, I, P);
    const p = P.pos;
    this.sun.position.set(p.x + this.sunDir.x * 150, this.sunDir.y * 150, p.z + this.sunDir.z * 150);
    this.sun.target.position.set(p.x, 0, p.z);
    this.skyDome.follow(this.camera);

    // a cada 0,4 s: blocos do mapa e nome da rua (não precisa ser todo quadro)
    if ((this._slowT -= dt) <= 0) {
      this._slowT = 0.4;
      this.streamer.update(p.x, p.z);
      this._street = this.carGraph.streetName(p.x, p.z) || this.spawnInfo.name;
    }

    const M = this.missions;
    this.hud.update(dt, {
      title: M.title, objective: this.bustT > 0 ? `Polícia te cercando! Fuja! (${(3 - this.bustT).toFixed(1)} s)` : M.objective,
      timer: M.timer, stars: this.wanted.level, health: P.health, briefcase: P.hasBriefcase,
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
      this.hud.minimap(p.x, p.z, this.rig.yaw, P.vehicle ? P.vehicle.heading : P.heading, mk, this.carGraph);
    }
    this.hud.bubbles(this.npc.bubbles(), this.camera);
    this._updateBlobs();
    I.endFrame();
    this.postfx.render(this.time, this.haze);
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
