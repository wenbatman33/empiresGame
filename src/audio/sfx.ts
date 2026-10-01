// 音訊（docs/07 §8.2）：程式合成音效、程式合成古風配樂、單位語音（public/assets/voice/*.m4a）
// 第一次觸控／點擊時解鎖 AudioContext（手機規定）；主音量／音樂／音效／語音各自可調

type Sfx = 'click' | 'select' | 'command' | 'build' | 'done' | 'train' | 'hit' | 'arrow' | 'die' | 'alert' | 'age' | 'win' | 'lose' | 'error' | 'skill' | 'fire' | 'collapse';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
}
const VOL_KEY = 'empiresGame.volume';
export type MusicMode = 'off' | 'peace' | 'battle';

/** 五聲音階（宮商角徵羽，D 調）的半音位置 */
const PENTA = [0, 2, 4, 7, 9];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** sfx 音效走 master 底下的 sfxGain（沿用舊名稱的 tone/hiss） */
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  vol: Volumes = { master: 0.8, music: 0.5, sfx: 0.8, voice: 0.9 };
  private voices = new Map<string, AudioBuffer | 'loading'>();
  private lastVoice = 0;
  private musicMode: MusicMode = 'off';
  private musicTimer = 0;
  private nextBeat = 0;
  private beat = 0;
  /** 旋律目前的音（五聲音階的級數） */
  private melody = 7;
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
      const v = JSON.parse(localStorage.getItem(VOL_KEY) ?? 'null');
      if (v) this.vol = { ...this.vol, ...v };
    } catch {
      /* 忽略 */
    }
  }

  setVolume(k: keyof Volumes, v: number): void {
    this.vol[k] = Math.max(0, Math.min(1, v));
    this.applyVolumes();
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(this.vol));
    } catch {
      /* 忽略 */
    }
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(this.enabled ? this.vol.master * 0.45 : 0, t, 0.05);
    this.sfxGain!.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.musicGain!.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.3);
    this.voiceGain!.gain.setTargetAtTime(this.vol.voice * 1.6, t, 0.05);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.voiceGain = this.ctx.createGain();
      for (const g of [this.sfxGain, this.musicGain, this.voiceGain]) g.connect(this.master);
      this.applyVolumes();
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
    this.applyVolumes();
    try {
      localStorage.setItem('empiresGame.sound', this.enabled ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    return this.enabled;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slide = 0, out: AudioNode | null = null, abs = false): void {
    const ctx = this.ctx!;
    const t = abs ? at : ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, freq: number, vol: number, at = 0, q = 1, out: AudioNode | null = null, abs = false): void {
    const ctx = this.ctx!;
    const t = abs ? at : ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfxGain!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** 戰鼓 */
  private drum(at: number, vol = 0.6): void {
    this.tone(90, 0.35, 'sine', vol, at, 0.5);
    this.hiss(0.12, 300, vol * 0.4, at, 0.7);
  }

  // ───────── 語音 ─────────

  /** 播一句語音（同時只播一句，最少間隔 0.8 秒）；group 例如 'sel_soldier' 會隨機挑 _1.._n */
  voice(group: string, count = 1): void {
    if (!this.enabled || !this.ensure()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastVoice < 0.8) return;
    const id = count > 1 ? `${group}_${1 + Math.floor(Math.random() * count)}` : group;
    const buf = this.voices.get(id);
    if (buf === undefined) {
      this.loadVoice(id, true);
      return;
    }
    if (buf !== 'loading') this.playVoice(buf);
  }

  private playVoice(buf: AudioBuffer): void {
    const now = this.ctx!.currentTime;
    if (now - this.lastVoice < 0.8) return;
    this.lastVoice = now;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(this.voiceGain!);
    src.start();
  }

  /** 預先載入語音檔 */
  preloadVoices(ids: string[]): void {
    for (const id of ids) if (!this.voices.has(id)) this.loadVoice(id, false);
  }

  private loadVoice(id: string, playWhenReady: boolean): void {
    this.voices.set(id, 'loading');
    fetch(`${import.meta.env.BASE_URL}assets/voice/${id}.m4a`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => {
        const ctx = this.ensure();
        return ctx ? ctx.decodeAudioData(ab) : Promise.reject(new Error('no audio'));
      })
      .then((b) => {
        this.voices.set(id, b);
        // 第一次載入：太久才載好就不播了（避免延遲很久才冒出一句）
        if (playWhenReady && this.enabled) this.playVoice(b);
      })
      .catch(() => this.voices.delete(id));
  }

  // ───────── 配樂：程式合成的古風曲（古箏撥弦 ＋ 竹笛 ＋ 戰鼓） ─────────

  setMusic(mode: MusicMode): void {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    if (mode === 'off') {
      window.clearInterval(this.musicTimer);
      this.musicTimer = 0;
      return;
    }
    if (!this.musicTimer) {
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
    }
  }

  /** 往前排 0.3 秒內要響的音 */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || this.vol.music <= 0) return;
    const battle = this.musicMode === 'battle';
    const step = battle ? 0.2 : 0.32;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.3) {
      this.musicBeat(this.nextBeat, this.beat, battle);
      this.nextBeat += step;
      this.beat++;
    }
  }

  private musicBeat(t: number, b: number, battle: boolean): void {
    const out = this.musicGain!;
    const bar = b % 16;
    const phrase = Math.floor(b / 16) % 4;
    // 低音：每小節根音（宮、徵、羽、宮）
    const roots = [50, 45, 47, 50];
    if (bar === 0 || (battle && bar === 8)) this.pluck(midi(roots[phrase] - 12), t, 2.4, 0.22, out);
    // 古箏琶音：五聲音階上下
    const arp = [0, 2, 4, 2, 1, 3, 4, 3];
    if (battle ? bar % 2 === 0 : bar % 2 === 0 && (b * 7) % 5 !== 0) {
      const deg = arp[(bar >> 1) % arp.length];
      const n = roots[phrase] + PENTA[deg % 5] + 12 * Math.floor(deg / 5);
      this.pluck(midi(n), t, 1.4, battle ? 0.12 : 0.1, out);
    }
    // 竹笛旋律（平時）：在五聲音階上隨機走一步
    if (!battle && bar % 4 === 2 && (b * 13) % 3 !== 0) {
      this.melody = Math.max(5, Math.min(12, this.melody + [-2, -1, 1, 2, 0][(b * 31) % 5]));
      const n = 62 + PENTA[this.melody % 5] + 12 * Math.floor(this.melody / 5) - 12;
      this.flute(midi(n), t, 1.1, out);
    }
    // 戰鼓（戰鬥時）
    if (battle) {
      if (bar % 4 === 0) this.tone(85, 0.35, 'sine', 0.5, t, 0.5, out, true);
      if (bar % 4 === 2 || bar === 15) this.tone(110, 0.2, 'sine', 0.3, t, 0.6, out, true);
      if (bar % 2 === 1) this.hiss(0.05, 6000, 0.05, t, 2, out, true);
    } else if (bar === 0 && phrase === 0) {
      // 平時：每四小節一聲輕鑼
      this.tone(220, 2.5, 'sine', 0.08, t, 0.98, out, true);
    }
  }

  /** 古箏撥弦：三角波 ＋ 快速衰減 ＋ 尾音微微上揚 */
  private pluck(freq: number, t: number, dur: number, vol: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.linearRampToValueAtTime(freq * 1.006, t + dur);
    o2.frequency.setValueAtTime(freq * 2, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  /** 竹笛：正弦波 ＋ 顫音 ＋ 氣音 */
  private flute(freq: number, t: number, dur: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    lfo.frequency.value = 5.5;
    lg.gain.value = freq * 0.012;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.12);
    g.gain.setValueAtTime(0.07, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
    this.hiss(dur * 0.5, 2500, 0.012, t, 1.5, out, true);
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
      case 'skill':
        // 武將技：重鼓兩下 ＋ 上揚的號角
        this.drum(0, 0.7);
        this.drum(0.16, 0.6);
        this.tone(330, 0.5, 'sawtooth', 0.1, 0.1, 1.5);
        this.hiss(0.4, 1200, 0.15, 0.05, 0.8);
        break;
      case 'collapse':
        // 建築崩塌：低沉轟隆 ＋ 碎裂聲
        this.tone(70, 0.9, 'sine', 0.35, 0, 0.5);
        this.hiss(0.9, 400, 0.3, 0, 0.6);
        this.hiss(0.4, 2200, 0.12, 0.1, 2);
        break;
      case 'fire':
        this.hiss(0.8, 600, 0.2, 0, 0.5);
        this.hiss(0.6, 1800, 0.08, 0.2, 1);
        break;
    }
  }
}

export const sfx = new Audio();
