// 種子亂數 xoshiro128**：只用 32 位元整數運算，各裝置結果一致

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

export class Rng {
  private s = new Uint32Array(4);

  constructor(seed: number) {
    // splitmix32 把一個種子展開成 4 個狀態
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** 0 到 n-1 的整數 */
  int(n: number): number {
    return this.nextU32() % n;
  }

  /** lo 到 hi（含）的整數 */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  getState(): number[] {
    return Array.from(this.s);
  }

  setState(st: number[]): void {
    this.s.set(st);
  }
}
