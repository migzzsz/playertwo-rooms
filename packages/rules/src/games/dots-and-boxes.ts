import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { count, firstSeat, isInt, isObj, pick } from '../util';

/**
 * Dots & Boxes: 5×5 dots = 4×4 boxes, 40 lines (20 across, 20 down). Completing a box earns
 * another turn. Ported from prototype/games.js.
 */
export interface DotsAndBoxesState {
  /** Lines across: 5 rows × 4 gaps (index r*4+c). -1 undrawn, else the seat that drew it. */
  h: number[];
  /** Lines down: 4 rows × 5 gaps (index r*5+c). */
  v: number[];
  /** 16 boxes (index r*4+c): -1 open, else the owner. */
  bx: number[];
  t: Seat;
  /** Last line drawn, e.g. "h7", or null. */
  last: string | null;
  w: Outcome;
}

export interface DotsAndBoxesAction {
  k: 'h' | 'v';
  i: number;
}

type Lines = { h: number[]; v: number[] };

function sides(L: Lines, r: number, c: number): number {
  return +(L.h[r * 4 + c]! >= 0) + +(L.h[(r + 1) * 4 + c]! >= 0) + +(L.v[r * 5 + c]! >= 0) + +(L.v[r * 5 + c + 1]! >= 0);
}

/** Boxes (row, col) on either side of a line. */
function adjacent(k: 'h' | 'v', i: number): [number, number][] {
  const out: [number, number][] = [];
  if (k === 'h') {
    const r = Math.floor(i / 4);
    const c = i % 4;
    if (r > 0) out.push([r - 1, c]);
    if (r < 4) out.push([r, c]);
  } else {
    const r = Math.floor(i / 5);
    const c = i % 5;
    if (c > 0) out.push([r, c - 1]);
    if (c < 4) out.push([r, c]);
  }
  return out;
}

/** The four lines around a box. */
function boxLines(r: number, c: number): DotsAndBoxesAction[] {
  return [
    { k: 'h', i: r * 4 + c },
    { k: 'h', i: (r + 1) * 4 + c },
    { k: 'v', i: r * 5 + c },
    { k: 'v', i: r * 5 + c + 1 },
  ];
}

export function openLines(s: Lines): DotsAndBoxesAction[] {
  const out: DotsAndBoxesAction[] = [];
  for (let i = 0; i < 20; i++) if (s.h[i]! < 0) out.push({ k: 'h', i });
  for (let i = 0; i < 20; i++) if (s.v[i]! < 0) out.push({ k: 'v', i });
  return out;
}

const isOpen = (L: Lines, m: DotsAndBoxesAction) => (m.k === 'h' ? L.h : L.v)[m.i]! < 0;

function draw(s: DotsAndBoxesState, m: DotsAndBoxesAction, seat: Seat): DotsAndBoxesState {
  const h = s.h.slice();
  const v = s.v.slice();
  const bx = s.bx.slice();
  (m.k === 'h' ? h : v)[m.i] = seat;
  let got = 0;
  for (const [r, c] of adjacent(m.k, m.i)) {
    if (sides({ h, v }, r, c) === 4 && bx[r * 4 + c]! < 0) {
      bx[r * 4 + c] = seat;
      got++;
    }
  }
  let w: Outcome = null;
  if (!h.includes(-1) && !v.includes(-1)) {
    const n0 = count(bx, 0);
    w = n0 > 8 ? 0 : n0 < 8 ? 1 : -1;
  }
  return { h, v, bx, t: got ? seat : ((1 - seat) as Seat), last: m.k + m.i, w };
}

/** Side counts of the boxes next to a line, as if it were drawn. */
function sidesAfter(L: Lines, m: DotsAndBoxesAction): number[] {
  const h = L.h.slice();
  const v = L.v.slice();
  (m.k === 'h' ? h : v)[m.i] = 9;
  return adjacent(m.k, m.i).map(([r, c]) => sides({ h, v }, r, c));
}

const completes = (L: Lines, m: DotsAndBoxesAction) => sidesAfter(L, m).includes(4);
const isSafe = (L: Lines, m: DotsAndBoxesAction) => !sidesAfter(L, m).includes(3);

