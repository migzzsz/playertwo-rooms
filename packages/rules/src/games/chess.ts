import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat, isInt, isObj, pick } from '../util';

/**
 * Chess, full FIDE rules for casual play: castling, en passant, promotion, check, checkmate,
 * stalemate, the fifty-move rule, threefold repetition, insufficient material and resigning.
 * No clocks. The seat that starts plays White.
 *
 * Board: 64 squares, index 0 = a8 (top left from White's side) … 63 = h1. A square holds '' or a
 * piece letter, uppercase for White (PNBRQK) and lowercase for Black.
 */
export type Promo = 'q' | 'r' | 'b' | 'n';

export interface ChessState {
  b: string[];
  /** Seat to move. */
  t: Seat;
  /** Which seat plays White. */
  white: Seat;
  /** Castling rights still available, any of 'KQkq'. */
  castle: string;
  /** En passant target square, or -1. */
  ep: number;
  /** Half-moves since the last capture or pawn move (fifty-move rule). */
  half: number;
  /** Position keys seen so far, for threefold repetition. */
  seen: string[];
  last: { f: number; to: number } | null;
  /** Pieces each seat has captured, in order. */
  taken: [string[], string[]];
  w: Outcome;
  end: '' | 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | 'resign';
}

export type ChessAction = { f: number; to: number; promo?: Promo } | { resign: true };

export interface ChessMove {
  f: number;
  to: number;
  promo?: Promo;
}

const START = 'rnbqkbnr' + 'pppppppp' + '........'.repeat(4) + 'PPPPPPPP' + 'RNBQKBNR';

const isWhite = (p: string) => p !== '' && p === p.toUpperCase();
const colourOf = (p: string): 'w' | 'b' | null => (p === '' ? null : isWhite(p) ? 'w' : 'b');
const rowOf = (i: number) => i >> 3;
const colOf = (i: number) => i & 7;
const on = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

/** Which colour a seat plays. */
export function colourOfSeat(s: Pick<ChessState, 'white'>, seat: Seat): 'w' | 'b' {
  return seat === s.white ? 'w' : 'b';
}
const sideToMove = (s: ChessState) => colourOfSeat(s, s.t);

export const SQUARE_NAMES = Array.from({ length: 64 }, (_, i) => `${'abcdefgh'[colOf(i)]}${8 - rowOf(i)}`);

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const ROOK_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const BISHOP_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Is square `sq` attacked by any piece of colour `by`? */
export function attacked(b: string[], sq: number, by: 'w' | 'b'): boolean {
  const r = rowOf(sq);
  const c = colOf(sq);
  const mine = (p: string, letter: string) => p !== '' && colourOf(p) === by && p.toLowerCase() === letter;
  // Pawns attack diagonally forward: a white pawn sits one row below (higher index) the square.
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const dc of [-1, 1]) if (on(pr, c + dc) && mine(b[pr * 8 + c + dc]!, 'p')) return true;
  for (const [dr, dc] of KNIGHT) if (on(r + dr!, c + dc!) && mine(b[(r + dr!) * 8 + c + dc!]!, 'n')) return true;
  for (const [dr, dc] of KING) if (on(r + dr!, c + dc!) && mine(b[(r + dr!) * 8 + c + dc!]!, 'k')) return true;
  for (const [dirs, sliders] of [
    [ROOK_DIRS, 'rq'],
    [BISHOP_DIRS, 'bq'],
  ] as const) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr!;
      let cc = c + dc!;
      while (on(rr, cc)) {
        const p = b[rr * 8 + cc]!;
        if (p !== '') {
          if (colourOf(p) === by && sliders.includes(p.toLowerCase())) return true;
          break;
        }
        rr += dr!;
        cc += dc!;
      }
    }
  }
  return false;
}

function kingSquare(b: string[], colour: 'w' | 'b'): number {
  return b.indexOf(colour === 'w' ? 'K' : 'k');
}

