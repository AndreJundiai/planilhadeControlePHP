/**
 * Áudio 100% procedural (Web Audio API) — nenhum arquivo de som para baixar.
 *
 *  - Motor: harmônicos da explosão dos cilindros (frequência pela rotação) + ronco de escapamento em ruído
 *    filtrado + leve distorção (waveshaper) para dar aspereza; marchas com queda de giro e "estalo" na troca;
 *    cada modelo de carro tem um timbre (esportivo agudo, SUV/furgão grave).
 *  - Ambiente: reverberação de rua (impulso gerado em código), ronco distante da cidade, vento em alta
 *    velocidade, carros do trânsito passando (whoosh), passarinhos de dia, grilos à noite, chuva (mais forte no teto do carro).
 *  - Sirene brasileira de dois tons ("wail" de longe, "yelp" de perto) com Doppler.
 *  - Batidas: baque + metal (parciais inarmônicas) + cacos de vidro.
 *  - Rádio do carro (tecla R): "Rádio Jundiaí FM", música gerada na hora (bateria, baixo e acordes).
 * O navegador só libera áudio depois de um toque/tecla; start() é chamado no primeiro gesto.
 */
const TIMBRE = { // pitch base (Hz em marcha lenta), cilindros/2, aspereza, brilho do filtro
  sedan: [32, 2, 0.35, 1], hatch: [36, 2, 0.4, 1.1], suv: [26, 3, 0.45, 0.8], coupe: [42, 3, 0.6, 1.5],
  pickup: [24, 2, 0.55, 0.8], van: [27, 2, 0.4, 0.75], taxi: [32, 2, 0.35, 1], bus: [18, 3, 0.5, 0.6],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('muted') === '1'; } catch { /* sem localStorage */ }
    this.stepPhase = 0;
    this.birdT = 3;
    this.cricketT = 2;
    this.radioOn = false;
    this.lastGear = 0;
    // Android/iOS: o áudio nasce "suspenso"; cada toque tenta liberar até ele estar tocando.
    const go = () => {
      this.start();
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      if (this.ctx?.state === 'running') for (const ev of ['keydown', 'pointerdown', 'touchend', 'click']) removeEventListener(ev, go, true);
    };
    for (const ev of ['keydown', 'pointerdown', 'touchend', 'click']) addEventListener(ev, go, true); // fase de captura: botões não bloqueiam
  }

  start() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    c.resume().catch(() => {});
    const unlock = c.createBufferSource(); unlock.buffer = c.createBuffer(1, 1, 22050); unlock.connect(c.destination); unlock.start(0);

    // mixagem: tudo passa por um compressor (sem estourar) → saída
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    // reverberação de rua (envio): impulso de ruído decaindo, um pouco de "slap" dos prédios
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.8);
    this.revSend = c.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb); this.reverb.connect(this.master);
    this.noiseBuf = this._noise(2);

    this._engine();
    // pneu cantando: duas bandas estreitas que oscilam (som de borracha raspando)
    this.sq = c.createGain(); this.sq.gain.value = 0;
    for (const [f, q] of [[1650, 9], [2400, 12]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const lfo = c.createOscillator(); lfo.frequency.value = 7 + Math.random() * 4; const lg = c.createGain(); lg.gain.value = f * 0.06;
      lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      this._loopNoise().connect(bp); bp.connect(this.sq);
    }
    this.sq.connect(this.master); this.sq.connect(this.revSend);

    // buzina: dois tons quadrados com filtro (buzina de carro popular)
    this.horn = c.createGain(); this.horn.gain.value = 0;
    const hornF = c.createBiquadFilter(); hornF.type = 'lowpass'; hornF.frequency.value = 1900; hornF.Q.value = 2;
    for (const f of [415, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(this.horn); o.start(); }
    this.horn.connect(hornF); hornF.connect(this.master); hornF.connect(this.revSend);

    // sirene: oscilador principal + segundo tom, controlados no update (wail/yelp + Doppler)
    this.sir = c.createGain(); this.sir.gain.value = 0;
    this.sirO = c.createOscillator(); this.sirO.type = 'triangle'; this.sirO.frequency.value = 700;
    this.sirO2 = c.createOscillator(); this.sirO2.type = 'square'; this.sirO2.frequency.value = 700;
    const s2 = c.createGain(); s2.gain.value = 0.18;
    const sirF = c.createBiquadFilter(); sirF.type = 'lowpass'; sirF.frequency.value = 3000;
    this.sirO.connect(sirF); this.sirO2.connect(s2); s2.connect(sirF); sirF.connect(this.sir);
    this.sir.connect(this.master); this.sir.connect(this.revSend);
    this.sirO.start(); this.sirO2.start();
    this.sirPhase = 0;

    // chuva: chiado agudo + gotas graves (no teto do carro)
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    const rainF = c.createBiquadFilter(); rainF.type = 'highpass'; rainF.frequency.value = 1400;
    this._loopNoise().connect(rainF); rainF.connect(this.rainG); this.rainG.connect(this.master);
    this.roofG = c.createGain(); this.roofG.gain.value = 0;
    const roofF = c.createBiquadFilter(); roofF.type = 'bandpass'; roofF.frequency.value = 520; roofF.Q.value = 0.8;
    this._loopNoise().connect(roofF); roofF.connect(this.roofG); this.roofG.connect(this.master);

    // cidade ao longe: ronco grave + "chiado" de avenida, com variação lenta
    this.amb = c.createGain(); this.amb.gain.value = 0.05;
    const ambF = c.createBiquadFilter(); ambF.type = 'lowpass'; ambF.frequency.value = 320;
    const ambH = c.createBiquadFilter(); ambH.type = 'bandpass'; ambH.frequency.value = 900; ambH.Q.value = 0.5;
    const ambHG = c.createGain(); ambHG.gain.value = 0.25;
    this._loopNoise().connect(ambF); ambF.connect(this.amb);
    this._loopNoise().connect(ambH); ambH.connect(ambHG); ambHG.connect(this.amb);
    this.amb.connect(this.master); this.amb.connect(this.revSend);

    // vento na velocidade
    this.wind = c.createGain(); this.wind.gain.value = 0;
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.6;
    this._loopNoise().connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.master);

    // carro do trânsito passando perto (whoosh com filtro que varre)
    this.pass = c.createGain(); this.pass.gain.value = 0;
    this.passF = c.createBiquadFilter(); this.passF.type = 'bandpass'; this.passF.frequency.value = 500; this.passF.Q.value = 1.2;
    this._loopNoise().connect(this.passF); this.passF.connect(this.pass); this.pass.connect(this.master); this.pass.connect(this.revSend);

    // rádio
    this.radio = c.createGain(); this.radio.gain.value = 0;
    this.radioF = c.createBiquadFilter(); this.radioF.type = 'lowpass'; this.radioF.frequency.value = 5200; // alto-falante de carro
    this.radio.connect(this.radioF); this.radioF.connect(this.master);
    this.beat = 0; this.nextBeat = 0;
  }

  // Motor: soma de harmônicos da rotação, ronco de escapamento e distorção suave
  _engine() {
    const c = this.ctx;
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.engShape = c.createWaveShaper(); this.engShape.curve = this._curve(0.4); this.engShape.oversample = '2x';
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 900; this.engF.Q.value = 1.4;
    const sum = c.createGain(); sum.gain.value = 0.5;
    this.harm = [[1, 'sawtooth', 0.55], [2, 'square', 0.22], [0.5, 'sine', 0.6], [3, 'sawtooth', 0.12], [4.02, 'triangle', 0.08]].map(([k, type, gain]) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = 40 * k;
      const g = c.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(sum); o.start();
      return { o, k };
    });
    // ronco: ruído grave filtrado, modulado pela própria rotação (pulsos de escapamento)
    this.rumF = c.createBiquadFilter(); this.rumF.type = 'bandpass'; this.rumF.frequency.value = 120; this.rumF.Q.value = 2.5;
    this.rumG = c.createGain(); this.rumG.gain.value = 0.25;
    this._loopNoise().connect(this.rumF); this.rumF.connect(this.rumG); this.rumG.connect(sum);
    sum.connect(this.engShape); this.engShape.connect(this.engF); this.engF.connect(this.eng);
    this.eng.connect(this.master); this.eng.connect(this.revSend);
  }

  _curve(k) { // distorção suave (tanh): mais k = mais áspero
    const n = 1024, a = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; a[i] = Math.tanh(x * (1 + k * 6)) / Math.tanh(1 + k * 6); }
    return a;
  }
  _noise(sec) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  _impulse(sec, decay) { // resposta de "rua": reflexões iniciais (prédios) + cauda
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * 0.6;
      for (const t of [0.031, 0.047, 0.083, 0.11]) { const k = Math.floor((t + ch * 0.007) * c.sampleRate); if (k < n) d[k] += 0.5; }
    }
    return b;
  }
  _loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }
  _set(param, v, t = 0.08) { param.setTargetAtTime(v, this.ctx.currentTime, t); }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch { /* sem localStorage */ }
    if (this.ctx) this._set(this.master.gain, this.muted ? 0 : 0.8, 0.05);
    return this.muted;
  }
  toggleRadio() { this.radioOn = !this.radioOn; return this.radioOn; }

  /**
   * s: { driving, carType, speed (m/s), throttle (0–1), drift (m/s), horn, siren (m até a viatura que persegue ou null),
   *      sirenRel (m/s de aproximação), footSpeed, night, rain, festa, passBy (m até o carro do trânsito mais perto), dt }
   */
  update(s) {
    if (!this.ctx) return;
    const c = this.ctx, v = Math.abs(s.speed || 0), t = c.currentTime;
    // ---- motor ----
    const [idle, cyl, rough, bright] = TIMBRE[s.carType] || TIMBRE.sedan;
    const GEAR = 8.5, gear = Math.min(5, Math.floor(v / GEAR)), inGear = (v - gear * GEAR) / GEAR;
    const load = s.driving ? Math.min(1, s.throttle || 0) : 0;
    const rpm = s.driving ? 0.12 + inGear * (0.72 - gear * 0.04) + load * 0.12 : 0; // 0 = desligado, ~1 = giro alto
    if (s.driving && gear !== this.lastGear) { // troca de marcha: giro cai e um estalo curto do escapamento
      if (gear > this.lastGear && load > 0.3) this.blip(0.08, 160, 0.06);
      this.lastGear = gear;
    }
    const f0 = idle * (1 + rpm * 4.2) * (cyl / 2);
    for (const h of this.harm) this._set(h.o.frequency, f0 * h.k, 0.05);
    this._set(this.rumF.frequency, 70 + rpm * 260, 0.08);
    this._set(this.rumG.gain, 0.18 + load * 0.35 + rough * 0.2, 0.1);
    this._set(this.engF.frequency, (320 + rpm * 1700 + load * 600) * bright, 0.06);
    this._set(this.eng.gain, s.driving ? 0.06 + rpm * 0.09 + load * 0.05 : 0, 0.15);
    if (this.engShape._k !== rough) { this.engShape.curve = this._curve(rough); this.engShape._k = rough; }
    // ---- pneus, buzina, vento ----
    this._set(this.sq.gain, s.driving && s.drift > 3 && v > 6 ? Math.min(0.14, (s.drift - 3) * 0.035) : 0, 0.05);
    this._set(this.horn.gain, s.horn ? 0.08 : 0, 0.02);
    this._set(this.wind.gain, Math.min(0.12, Math.max(0, v - 8) * 0.004), 0.3);
    this._set(this.windF.frequency, 400 + v * 22, 0.3);
    // ---- sirene (dois tons brasileiros + Doppler) ----
    if (s.siren != null) {
      const near = s.siren < 45; // de perto vira "yelp" (rápido)
      this.sirPhase += s.dt * (near ? 3.2 : 0.42);
      const w = near ? Math.abs(((this.sirPhase % 1) * 2) - 1) : 0.5 - 0.5 * Math.cos(this.sirPhase * Math.PI * 2);
      const dop = 1 + Math.max(-0.08, Math.min(0.08, (s.sirenRel || 0) / 340));
      const f = (640 + w * 520) * dop;
      this._set(this.sirO.frequency, f, 0.01);
      this._set(this.sirO2.frequency, f * 1.5, 0.01);
      this._set(this.sir.gain, Math.max(0, 0.12 * (1 - s.siren / 170)), 0.15);
    } else this._set(this.sir.gain, 0, 0.3);
    // ---- ambiente ----
    this._set(this.amb.gain, s.night ? 0.03 : 0.055, 1);
    this._set(this.rainG.gain, (s.rain || 0) * (s.driving ? 0.06 : 0.16), 1.2);
    this._set(this.roofG.gain, (s.rain || 0) * (s.driving ? 0.18 : 0), 1.2);
    const pb = s.passBy ?? 99; // whoosh de carro passando perto (mais forte e agudo quanto mais perto)
    this._set(this.pass.gain, pb < 18 ? 0.09 * (1 - pb / 18) : 0, 0.12);
    this._set(this.passF.frequency, 300 + Math.max(0, 18 - pb) * 60, 0.1);
    // ---- Festa da Uva (forrozinho) ----
    if (s.festa && (this.festaT = (this.festaT ?? 0) - s.dt) <= 0) {
      this.festaT = 1.9;
      const k = Math.max(0.02, 0.07 * s.festa);
      this.jingle([[392, 0, 0.18], [440, 0.24, 0.18], [494, 0.48, 0.18], [440, 0.72, 0.18], [392, 0.96, 0.3], [330, 1.32, 0.18], [392, 1.56, 0.3]], 'square', k);
    }
    // ---- passos (variação de timbre a cada passo) ----
    if (!s.driving && s.footSpeed > 0.5) {
      this.stepPhase += s.dt * (s.footSpeed > 5 ? 3.2 : 1.9);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.blip(s.footSpeed > 5 ? 0.07 : 0.04, 700 + Math.random() * 500, 0.05); }
    }
    // ---- natureza: passarinhos de dia, grilos à noite ----
    if (!s.night && (this.birdT -= s.dt) <= 0) { this.birdT = 2 + Math.random() * 6; this.bird(); }
    if (s.night && (this.cricketT -= s.dt) <= 0) { this.cricketT = 0.6 + Math.random() * 1.4; this.cricket(); }
    // ---- rádio ----
    this._set(this.radio.gain, this.radioOn && s.driving ? 0.5 : 0, 0.3);
    if (this.radioOn && s.driving) this._radioTick(t);
  }

  // Rádio Jundiaí FM: um samba-pop simples gerado na hora (bumbo, caixa, chimbal, baixo e acordes), 104 BPM
  _radioTick(now) {
    const c = this.ctx, step = 60 / 104 / 4; // semicolcheia
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]]; // Am F G Em
    while (this.nextBeat < now + 0.25) { // agenda um pouco à frente (sem atrasos)
      const b = this.beat++, at = this.nextBeat, bar = Math.floor(b / 16) % prog.length, pos = b % 16, chord = prog[bar];
      const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
      if (pos % 4 === 0) this._drum(at, 'kick');
      if (pos === 4 || pos === 12) this._drum(at, 'snare');
      if (pos % 2 === 0) this._drum(at, 'hat');
      if ([0, 3, 6, 10, 12].includes(pos)) this._tone(at, mtof(chord[0] - 24), 0.16, 'triangle', 0.22); // baixo sincopado
      if (pos === 0 || pos === 8) for (const n of chord) this._tone(at, mtof(n), 0.5, 'sawtooth', 0.025, 1800); // acordes
      if (pos === 14 && Math.random() < 0.6) this._tone(at, mtof(chord[2] + 12), 0.12, 'square', 0.03, 2400); // enfeite
      this.nextBeat += step;
    }
  }
  _tone(at, f, dur, type, gain, cut = 4000) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cut;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(lp); lp.connect(g); g.connect(this.radio); o.start(at); o.stop(at + dur + 0.02);
  }
  _drum(at, kind) {
    const c = this.ctx, g = c.createGain();
    g.connect(this.radio);
    if (kind === 'kick') {
      const o = c.createOscillator(); o.frequency.setValueAtTime(130, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(g); o.start(at); o.stop(at + 0.22);
    } else {
      const src = c.createBufferSource(), f = c.createBiquadFilter();
      src.buffer = this.noiseBuf; f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const dur = kind === 'hat' ? 0.04 : 0.14;
      g.gain.setValueAtTime(kind === 'hat' ? 0.06 : 0.22, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(f); f.connect(g); src.start(at, Math.random()); src.stop(at + dur + 0.02);
    }
  }

  blip(gain, freq, dur) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
    src.buffer = this.noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  crash(impact) {
    if (!this.ctx) return;
    const c = this.ctx, k = Math.min(1, impact / 20), t = c.currentTime;
    this.blip(0.3 + k * 0.45, 220, 0.4 + k * 0.4); // baque
    // metal: parciais inarmônicas que somem rápido (lataria amassando)
    for (const r of [1, 2.76, 5.4, 8.93]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 180 * r * (0.95 + Math.random() * 0.1);
      g.gain.setValueAtTime((0.05 * k) / r, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3 + 0.4 / r);
      o.connect(g); g.connect(this.master); g.connect(this.revSend); o.start(t); o.stop(t + 0.8);
    }
    if (k > 0.45) for (let i = 0; i < 5; i++) setTimeout(() => this.blip(0.05 * k, 4000 + Math.random() * 3000, 0.05), 40 + i * 35 + Math.random() * 40); // cacos de vidro
  }

  bird() {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = c.createOscillator(), g = c.createGain(), t0 = t + i * 0.14, f = 2600 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 1.35, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.012, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      o.connect(g); g.connect(this.master); g.connect(this.revSend); o.start(t0); o.stop(t0 + 0.12);
    }
  }
  cricket() {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(), g = c.createGain(), t0 = t + i * 0.05;
      o.frequency.value = 4300 + Math.random() * 300;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.006, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.05);
    }
  }

  jingle(notes, type = 'triangle', gain = 0.08) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    notes.forEach(([f, at, dur]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(gain, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g); g.connect(this.master); g.connect(this.revSend); o.start(t + at); o.stop(t + at + dur + 0.02);
    });
  }
  cash() { this.jingle([[1318, 0, 0.12], [1760, 0.08, 0.3]], 'square', 0.05); }
  missionDone() { this.jingle([[523, 0, 0.18], [659, 0.15, 0.18], [784, 0.3, 0.18], [1046, 0.45, 0.4]]); }
  missionFail() { this.jingle([[392, 0, 0.25], [311, 0.22, 0.5]], 'sawtooth', 0.05); }
  ending() { // tema do FIM: arpejo que sobe e um acorde final longo
    this.jingle([[262, 0, 0.3], [330, 0.25, 0.3], [392, 0.5, 0.3], [523, 0.75, 0.5], [494, 1.3, 0.3], [440, 1.6, 0.3], [392, 1.9, 0.5], [523, 2.6, 1.8], [659, 2.6, 1.8], [784, 2.6, 1.8]], 'triangle', 0.07);
  }
}
