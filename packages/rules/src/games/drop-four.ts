import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat } from '../util';

/** Drop Four: 7 columns × 6 rows, upright. Ported from prototype/games.js. */
export const COLS = 7;
export const ROWS = 6;

export interface DropFourState {
  /** 42 cells, row-major from the top: -1 empty, 0 or 1. */
  g: number[];
  t: Seat;
  /** Index of the last disc dropped, -1 before the first move. */
  last: number;
  w: Outcome;
  /** Winning line cell indices, or null. */
  line: number[] | null;
}

export interface DropFourAction {
  c: number;
}

const CENTRE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const COLUMN_WEIGHTS = [1, 2, 3, 5, 3, 2, 1];
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function at(g: number[], i: number): number {
  return g[i] ?? -1;
}

/** Lowest empty row in column c, or -1 when the column is full. */
export function dropRow(g: number[], c: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (at(g, r * COLS + c) < 0) return r;
  return -1;
}

/** The line of 4+ through (r, c) for player p, or null. */
export function lineThrough(g: number[], r: number, c: number, p: number): number[] | null {
  for (const [dr, dc] of DIRS) {
    const line = [r * COLS + c];
    for (const s of [-1, 1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && at(g, rr * COLS + cc) === p) {
        line.push(rr * COLS + cc);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 4) return line.sort((x, y) => x - y);
  }
  return null;
}

function validColumns(g: number[]): number[] {
  return CENTRE_ORDER.filter((c) => dropRow(g, c) >= 0);
}

/** A column where player p wins immediately, or -1. */
function winningColumn(g: number[], p: number, valid: number[]): number {
  for (const c of valid) {
    const r = dropRow(g, c);
    g[r * COLS + c] = p;
    const w = lineThrough(g, r, c, p);
    g[r * COLS + c] = -1;
    if (w) return c;
  }
  return -1;
}

function weightedPick(pool: number[], rng: Rng): number {
  let total = 0;
  for (const c of pool) total += COLUMN_WEIGHTS[c] ?? 1;
  let roll = rng.next() * total;
  for (const c of pool) {
    roll -= COLUMN_WEIGHTS[c] ?? 1;
    if (roll <= 0) return c;
  }
  return pool[0] ?? 3;
}

/** Columns where dropping does not let the opponent win by playing directly on top. */
function safeColumns(g: number[], me: number, valid: number[]): number[] {
  const opp = 1 - me;
  return valid.filter((c) => {
    const r = dropRow(g, c);
    g[r * COLS + c] = me;
    let bad = false;
    if (r > 0) {
      g[(r - 1) * COLS + c] = opp;
      bad = !!lineThrough(g, r - 1, c, opp);
      g[(r - 1) * COLS + c] = -1;
    }
    g[r * COLS + c] = -1;
    return !bad;
  });
}

/* ---------- Hard bot: minimax with alpha-beta and a centre-weighted line-count heuristic ---------- */

const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        out.push([0, 1, 2, 3].map((k) => (r + dr * k) * COLS + (c + dc * k)));
      }
  return out;
})();

const WIN_SCORE = 1_000_000;

function heuristic(g: number[], me: number): number {
  const opp = 1 - me;
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const v = at(g, r * COLS + 3);
    if (v === me) score += 4;
    else if (v === opp) score -= 4;
  }
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      const v = at(g, i);
      if (v === me) mine++;
      else if (v === opp) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 50;
    else if (mine === 2) score += 10;
    else if (mine === 1) score += 1;
    if (theirs === 3) score -= 60;
    else if (theirs === 2) score -= 10;
    else if (theirs === 1) score -= 1;
  }
  return score;
}

function negamax(g: number[], depth: number, alpha: number, beta: number, toMove: number, root: number, ply: number): number {
  const valid = validColumns(g);
  if (valid.length === 0) return 0;
  if (depth === 0) {
    const h = heuristic(g, root);
    return toMove === root ? h : -h;
  }
  let best = -Infinity;
  for (const c of valid) {
    const r = dropRow(g, c);
    g[r * COLS + c] = toMove;
    let val: number;
    if (lineThrough(g, r, c, toMove)) val = WIN_SCORE - ply;
    else val = -negamax(g, depth - 1, -beta, -alpha, 1 - toMove, root, ply + 1);
    g[r * COLS + c] = -1;
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export const HARD_DEPTH = 6;

function hardMove(g: number[], me: number, rng: Rng): number {
  const valid = validColumns(g);
  let bestVal = -Infinity;
  let best: number[] = [];
  for (const c of valid) {
    const r = dropRow(g, c);
    g[r * COLS + c] = me;
    const val = lineThrough(g, r, c, me) ? WIN_SCORE : -negamax(g, HARD_DEPTH - 1, -Infinity, Infinity, 1 - me, me, 1);
    g[r * COLS + c] = -1;
    if (val > bestVal) {
      bestVal = val;
      best = [c];
    } else if (val === bestVal) best.push(c);
  }
  return best.length > 1 ? (best[rng.int(best.length)] ?? 3) : (best[0] ?? 3);
}

function isInt(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
}

export const dropFour: GameDef<DropFourState, DropFourAction> = {
  id: 'drop-four',
  name: 'Drop Four',
  init: (_rng, opts) => ({ g: Array.from({ length: COLS * ROWS }, () => -1), t: firstSeat(opts), last: -1, w: null, line: null }),
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  result: (s) => s.w,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !a || !isInt(a.c, 0, COLS - 1)) return null;
    const r = dropRow(s.g, a.c);
    if (r < 0) return null;
    const g = s.g.slice();
    g[r * COLS + a.c] = seat;
    const line = lineThrough(g, r, a.c, seat);
    let w: Outcome = null;
    if (line) w = seat;
    else if (!g.includes(-1)) w = -1;
    return { g, t: (1 - seat) as Seat, last: r * COLS + a.c, w, line };
  },
  bot(s, me, level: BotLevel, rng) {
    const g = s.g.slice();
    if (level === 'hard') return { c: hardMove(g, me, rng) };
    const valid = validColumns(g);
    const win = winningColumn(g, me, valid);
    if (win >= 0) return { c: win };
    // Easy blocks only half the time.
    if (level === 'normal' || rng.next() < 0.5) {
      const block = winningColumn(g, 1 - me, valid);
      if (block >= 0) return { c: block };
    }
    const safe = level === 'normal' ? safeColumns(g, me, valid) : [];
    return { c: weightedPick(safe.length ? safe : valid, rng) };
  },
};