export function inCheck(s: ChessState, colour: 'w' | 'b' = sideToMove(s)): boolean {
  const k = kingSquare(s.b, colour);
  return k >= 0 && attacked(s.b, k, colour === 'w' ? 'b' : 'w');
}

/** Moves that follow piece movement rules, before checking whether they leave the king in check. */
function pseudoMoves(s: ChessState, colour: 'w' | 'b'): ChessMove[] {
  const out: ChessMove[] = [];
  const b = s.b;
  const enemy = colour === 'w' ? 'b' : 'w';
  for (let i = 0; i < 64; i++) {
    const p = b[i]!;
    if (colourOf(p) !== colour) continue;
    const r = rowOf(i);
    const c = colOf(i);
    const kind = p.toLowerCase();
    if (kind === 'p') {
      const dir = colour === 'w' ? -1 : 1;
      const startRow = colour === 'w' ? 6 : 1;
      const lastRow = colour === 'w' ? 0 : 7;
      const push = (to: number) => {
        if (rowOf(to) === lastRow) for (const promo of ['q', 'r', 'b', 'n'] as Promo[]) out.push({ f: i, to, promo });
        else out.push({ f: i, to });
      };
      const one = (r + dir) * 8 + c;
      if (on(r + dir, c) && b[one] === '') {
        push(one);
        const two = (r + 2 * dir) * 8 + c;
        if (r === startRow && b[two] === '') out.push({ f: i, to: two });
      }
      for (const dc of [-1, 1]) {
        if (!on(r + dir, c + dc)) continue;
        const to = (r + dir) * 8 + c + dc;
        if (colourOf(b[to]!) === enemy || to === s.ep) push(to);
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, dc] of kind === 'n' ? KNIGHT : KING) {
        if (!on(r + dr!, c + dc!)) continue;
        const to = (r + dr!) * 8 + c + dc!;
        if (colourOf(b[to]!) !== colour) out.push({ f: i, to });
      }
      if (kind === 'k') {
        // Castling: rights intact, squares between empty, king not in, through or into check.
        const home = colour === 'w' ? 60 : 4;
        if (i === home && !attacked(b, home, enemy)) {
          const [kSide, qSide] = colour === 'w' ? ['K', 'Q'] : ['k', 'q'];
          if (s.castle.includes(kSide!) && b[home + 1] === '' && b[home + 2] === '' && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy))
            out.push({ f: i, to: home + 2 });
          if (s.castle.includes(qSide!) && b[home - 1] === '' && b[home - 2] === '' && b[home - 3] === '' && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy))
            out.push({ f: i, to: home - 2 });
        }
      }
    } else {
      const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, dc] of dirs) {
        let rr = r + dr!;
        let cc = c + dc!;
        while (on(rr, cc)) {
          const to = rr * 8 + cc;
          const q = b[to]!;
          if (colourOf(q) === colour) break;
          out.push({ f: i, to });
          if (q !== '') break;
          rr += dr!;
          cc += dc!;
        }
      }
    }
  }
  return out;
}

/** Board, rights and en passant after a move (no legality checks; no bookkeeping). */
function play(s: ChessState, m: ChessMove): { b: string[]; castle: string; ep: number; captured: string; pawnOrCapture: boolean } {
  const b = s.b.slice();
  const p = b[m.f]!;
  const kind = p.toLowerCase();
  let captured = b[m.to]!;
  b[m.to] = p;
  b[m.f] = '';
  if (kind === 'p' && m.to === s.ep && captured === '') {
    // En passant: the captured pawn sits beside the moving one.
    const victim = m.to + (isWhite(p) ? 8 : -8);
    captured = b[victim]!;
    b[victim] = '';
  }
  if (kind === 'p' && m.promo) b[m.to] = isWhite(p) ? m.promo.toUpperCase() : m.promo;
  if (kind === 'k' && Math.abs(m.to - m.f) === 2) {
    // Castling moves the rook too.
    const kingSide = m.to > m.f;
    const rookFrom = kingSide ? m.f + 3 : m.f - 4;
    const rookTo = kingSide ? m.f + 1 : m.f - 1;
    b[rookTo] = b[rookFrom]!;
    b[rookFrom] = '';
  }
  let castle = s.castle;
  const drop = (letters: string) => {
    for (const l of letters) castle = castle.replace(l, '');
  };
  if (p === 'K') drop('KQ');
  if (p === 'k') drop('kq');
  for (const sq of [m.f, m.to]) {
    if (sq === 63) drop('K');
    if (sq === 56) drop('Q');
    if (sq === 7) drop('k');
    if (sq === 0) drop('q');
  }
  const ep = kind === 'p' && Math.abs(m.to - m.f) === 16 ? (m.f + m.to) / 2 : -1;
  return { b, castle, ep, captured, pawnOrCapture: kind === 'p' || captured !== '' };
}

