export function hashSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= (p | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export class Rng {
  private s0: number; private s1: number;
  constructor(seed: number) {
    this.s0 = hashSeed(seed, 1) || 0x1234567; this.s1 = hashSeed(seed, 2) || 0x89abcdef;
  }
  /** xorshift128 (32-bit lanes) → [0,1) */
  next(): number {
    let s1 = this.s0; const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23; s1 ^= s1 >>> 17; s1 ^= s0; s1 ^= s0 >>> 26;
    this.s1 = s1;
    return ((this.s0 + this.s1) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(xs: readonly T[]): T { const v = xs[this.int(xs.length)]; if (v === undefined) throw new Error('pick from empty'); return v; }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = this.int(i + 1); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; }
    return xs;
  }
}
export function randomSeed(): number {
  const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0]!;
}
