import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { count, firstSeat, isInt, isObj, pick } from '../util';

/**
 * Ultimate Noughts: a 3×3 grid of small noughts-and-crosses boards (81 squares).
 * Player One is X (seat 0), Player Two is O. Ported from prototype/games.js.
 */
export interface UltimateNoughtsState {
  /** 81 squares, board-major (board B holds squares B*9 .. B*9+8): -1 empty, 0 X, 1 O. */
  b: number[];
  /** Small board status: -1 open, 0/1 won by that seat, 2 drawn (full, no line). */
  sw: number[];
  /** Board the mover must play in, or -1 for a free choice. */
  nx: number;
  t: Seat;
  last: number;
  w: Outcome;
}

export interface UltimateNoughtsAction {
  i: number;
}

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function lineWinner(get: (k: number) => number): number {
  for (const [a, b, c] of LINES) {
    const v = get(a);
    if ((v === 0 || v === 1) && v === get(b) && v === get(c)) return v;
  }
  return -1;
}

/** Legal squares for the player to move. */
export function legalSquares(s: UltimateNoughtsState): number[] {
  const out: number[] = [];
  for (let B = 0; B < 9; B++) {
    if (s.sw[B] !== -1) continue;
    if (s.nx !== -1 && s.nx !== B) continue;
    for (let k = 0; k < 9; k++) if ((s.b[B * 9 + k] ?? 0) < 0) out.push(B * 9 + k);
  }
  return out;
}

function place(s: UltimateNoughtsState, i: number, seat: Seat): UltimateNoughtsState {
  const b = s.b.slice();
  const sw = s.sw.slice();
  const B = Math.floor(i / 9);
  b[i] = seat;
  const small = lineWinner((k) => b[B * 9 + k]!);
  if (small >= 0) sw[B] = small;
  else {
    let full = true;
    for (let k = 0; k < 9; k++) if (b[B * 9 + k]! < 0) full = false;
    if (full) sw[B] = 2;
  }
  const big = lineWinner((k) => sw[k]!);
  let w: Outcome = null;
  if (big >= 0) w = big as Seat;
  else if (!sw.includes(-1)) {
    const n0 = count(sw, 0);
    const n1 = count(sw, 1);
    w = n0 > n1 ? 0 : n1 > n0 ? 1 : -1;
  }
  let nx = i % 9;
  if (sw[nx] !== -1) nx = -1;
  return { b, sw, nx, t: (1 - seat) as Seat, last: i, w };
}

const boardOf = (i: number) => Math.floor(i / 9);

/** Prototype bot (Normal), with Easy skipping the safety checks half the time. */
function heuristicMove(s: UltimateNoughtsState, me: Seat, rng: Rng, careless: boolean): number {
  const moves = legalSquares(s);
  const opp = (1 - me) as Seat;
  for (const m of moves) if (place(s, m, me).w === me) return m;
  if (careless && rng.next() < 0.5) return pick(moves, rng);
  const smallWins = moves.filter((m) => place(s, m, me).sw[boardOf(m)] === me);
  const blocks = moves.filter((m) => {
    const B = boardOf(m);
    const b = s.b.slice();
    b[m] = opp;
    return lineWinner((k) => b[B * 9 + k]!) === opp;
  });
  // Safe: doesn't hand the opponent a free choice or an immediate small-board win.
  const safe = (m: number) => {
    const n = place(s, m, me);
    if (n.nx === -1) return false;
    for (const o of legalSquares(n)) if (place(n, o, opp).sw[boardOf(o)] === opp) return false;
    return true;
  };
  let good = smallWins.filter(safe);
  if (good.length) return pick(good, rng);
  if (smallWins.length) return pick(smallWins, rng);
  good = blocks.filter(safe);
  if (good.length) return pick(good, rng);
  const safeAll = moves.filter(safe);
  const centre = safeAll.filter((m) => m % 9 === 4);
  if (centre.length && rng.next() < 0.5) return pick(centre, rng);
  if (safeAll.length) return pick(safeAll, rng);
  if (blocks.length) return pick(blocks, rng);
  return pick(moves, rng);
}

interface Node {
  move: number;
  parent: Node | null;
  children: Node[];
  untried: number[];
  /** Seat that made `move` (whose perspective `wins` is counted from). */
  mover: Seat;
  visits: number;
  wins: number;
}

/** Hard: Monte Carlo tree search (UCT) with random playouts. */
function mctsMove(root: UltimateNoughtsState, me: Seat, rng: Rng, iterations: number): number {
  const moves = legalSquares(root);
  for (const m of moves) if (place(root, m, me).w === me) return m;
  const tree: Node = { move: -1, parent: null, children: [], untried: moves.slice(), mover: (1 - me) as Seat, visits: 0, wins: 0 };
  for (let it = 0; it < iterations; it++) {
    let node = tree;
    let state = root;
    // Selection
    while (node.untried.length === 0 && node.children.length > 0) {
      const logN = Math.log(node.visits);
      let best: Node = node.children[0]!;
      let bestU = -Infinity;
      for (const c of node.children) {
        const u = c.wins / c.visits + 1.4 * Math.sqrt(logN / c.visits);
        if (u > bestU) {
          bestU = u;
          best = c;
        }
      }
      node = best;
      state = place(state, node.move, node.mover);
    }
    // Expansion
    if (node.untried.length > 0 && state.w === null) {
      const k = rng.int(node.untried.length);
      const m = node.untried[k]!;
      node.untried.splice(k, 1);
      const mover = state.t;
      state = place(state, m, mover);
      const child: Node = { move: m, parent: node, children: [], untried: state.w === null ? legalSquares(state) : [], mover, visits: 0, wins: 0 };
      node.children.push(child);
      node = child;
    }
    // Playout
    let sim = state;
    while (sim.w === null) sim = place(sim, pick(legalSquares(sim), rng), sim.t);
    // Backpropagation
    for (let n: Node | null = node; n; n = n.parent) {
      n.visits++;
      if (sim.w === n.mover) n.wins += 1;
      else if (sim.w === -1) n.wins += 0.5;
    }
  }
  let best = tree.children[0]!;
  for (const c of tree.children) if (c.visits > best.visits) best = c;
  return best.move;
}

export const HARD_PLAYOUTS = 1000;

export const ultimateNoughts: GameDef<UltimateNoughtsState, UltimateNoughtsAction> = {
  id: 'ultimate-noughts',
  name: 'Ultimate Noughts',
  init(_rng, opts) {
    return { b: Array(81).fill(-1), sw: Array(9).fill(-1), nx: -1, t: firstSeat(opts), last: -1, w: null };
  },
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a) || !isInt(a.i, 0, 80)) return null;
    if (!legalSquares(s).includes(a.i)) return null;
    return place(s, a.i, seat);
  },
  result: (s) => s.w,
  score: (s) => [count(s.sw, 0), count(s.sw, 1)],
  bot(s, seat, level: BotLevel, rng) {
    if (level === 'hard') return { i: mctsMove(s, seat, rng, HARD_PLAYOUTS) };
    return { i: heuristicMove(s, seat, rng, level === 'easy') };
  },
};
