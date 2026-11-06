/**
 * Tiny synthesized sound effects via Web Audio – no audio files to download.
 * The AudioContext is created lazily on the first user gesture (required on iOS).
 */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, freq: number, gain = 0.06) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
}

export type Sfx = 'deal' | 'chip' | 'check' | 'fold' | 'turn' | 'win' | 'allin';

export function play(sfx: Sfx) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (sfx) {
    case 'deal':
      noise(0, 0.07, 3200, 0.05);
      break;
    case 'chip':
      tone(1900, 0, 0.05, 'triangle', 0.05);
      tone(2500, 0.035, 0.06, 'triangle', 0.04);
      break;
    case 'check':
      noise(0, 0.05, 700, 0.09);
      noise(0.09, 0.05, 700, 0.07);
      break;
    case 'fold':
      noise(0, 0.12, 1600, 0.035);
      break;
    case 'turn':
      tone(660, 0, 0.14, 'sine', 0.06);
      tone(990, 0.1, 0.2, 'sine', 0.05);
      break;
    case 'allin':
      tone(220, 0, 0.25, 'sawtooth', 0.03);
      tone(330, 0.06, 0.3, 'triangle', 0.05);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.28, 'triangle', 0.05));
      break;
  }
}
