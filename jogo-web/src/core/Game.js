import * as THREE from 'three';
import { CONFIG, getSpawn, getHour } from '../config.js';
import { nextFrame } from './math.js';
import { Input } from './Input.js';
import { Projection } from '../map/Projection.js';
import { loadOSM } from '../map/OSMLoader.js';
import { buildWorld, uniforms } from '../map/WorldBuilder.js';
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

// Orquestra tudo: carrega o mapa real, monta física/IA/missões e roda o loop a cada quadro.
export class Game {
  async start() {
    const loading = document.getElementById('loading');
    const status = (t) => { loading.textContent = t; };
    const sp = (this.spawnInfo = getSpawn());
    this.proj = new Projection(sp.lon, sp.lat);
    this.hour = getHour();
    this.night = this.hour < 6 || this.hour >= 19;

    const canvas = document.getElementById('game');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 1500);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
    });
    this._lights();

    status('Iniciando física (Rapier3D)...');
    this.phys = await Physics.create();
    status(`Baixando ${sp.name} do OpenStreetMap...`);
    const { data, source } = await loadOSM(sp.lon, sp.lat, CONFIG.radius);
    this.source = source;
    status('Construindo a cidade em 3D...');
    await nextFrame();
    this.world = buildWorld(data, this.proj);
    this.scene.add(this.world.group);
    this.phys.addStatic(this.world.wallVerts, this.world.wallIdx);
    this.carGraph = RoadGraph.fromOSM(data, this.proj, 'car');
    this.pedGraph = RoadGraph.fromOSM(data, this.proj, 'ped');

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

    this.npc = new NPCController(this.scene, this.pedGraph, CONFIG.peds);
    this.traffic = new TrafficController(this.scene, this.carGraph, { count: CONFIG.traffic, police: CONFIG.police });
    this.wanted = new WantedSystem(this.hud);
    this.events = [];
    this.time = 0;
    this.bustT = 0;
    this.dead = false;
    this.frustum = new THREE.Frustum();
    this._v = new THREE.Vector3();
    this._mmT = 0;
    this.missions = new MissionManager(this);

    loading.style.display = 'none';
    if (source === 'fallback') this.hud.toast('Sem acesso ao OpenStreetMap — usando cidade de teste', '#ffb347');
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this._frame());
    window.game = this; // útil para depurar no console
  }

  _lights() {
    const h = this.hour, dusk = (h >= 17 && h < 19) || (h >= 5 && h < 7);
    const sky = this.night ? 0x0b1426 : dusk ? 0xe8a070 : 0x8fbce6;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 120, 650);
    uniforms.uNight.value = this.night ? 1 : 0;
    this.scene.add(new THREE.HemisphereLight(this.night ? 0x5a6a99 : 0xdfefff, 0x4a5236, this.night ? 0.9 : 1.0));
    const sun = (this.sun = new THREE.DirectionalLight(this.night ? 0x99aadd : dusk ? 0xffc28a : 0xfff4e0, this.night ? 0.7 : 2.2));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
  }

  // Ponto na calçada ao lado de um nó do grafo de pedestres.
  _sidewalk(n) {
    for (const e of n.edges) {
      const p = this.pedGraph.pointOn(n.id, e.to, 2, 1);
      if (!this.world.insideBuilding(p.x, p.z)) return p;
    }
    return { x: n.x, z: n.z };
  }

  placeOnRoad(v, node) {
    const e = node.edges[0];
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
      if (Math.abs(P.vehicle.speed) < 4) this.parked.push(P.exitVehicle(this.world.insideBuilding));
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
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const I = this.input, P = this.player;
    this.events = this.events.filter((e) => this.time - e.t < 1);

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
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
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
    this.sun.position.set(p.x + 60, 120, p.z + 40);
    this.sun.target.position.set(p.x, 0, p.z);

    const M = this.missions;
    this.hud.update(dt, {
      title: M.title, objective: this.bustT > 0 ? `Polícia te cercando! Fuja! (${(3 - this.bustT).toFixed(1)} s)` : M.objective,
      timer: M.timer, stars: this.wanted.level, health: P.health, briefcase: P.hasBriefcase,
      speed: P.vehicle ? Math.round(Math.abs(P.vehicle.speed) * 3.6) : null,
      street: (this.carGraph.streetName(p.x, p.z) || sp_name(this.spawnInfo)) + (this.source === 'fallback' ? ' (cidade de teste)' : ''),
      prompt: this.dead ? '' : this._prompt(),
    });
    if ((this._mmT -= dt) <= 0) {
      this._mmT = 0.1;
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
    I.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}

const sp_name = (s) => s.name;
