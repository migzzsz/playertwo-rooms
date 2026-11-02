/** Seeded random source. Every random choice in the rules goes through one, so games replay exactly. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Current internal state, so a game can be paused and resumed deterministically. */
  readonly state: number;
}

/** mulberry32: small, fast, good enough for games (not for anything security-related). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    get state() {
      return a;
    },
  };
}

/** A seed from the platform's crypto source, for real (non-replay) games. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  // Web Crypto exists in browsers and Node 19+; typed narrowly since this package has no DOM types.
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint32Array): Uint32Array } }).crypto.getRandomValues(buf);
  return buf[0] ?? 0;
}
