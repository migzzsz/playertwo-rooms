import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat, isInt, isObj, pick } from '../util';

/**
 * Mancala, Kalah rules with 4 seeds per pit. Pits 0–5 and store 6 belong to seat 0; pits 7–12
 * and store 13 to seat 1. Sowing runs anticlockwise (increasing index), skipping the opponent's
 * store. Ported from prototype/games.js.
 */
export interface MancalaState {
  a: number[];
  t: Seat;
  last: number;
  w: Outcome;
  /** What the last move did, for the UI note. */
  note: '' | 'extra' | 'capture';
}

export interface MancalaAction {
  p: number;
}

export const storeOf = (seat: Seat) => (seat === 0 ? 6 : 13);
const pitsOf = (seat: Seat) => (seat === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);

export function legalPits(s: MancalaState, seat: Seat): number[] {
  return pitsOf(seat).filter((p) => s.a[p]! > 0);
}

function sow(s: MancalaState, p: number, seat: Seat): MancalaState {
  const a = s.a.slice();
  const own = storeOf(seat);
  const opp = storeOf((1 - seat) as Seat);
  let n = a[p]!;
  let i = p;
  a[p] = 0;
  while (n > 0) {
    i = (i + 1) % 14;
    if (i === opp) continue;
    a[i]!++;
    n--;
  }
  let t = (1 - seat) as Seat;
  let note: MancalaState['note'] = '';
  const mine = seat === 0 ? i >= 0 && i <= 5 : i >= 7 && i <= 12;
  if (i === own) {
    t = seat;
    note = 'extra';
  } else if (mine && a[i] === 1 && a[12 - i]! > 0) {
    a[own]! += a[12 - i]! + 1;
    a[i] = 0;
    a[12 - i] = 0;
    note = 'capture';
  }
  let w: Outcome = null;
  const empty0 = a.slice(0, 6).every((x) => x === 0);
  const empty1 = a.slice(7, 13).every((x) => x === 0);
  if (empty0 || empty1) {
    for (let k = 0; k < 6; k++) {
      a[6]! += a[k]!;
      a[k] = 0;
      a[13]! += a[7 + k]!;
      a[7 + k] = 0;
    }
    w = a[6]! > a[13]! ? 0 : a[13]! > a[6]! ? 1 : -1;
  }
  return { a, t, last: i, w, note };
}

/** Normal: one-ply greedy from the prototype (store gain ×2, +5 extra turn, +100 winning move). */
function greedy(s: MancalaState, me: Seat, rng: Rng): number {
  const own = storeOf(me);
  let best = -1;
  let bestV = -Infinity;
  for (const p of legalPits(s, me)) {
    const n = sow(s, p, me);
    let v = (n.a[own]! - s.a[own]!) * 2 + (n.t === me && n.w === null ? 5 : 0) + rng.next();
    if (n.w === me) v += 100;
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  return best;
}

/** Store difference from `me`'s point of view, with decided games pushed to the extremes. */
function evaluate(s: MancalaState, me: Seat): number {
  const diff = s.a[storeOf(me)]! - s.a[storeOf((1 - me) as Seat)]!;
  if (s.w === null) return diff;
  return s.w === me ? 1000 + diff : s.w === -1 ? 0 : -1000 + diff;
}

/** Minimax with alpha-beta. Extra turns keep the same player maximising or minimising. */
function search(s: MancalaState, depth: number, me: Seat, alpha: number, beta: number): number {
  if (depth === 0 || s.w !== null) return evaluate(s, me);
  const moves = legalPits(s, s.t);
  if (s.t === me) {
    let v = -Infinity;
    for (const p of moves) {
      v = Math.max(v, search(sow(s, p, s.t), depth - 1, me, alpha, beta));
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return v;
  }
  let v = Infinity;
  for (const p of moves) {
    v = Math.min(v, search(sow(s, p, s.t), depth - 1, me, alpha, beta));
    beta = Math.min(beta, v);
    if (alpha >= beta) break;
  }
  return v;
}

export const HARD_DEPTH = 6;

function minimax(s: MancalaState, me: Seat, rng: Rng): number {
  let best: number[] = [];
  let bestV = -Infinity;
  for (const p of legalPits(s, me)) {
    const v = search(sow(s, p, me), HARD_DEPTH - 1, me, -Infinity, Infinity);
    if (v > bestV) {
      bestV = v;
      best = [p];
    } else if (v === bestV) best.push(p);
  }
  return pick(best, rng);
}

function choosePit(s: MancalaState, me: Seat, level: BotLevel, rng: Rng): number {
  if (level === 'hard') return minimax(s, me, rng);
  if (level === 'easy' && rng.next() < 0.5) return pick(legalPits(s, me), rng);
  return greedy(s, me, rng);
}

export const mancala: GameDef<MancalaState, MancalaAction> = {
  id: 'mancala',
  name: 'Mancala',
  init(_rng, opts) {
    return { a: Array.from({ length: 14 }, (_, i) => (i === 6 || i === 13 ? 0 : 4)), t: firstSeat(opts), last: -1, w: null, note: '' };
  },
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a) || !isInt(a.p, 0, 12)) return null;
    if (!pitsOf(seat).includes(a.p) || s.a[a.p] === 0) return null;
    return sow(s, a.p, seat);
  },
  result: (s) => s.w,
  score: (s) => [s.a[6]!, s.a[13]!],
  bot: (s, seat, level, rng) => ({ p: choosePit(s, seat, level, rng) }),
};
