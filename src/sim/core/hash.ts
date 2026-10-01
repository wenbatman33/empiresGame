// FNV-1a 32 位元雜湊：每 tick 對世界狀態算一次，用來驗證確定性與多人不同步偵測

export class Hasher {
  private h = 0x811c9dc5;

  add(v: number): this {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
      x >>>= 8;
    }
    return this;
  }

  addArray(a: ArrayLike<number>): this {
    for (let i = 0; i < a.length; i++) this.add(a[i]);
    return this;
  }

  value(): number {
    return this.h >>> 0;
  }
}
