// 程式合成音效（docs/07 §8.2 佔位版）：WebAudio 振盪器 ＋ 雜訊，不需要音檔
// 第一次觸控／點擊時解鎖 AudioContext（手機規定）

type Sfx = 'click' | 'select' | 'command' | 'build' | 'done' | 'train' | 'hit' | 'arrow' | 'die' | 'alert' | 'age' | 'win' | 'lose' | 'error';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  /** 同一種音效的冷卻（秒），避免大戰時太吵 */
  private last = new Map<Sfx, number>();

  constructor() {
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    try {
      this.enabled = localStorage.getItem('empiresGame.sound') !== '0';
    } catch {
      /* 忽略 */
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('empiresGame.sound', this.enabled ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    return this.enabled;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slide = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, freq: number, vol: number, at = 0, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** 戰鼓 */
  private drum(at: number, vol = 0.6): void {
    this.tone(90, 0.35, 'sine', vol, at, 0.5);
    this.hiss(0.12, 300, vol * 0.4, at, 0.7);
  }

  play(s: Sfx, cooldown = 0.06): void {
    if (!this.enabled || !this.ensure()) return;
    const now = this.ctx!.currentTime;
    if (now - (this.last.get(s) ?? -1) < cooldown) return;
    this.last.set(s, now);
    switch (s) {
      case 'click':
        this.tone(880, 0.05, 'triangle', 0.15);
        break;
      case 'select':
        this.tone(660, 0.06, 'triangle', 0.18);
        this.tone(990, 0.06, 'triangle', 0.12, 0.04);
        break;
      case 'command':
        this.tone(520, 0.08, 'square', 0.08);
        this.tone(780, 0.1, 'square', 0.06, 0.06);
        break;
      case 'build':
        this.hiss(0.08, 900, 0.25);
        this.tone(220, 0.06, 'square', 0.08);
        break;
      case 'done':
        // 鑼聲
        this.tone(330, 1.2, 'sine', 0.3);
        this.tone(495, 1.0, 'sine', 0.12);
        this.tone(660, 0.8, 'sine', 0.06);
        break;
      case 'train':
        this.tone(440, 0.08, 'triangle', 0.15);
        this.tone(660, 0.12, 'triangle', 0.15, 0.08);
        break;
      case 'hit':
        this.hiss(0.07, 2500, 0.18, 0, 2);
        this.tone(1400 + Math.random() * 600, 0.05, 'square', 0.04);
        break;
      case 'arrow':
        this.hiss(0.18, 3500, 0.09, 0, 4);
        break;
      case 'die':
        this.tone(160, 0.25, 'sawtooth', 0.06, 0, 0.5);
        break;
      case 'alert':
        // 號角
        this.tone(294, 0.5, 'sawtooth', 0.12);
        this.tone(392, 0.6, 'sawtooth', 0.1, 0.35);
        break;
      case 'age':
        for (let k = 0; k < 4; k++) this.drum(k * 0.22, 0.5 + k * 0.08);
        this.tone(330, 1.6, 'sine', 0.3, 0.9);
        this.tone(440, 1.4, 'sine', 0.15, 0.95);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.5, 'triangle', 0.2, k * 0.18));
        this.drum(0);
        this.drum(0.54);
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, k) => this.tone(f, 0.6, 'sine', 0.2, k * 0.25));
        break;
      case 'error':
        this.tone(180, 0.15, 'square', 0.08);
        break;
    }
  }
}

export const sfx = new Audio();
