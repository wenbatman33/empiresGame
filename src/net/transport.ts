// 傳輸層：同一台電腦的分頁（BroadcastChannel）、中繼伺服器（WebSocket）、測試用的本機假網路
import type { NetMsg } from './protocol';

export interface Transport {
  send(msg: NetMsg): void;
  onMessage: ((msg: NetMsg) => void) | null;
  onClose: (() => void) | null;
  close(): void;
  readonly kind: string;
}

/** 同一台電腦、同一個瀏覽器的不同分頁：BroadcastChannel，不需要伺服器 */
export class BroadcastTransport implements Transport {
  readonly kind = '本機分頁';
  onMessage: ((msg: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  private ch: BroadcastChannel;

  constructor(room: string) {
    this.ch = new BroadcastChannel(`empiresGame-room-${room}`);
    this.ch.onmessage = (e) => this.onMessage?.(e.data as NetMsg);
  }

  send(msg: NetMsg): void {
    this.ch.postMessage(msg);
  }

  close(): void {
    this.ch.close();
    this.onClose?.();
  }
}

/** 中繼伺服器（server/relay.mjs 或 Cloudflare Worker）：伺服器把訊息轉給同房間其他人 */
export class WsTransport implements Transport {
  readonly kind = '伺服器';
  onMessage: ((msg: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  private ws: WebSocket;
  private queue: string[] = [];

  constructor(url: string, room: string) {
    const base = url.replace(/\/$/, '');
    this.ws = new WebSocket(`${base}/room/${encodeURIComponent(room)}`);
    this.ws.onopen = () => {
      for (const m of this.queue) this.ws.send(m);
      this.queue.length = 0;
    };
    this.ws.onmessage = (e) => {
      try {
        this.onMessage?.(JSON.parse(String(e.data)) as NetMsg);
      } catch {
        /* 忽略壞掉的訊息 */
      }
    };
    this.ws.onclose = () => this.onClose?.();
  }

  get ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((ok, fail) => {
      this.ws.addEventListener('open', () => ok(), { once: true });
      this.ws.addEventListener('error', () => fail(new Error('連不上伺服器')), { once: true });
    });
  }

  send(msg: NetMsg): void {
    const s = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * 測試用的假網路：同一個程式裡多個端點，訊息經過「延遲 ＋ 抖動」才送達（不保證順序）
 * flush(now) 把到時間的訊息送出去
 */
export class LoopbackHub {
  private ends: LoopbackTransport[] = [];
  private inflight: { at: number; to: LoopbackTransport; msg: NetMsg; seq: number }[] = [];
  private seq = 0;
  now = 0;

  constructor(
    private latency = 0,
    private jitter = 0,
    private rnd: () => number = Math.random,
  ) {}

  connect(): LoopbackTransport {
    const t = new LoopbackTransport(this);
    this.ends.push(t);
    return t;
  }

  post(from: LoopbackTransport, msg: NetMsg): void {
    // JSON 往返：和真的網路一樣，收到的是複本
    const copy = JSON.parse(JSON.stringify(msg)) as NetMsg;
    for (const to of this.ends) {
      if (to === from || to.closed) continue;
      this.inflight.push({ at: this.now + this.latency + this.rnd() * this.jitter, to, msg: copy, seq: this.seq++ });
    }
  }

  flush(now: number): void {
    this.now = now;
    const due = this.inflight.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.inflight = this.inflight.filter((m) => m.at > now);
    for (const m of due) if (!m.to.closed) m.to.onMessage?.(m.msg);
  }
}

export class LoopbackTransport implements Transport {
  readonly kind = '測試';
  onMessage: ((msg: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  closed = false;

  constructor(private hub: LoopbackHub) {}

  send(msg: NetMsg): void {
    if (!this.closed) this.hub.post(this, msg);
  }

  close(): void {
    this.closed = true;
    this.onClose?.();
  }
}