/** How many boxes a greedy player could take in a row from this position. */
function greedyHaul(L: Lines): number {
  const h = L.h.slice();
  const v = L.v.slice();
  let taken = 0;
  for (;;) {
    const cur = { h, v };
    const m = openLines(cur).find((x) => completes(cur, x));
    if (!m) return taken;
    const before = taken;
    (m.k === 'h' ? h : v)[m.i] = 9;
    for (const [r, c] of adjacent(m.k, m.i)) if (sides({ h, v }, r, c) === 4) taken++;
    if (taken === before) return taken;
  }
}

/**
 * Hard bot's double-deal: at the end of a chain with exactly two boxes left, decline them by
 * drawing the far side of the second box, handing over a domino but keeping control of the next
 * (longer) chain. Returns that line, or null when it doesn't apply.
 */
function doubleDeal(s: DotsAndBoxesState): DotsAndBoxesAction | null {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (s.bx[r * 4 + c]! >= 0 || sides(s, r, c) !== 3) continue;
      const toB = boxLines(r, c).find((m) => isOpen(s, m))!;
      const nb = adjacent(toB.k, toB.i).find(([rr, cc]) => rr !== r || cc !== c);
      if (!nb) continue;
      const [br, bc] = nb;
      if (sides(s, br, bc) !== 2) continue;
      const far = boxLines(br, bc).find((m) => isOpen(s, m) && !(m.k === toB.k && m.i === toB.i));
      if (!far) continue;
      // The far line must not open a third box (that would make the chain longer than two).
      const beyond = adjacent(far.k, far.i).find(([rr, cc]) => rr !== br || cc !== bc);
      if (beyond && sides(s, beyond[0], beyond[1]) >= 2) continue;
      return far;
    }
  return null;
}

function bestGiveaway(s: DotsAndBoxesState, moves: DotsAndBoxesAction[], rng: Rng): DotsAndBoxesAction {
  let best: DotsAndBoxesAction[] = [];
  let fewest = Infinity;
  for (const m of moves) {
    const h = s.h.slice();
    const v = s.v.slice();
    (m.k === 'h' ? h : v)[m.i] = 9;
    const given = greedyHaul({ h, v });
    if (given < fewest) {
      fewest = given;
      best = [m];
    } else if (given === fewest) best.push(m);
  }
  return pick(best, rng);
}

function chooseLine(s: DotsAndBoxesState, level: BotLevel, rng: Rng): DotsAndBoxesAction {
  const moves = openLines(s);
  const take = moves.filter((m) => completes(s, m));
  const safe = moves.filter((m) => isSafe(s, m));
  if (level === 'easy') {
    if (take.length && rng.next() < 0.8) return pick(take, rng);
    return pick(safe.length ? safe : moves, rng);
  }
  if (level === 'hard' && take.length && safe.length === 0) {
    // Endgame. Double-deal on the last two boxes of a chain if more boxes are still to come.
    const haul = greedyHaul(s);
    const remaining = count(s.bx, -1);
    if (haul === 2 && remaining - haul >= 3) {
      const dd = doubleDeal(s);
      if (dd) return dd;
    }
  }
  if (take.length) return pick(take, rng);
  if (safe.length) return pick(safe, rng);
  if (level === 'hard') return bestGiveaway(s, moves, rng);
  // Normal: give away the fewest boxes immediately (third sides created).
  let best = moves[0]!;
  let bestN = Infinity;
  for (const m of moves) {
    const n = count(sidesAfter(s, m), 3);
    if (n < bestN) {
      bestN = n;
      best = m;
    }
  }
  return best;
}

export const dotsAndBoxes: GameDef<DotsAndBoxesState, DotsAndBoxesAction> = {
  id: 'dots-and-boxes',
  name: 'Dots & Boxes',
  init(_rng, opts) {
    return { h: Array(20).fill(-1), v: Array(20).fill(-1), bx: Array(16).fill(-1), t: firstSeat(opts), last: null, w: null };
  },
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a) || (a.k !== 'h' && a.k !== 'v') || !isInt(a.i, 0, 19)) return null;
    const m = { k: a.k, i: a.i } as DotsAndBoxesAction;
    if (!isOpen(s, m)) return null;
    return draw(s, m, seat);
  },
  result: (s) => s.w,
  score: (s) => [count(s.bx, 0), count(s.bx, 1)],
  bot: (s, _seat, level, rng) => chooseLine(s, level, rng),
};
