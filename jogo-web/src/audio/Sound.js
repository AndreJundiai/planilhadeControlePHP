/**
 * Procedural game audio with the Web Audio API — no sound files to download.
 * Engine (pitch follows speed and throttle), tyre squeal, horn, police siren (by distance),
 * footsteps, crashes, city ambience (+ birds by day) and UI jingles.
 * Browsers only allow audio after a click/key press, so start() is called on the first input.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('muted') === '1'; } catch { /* sem localStorage */ }
    this.stepPhase = 0;
    this.birdT = 3;
    const go = () => { this.start(); removeEventListener('keydown', go); removeEventListener('pointerdown', go); };
    addEventListener('keydown', go);
    addEventListener('pointerdown', go);
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(c.destination);
    this.noiseBuf = this._noise(2);

    // motor: duas ondas + filtro passa-baixa
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 700;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.o1.connect(this.engF); this.o2.connect(g2); g2.connect(this.engF);
    this.engF.connect(this.eng); this.eng.connect(this.master);
    this.o1.start(); this.o2.start();

    // pneu cantando: ruído em banda estreita
    this.sq = c.createGain(); this.sq.gain.value = 0;
    const sqF = c.createBiquadFilter(); sqF.type = 'bandpass'; sqF.frequency.value = 1800; sqF.Q.value = 6;
    this._loopNoise().connect(sqF); sqF.connect(this.sq); this.sq.connect(this.master);

    // buzina
    this.horn = c.createGain(); this.horn.gain.value = 0;
    for (const f of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(this.horn); o.start(); }
    const hornF = c.createBiquadFilter(); hornF.type = 'lowpass'; hornF.frequency.value = 2000;
    this.horn.disconnect(); this.horn.connect(hornF); hornF.connect(this.master);

    // sirene: tom que sobe e desce (LFO)
    this.sir = c.createGain(); this.sir.gain.value = 0;
    this.sirO = c.createOscillator(); this.sirO.type = 'sawtooth'; this.sirO.frequency.value = 850;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.45;
    const lfoG = c.createGain(); lfoG.gain.value = 330;
    lfo.connect(lfoG); lfoG.connect(this.sirO.frequency);
    const sirF = c.createBiquadFilter(); sirF.type = 'lowpass'; sirF.frequency.value = 2500;
    this.sirO.connect(sirF); sirF.connect(this.sir); this.sir.connect(this.master);
    this.sirO.start(); lfo.start();

    // ambiente de cidade: ruído grave e abafado
    this.amb = c.createGain(); this.amb.gain.value = 0.06;
    const ambF = c.createBiquadFilter(); ambF.type = 'lowpass'; ambF.frequency.value = 380;
    this._loopNoise().connect(ambF); ambF.connect(this.amb); this.amb.connect(this.master);
  }

  _noise(sec) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  _loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; }
  _set(param, v, t = 0.08) { param.setTargetAtTime(v, this.ctx.currentTime, t); }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch { /* sem localStorage */ }
    if (this.ctx) this._set(this.master.gain, this.muted ? 0 : 0.7, 0.05);
    return this.muted;
  }

  /** s: { driving, speed (m/s), throttle (0/1), drift (m/s), horn, siren (m to nearest chasing cop or null), footSpeed, night, dt } */
  update(s) {
    if (!this.ctx) return;
    const v = Math.abs(s.speed || 0);
    // marcha simulada: o tom sobe e "cai" a cada troca
    const gear = Math.min(4, Math.floor(v / 9)), inGear = (v - gear * 9) / 9;
    const rpm = s.driving ? 0.18 + inGear * 0.62 + (s.throttle ? 0.15 : 0) : 0;
    this._set(this.o1.frequency, 38 + rpm * 120 + gear * 6);
    this._set(this.o2.frequency, (38 + rpm * 120 + gear * 6) * 0.5);
    this._set(this.engF.frequency, 300 + rpm * 1400);
    this._set(this.eng.gain, s.driving ? 0.07 + rpm * 0.1 : 0, 0.15);
    this._set(this.sq.gain, s.driving && s.drift > 3 && v > 6 ? Math.min(0.12, (s.drift - 3) * 0.03) : 0, 0.05);
    this._set(this.horn.gain, s.horn ? 0.09 : 0, 0.02);
    this._set(this.sir.gain, s.siren != null ? Math.max(0, 0.11 * (1 - s.siren / 150)) : 0, 0.2);
    this._set(this.amb.gain, s.night ? 0.035 : 0.06, 1);
    // passos
    if (!s.driving && s.footSpeed > 0.5) {
      this.stepPhase += s.dt * (s.footSpeed > 5 ? 3.2 : 1.9);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.blip(s.footSpeed > 5 ? 0.06 : 0.035, 900, 0.05); }
    }
    // passarinhos de dia
    if (!s.night && (this.birdT -= s.dt) <= 0) { this.birdT = 2 + Math.random() * 6; this.bird(); }
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
    const k = Math.min(1, impact / 20);
    this.blip(0.25 + k * 0.45, 300, 0.35 + k * 0.4);
    this.blip(0.15 * k, 2400, 0.15); // vidro/metal
  }

  bird() {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = c.createOscillator(), g = c.createGain(), t0 = t + i * 0.14, f = 2600 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 1.35, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.012, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.12);
    }
  }

  jingle(notes, type = 'triangle', gain = 0.08) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    notes.forEach(([f, at, dur]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(gain, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g); g.connect(this.master); o.start(t + at); o.stop(t + at + dur + 0.02);
    });
  }
  cash() { this.jingle([[1318, 0, 0.12], [1760, 0.08, 0.3]], 'square', 0.05); }
  missionDone() { this.jingle([[523, 0, 0.18], [659, 0.15, 0.18], [784, 0.3, 0.18], [1046, 0.45, 0.4]]); }
  missionFail() { this.jingle([[392, 0, 0.25], [311, 0.22, 0.5]], 'sawtooth', 0.05); }
}