/** All legal moves for the side to move. */
export function legalMoves(s: ChessState): ChessMove[] {
  if (s.w !== null) return [];
  const colour = sideToMove(s);
  return pseudoMoves(s, colour).filter((m) => {
    const after = play(s, m).b;
    const k = kingSquare(after, colour);
    return !attacked(after, k, colour === 'w' ? 'b' : 'w');
  });
}

/** Legal destination squares for the piece on `from` (for highlighting). */
export function movesFrom(s: ChessState, from: number): ChessMove[] {
  return legalMoves(s).filter((m) => m.f === from);
}

function positionKey(b: string[], t: Seat, castle: string, ep: number): string {
  return `${b.map((p) => p || '.').join('')}|${t}|${castle}|${ep}`;
}

function insufficient(b: string[]): boolean {
  const pieces = b.filter((p) => p !== '' && p.toLowerCase() !== 'k');
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && 'nb'.includes(pieces[0]!.toLowerCase())) return true;
  // Bishops only, all on the same colour of square.
  if (pieces.every((p) => p.toLowerCase() === 'b')) {
    const shades = new Set(b.map((p, i) => (p.toLowerCase() === 'b' ? (rowOf(i) + colOf(i)) % 2 : -1)).filter((x) => x >= 0));
    return shades.size === 1;
  }
  return false;
}

/** Apply a legal move and settle the game state (check, mate, draws). */
function advance(s: ChessState, m: ChessMove): ChessState {
  const mover = s.t;
  const { b, castle, ep, captured, pawnOrCapture } = play(s, m);
  const t = (1 - mover) as Seat;
  const key = positionKey(b, t, castle, ep);
  const taken: [string[], string[]] = [s.taken[0].slice(), s.taken[1].slice()];
  if (captured) taken[mover].push(captured);
  const next: ChessState = {
    b,
    t,
    white: s.white,
    castle,
    ep,
    half: pawnOrCapture ? 0 : s.half + 1,
    seen: pawnOrCapture ? [key] : [...s.seen, key],
    last: { f: m.f, to: m.to },
    taken,
    w: null,
    end: '',
  };
  if (legalMoves(next).length === 0) {
    if (inCheck(next)) return { ...next, w: mover, end: 'checkmate' };
    return { ...next, w: -1, end: 'stalemate' };
  }
  if (next.half >= 100) return { ...next, w: -1, end: 'fifty' };
  if (next.seen.filter((k) => k === key).length >= 3) return { ...next, w: -1, end: 'repetition' };
  if (insufficient(b)) return { ...next, w: -1, end: 'material' };
  return next;
}

/* ---------- Bot ---------- */

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from White's side (index 0 = a8), the widely used "simplified evaluation" set.
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/** Material plus position, from `colour`'s point of view. */
function evaluate(b: string[], colour: 'w' | 'b'): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i]!;
    if (p === '') continue;
    const kind = p.toLowerCase();
    const white = isWhite(p);
    const v = VALUE[kind]! + PST[kind]![white ? i : 63 - i]!;
    score += white === (colour === 'w') ? v : -v;
  }
  return score;
}

