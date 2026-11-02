import type { Rng } from './rng';

/** True for an integer in [lo, hi]. Actions arrive as untrusted JSON, so every field is checked. */
export function isInt(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)]!;
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function count<T>(items: readonly T[], value: T): number {
  let n = 0;
  for (const x of items) if (x === value) n++;
  return n;
}

/** Plain-object guard for action payloads. */
export function isObj(a: unknown): a is Record<string, unknown> {
  return typeof a === 'object' && a !== null;
}

/** The `first` option games accept in `init`: who moves first (the loser of the last game starts the next). */
export function firstSeat(opts: unknown): 0 | 1 {
  return isObj(opts) && opts.first === 1 ? 1 : 0;
}
