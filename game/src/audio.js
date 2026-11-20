// audio.js — Coraluna radio and effects, all WebAudio, all procedural.
export const STATIONS = [
  { id: 'SOL', freq: '98.1', name: 'SOL 98.1', genre: 'Island Pop', bpm: 112,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], bass: [36, 33, 29, 31] },
  { id: 'MAREA', freq: '104.5', name: 'MAREA 104.5', genre: 'Reggae Marea', bpm: 84,
    chords: [[62, 65, 69], [60, 64, 67], [55, 59, 62], [57, 60, 64]], bass: [38, 36, 31, 33] },
  { id: 'NOCHE', freq: '89.3', name: 'NOCHE 89.3', genre: 'Synthwave', bpm: 96,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 58, 62]], bass: [33, 29, 24, 31] },
];
const TRACKS = [
  'Mar de Coral — Los Olas', 'Paseo del Sol — Vela Roja', 'Noche en Coraluna — DJ Marea',
  'Brisa — Las Palmas', 'Tiburón Blues — El Muelle', 'Atardecer — Sol y Sal',
];

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export class Radio {
  constructor() {
    this.stationIdx = 0;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.enabled = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.trackIdx = 0;
  }

  station() { return STATIONS[this.stationIdx]; }
  stationName() { return this.station().name; }
  nowPlaying() { return TRACKS[(this.trackIdx + this.stationIdx) % TRACKS.length]; }

  nextStation() {
    this.stationIdx = (this.stationIdx + 1) % STATIONS.length;
    this.step = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.enabled = true;
      this.nextStepTime = this.ctx.currentTime + 0.1;
    } catch (e) { this.enabled = false; }
  }

  setEngine(speedKmh, inCar) {
    if (!this.enabled) return;
    try {
      const target = inCar ? 0.03 + Math.min(0.09, Math.abs(speedKmh) / 1400) : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
      this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speedKmh) * 1.1, this.ctx.currentTime, 0.1);
    } catch (e) { /* audio is best-effort */ }
  }

  setSiren(wanted) {
    if (!this.enabled) return;
    try {
      this.sirenGain.gain.setTargetAtTime(wanted > 0 ? 0.045 : 0, this.ctx.currentTime, 0.3);
      if (wanted > 0) {
        const t = this.ctx.currentTime;
        this.sirenOsc.frequency.cancelScheduledValues(t);
        this.sirenOsc.frequency.setValueAtTime(660, t);
        this.sirenOsc.frequency.linearRampToValueAtTime(880, t + 0.4);
        this.sirenOsc.frequency.linearRampToValueAtTime(660, t + 0.8);
      }
    } catch (e) { /* best-effort */ }
  }

  update(now) {
    if (!this.enabled || !this.ctx) return;
    const st = this.station();
    const stepDur = 60 / st.bpm / 4;
    try {
      while (this.nextStepTime < this.ctx.currentTime + 0.12) {
        this.scheduleStep(st, this.step, this.nextStepTime, stepDur);
        this.step++;
        this.nextStepTime += stepDur;
        if (this.step % 64 === 0) this.trackIdx++;
      }
    } catch (e) { /* best-effort */ }
  }

  scheduleStep(st, step, t, stepDur) {
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    const chord = st.chords[bar];
    if (st.id === 'MAREA' ? (beat === 4 || beat === 12) : (beat === 0 || beat === 8)) {
      this.note(midiToFreq(st.bass[bar]), t, stepDur * 2.2, 'triangle', 0.5);
    }
    if (beat % 4 === 2) {
      for (const m of chord) this.note(midiToFreq(m), t, stepDur * 1.4, 'square', 0.10);
    }
    if (bar % 2 === 0 && beat % 8 === 0) {
      this.note(midiToFreq(chord[2] + 12), t, stepDur * 2, 'sine', 0.16);
    }
    if (beat % 2 === 0) this.noise(t, 0.03, 0.05);
  }

  note(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(t, dur, vol) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(this.musicGain);
    src.start(t);
  }

  blip(freq, dur, type, vol) {
    if (!this.enabled) return;
    try { this.note(freq, this.ctx.currentTime, dur, type || 'sine', vol || 0.2); } catch (e) {}
  }
  crash(strength) {
    if (!this.enabled) return;
    try { this.noise(this.ctx.currentTime, 0.25, Math.min(0.5, 0.1 + strength * 0.02)); } catch (e) {}
  }
  gunshot() {
    if (!this.enabled) return;
    try { this.noise(this.ctx.currentTime, 0.12, 0.4); } catch (e) {}
  }
  chime() { this.blip(880, 0.15, 'sine', 0.2); setTimeout(() => this.blip(1320, 0.2, 'sine', 0.2), 120); }
}