/** Captures first, biggest victim with the smallest attacker (keeps alpha-beta fast). */
function ordered(s: ChessState, moves: ChessMove[]): ChessMove[] {
  const weight = (m: ChessMove) => {
    const victim = s.b[m.to]!;
    return (victim ? 10 * VALUE[victim.toLowerCase()]! - VALUE[s.b[m.f]!.toLowerCase()]! : 0) + (m.promo === 'q' ? 800 : 0);
  };
  return moves.slice().sort((a, b) => weight(b) - weight(a));
}

const MATE = 100_000;

/** A move for the search only: board, turn, rights and en passant; no draw or mate bookkeeping. */
function step(s: ChessState, m: ChessMove): ChessState {
  const { b, castle, ep } = play(s, m);
  return { ...s, b, castle, ep, t: (1 - s.t) as Seat, last: null };
}

/** Negamax with alpha-beta. Leaves are scored without generating moves, which keeps it quick. */
function search(s: ChessState, depth: number, alpha: number, beta: number, ply: number): number {
  const me = sideToMove(s);
  if (depth === 0) return evaluate(s.b, me);
  const moves = legalMoves(s);
  if (moves.length === 0) return inCheck(s) ? -(MATE - ply) : 0;
  for (const m of ordered(s, moves)) {
    const v = -search(step(s, m), depth - 1, -beta, -alpha, ply + 1);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

const DEPTH: Record<BotLevel, number> = { easy: 1, normal: 2, hard: 4 };

/** Easy plays loosely (often a random move); Normal looks two plies ahead; Hard four. */
export function chessBotMove(s: ChessState, level: BotLevel, rng: Rng): ChessMove {
  const moves = legalMoves(s);
  if (level === 'easy' && rng.next() < 0.45) return pick(moves, rng);
  let best: ChessMove[] = [];
  let bestV = -Infinity;
  for (const m of ordered(s, moves)) {
    const next = advance(s, m);
    // A move that ends the game is scored exactly: mate is best, a draw is worth nothing.
    const v = next.w !== null ? (next.w === -1 ? 0 : MATE) : -search(next, DEPTH[level] - 1, -Infinity, -bestV + 1, 1);
    if (v > bestV) {
      bestV = v;
      best = [m];
    } else if (v === bestV) best.push(m);
  }
  return pick(best, rng);
}

/* ---------- Game definition ---------- */

export function chessFromBoard(board: string, opts: { white?: Seat; t?: Seat; castle?: string; ep?: number } = {}): ChessState {
  const b = [...board].map((ch) => (ch === '.' ? '' : ch));
  const white = opts.white ?? 0;
  const t = opts.t ?? white;
  const castle = opts.castle ?? '';
  const ep = opts.ep ?? -1;
  return { b, t, white, castle, ep, half: 0, seen: [positionKey(b, t, castle, ep)], last: null, taken: [[], []], w: null, end: '' };
}

const PROMOS = ['q', 'r', 'b', 'n'];

export const chess: GameDef<ChessState, ChessAction> = {
  id: 'chess',
  name: 'Chess',
  init(_rng, opts) {
    const white = firstSeat(opts);
    return chessFromBoard(START, { white, t: white, castle: 'KQkq' });
  },
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  apply(s, a, seat) {
    if (s.w !== null || !isObj(a)) return null;
    // Either player may resign at any point, on their turn or not.
    if ('resign' in a) return a.resign === true ? { ...s, w: (1 - seat) as Seat, end: 'resign' } : null;
    if (s.t !== seat || !isInt(a.f, 0, 63) || !isInt(a.to, 0, 63)) return null;
    if (a.promo !== undefined && !PROMOS.includes(a.promo as string)) return null;
    const m = legalMoves(s).find((x) => x.f === a.f && x.to === a.to && (x.promo === undefined || x.promo === (a.promo ?? 'q')));
    return m ? advance(s, m) : null;
  },
  result: (s) => s.w,
  bot: (s, _seat, level, rng) => chessBotMove(s, level, rng),
};
