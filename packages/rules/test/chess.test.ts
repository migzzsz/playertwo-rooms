import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';
import { chess, chessBotMove, chessFromBoard, legalMoves, type ChessState } from '../src/games/chess';

/** Counts leaf positions at a depth: the standard check that move generation is exactly right. */
function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) {
    const next = chess.apply(s, m, s.t)!;
    n += next.w !== null && depth > 1 ? 0 : perft(next, depth - 1);
  }
  return n;
}

const start = () => chess.init(createRng(1), { first: 0 });
const sq = (name: string) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]!);

describe('chess rules', () => {
  it('generates the known number of positions from the start', () => {
    expect(perft(start(), 1)).toBe(20);
    expect(perft(start(), 2)).toBe(400);
    expect(perft(start(), 3)).toBe(8902);
  });

  it('matches the "Kiwipete" test position (castling, en passant, promotion, pins)', () => {
    const kiwi = chessFromBoard('r...k..r' + 'p.ppqpb.' + 'bn..pnp.' + '...PN...' + '.p..P...' + '..N..Q.p' + 'PPPBBPPP' + 'R...K..R', { castle: 'KQkq' });
    expect(perft(kiwi, 1)).toBe(48);
    expect(perft(kiwi, 2)).toBe(2039);
  });

  it("Fool's mate ends the game for Black", () => {
    let s = start();
    for (const [f, t] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ]) s = chess.apply(s, { f: sq(f!), to: sq(t!) }, s.t)!;
    expect(s.w).toBe(1);
    expect(s.end).toBe('checkmate');
  });

  it('castles, captures en passant and promotes', () => {
    const castle = chessFromBoard('r...k..r' + '........'.repeat(6) + 'R...K..R', { castle: 'KQkq' });
    const after = chess.apply(castle, { f: sq('e1'), to: sq('g1') }, 0)!;
    expect(after.b[sq('g1')]).toBe('K');
    expect(after.b[sq('f1')]).toBe('R');
    expect(after.castle).toBe('kq');

    const ep = chessFromBoard('....k...' + '........' + '........' + '...pP...' + '........'.repeat(3) + '....K...', { ep: sq('d6') });
    const took = chess.apply(ep, { f: sq('e5'), to: sq('d6') }, 0)!;
    expect(took.b[sq('d5')]).toBe('');
    expect(took.taken[0]).toEqual(['p']);

    const promo = chessFromBoard('....k...' + 'P.......' + '........'.repeat(5) + '....K...');
    expect(chess.apply(promo, { f: sq('a7'), to: sq('a8'), promo: 'n' }, 0)!.b[0]).toBe('N');
    expect(chess.apply(promo, { f: sq('a7'), to: sq('a8') }, 0)!.b[0]).toBe('Q');
  });

  it('recognises stalemate and insufficient material as draws', () => {
    const stale = chessFromBoard('.......k' + '.....Q..' + '......K.' + '........'.repeat(5));
    const s = chess.apply(stale, { f: sq('f7'), to: sq('g6') }, 0);
    expect(s).toBeNull(); // own king is there: illegal
    const st = chessFromBoard('.......k' + '........' + '......K.' + '........'.repeat(4) + '.....Q..');
    const done = chess.apply(st, { f: sq('f1'), to: sq('f7') }, 0)!;
    expect(done.w).toBe(-1);
    expect(done.end).toBe('stalemate');

    const bare = chessFromBoard('....k...' + '...p....' + '........'.repeat(5) + '....K...', { t: 0 });
    const kxp = chessFromBoard('....k...' + '........'.repeat(5) + '...pK...' + '........');
    expect(chess.apply(kxp, { f: sq('e2'), to: sq('d2') }, 0)!.end).toBe('material');
    expect(bare.w).toBeNull();
  });

  it('refuses illegal moves, moving into check and moving out of turn; resigning ends it', () => {
    const s = start();
    expect(chess.apply(s, { f: sq('e2'), to: sq('e5') }, 0)).toBeNull();
    expect(chess.apply(s, { f: sq('e7'), to: sq('e5') }, 1)).toBeNull();
    expect(chess.apply(s, { f: 99, to: 0 } as never, 0)).toBeNull();
    const r = chess.apply(s, { resign: true }, 1)!;
    expect(r.w).toBe(0);
    expect(r.end).toBe('resign');
  });

  it('the bot always plays a legal move and finds mate in one', () => {
    const rng = createRng(7);
    let s = start();
    for (let i = 0; i < 20 && s.w === null; i++) {
      const m = chessBotMove(s, i % 2 ? 'hard' : 'easy', rng);
      s = chess.apply(s, m, s.t)!;
      expect(s).not.toBeNull();
    }
    const mateIn1 = chessFromBoard('......k.' + '.....ppp' + '........'.repeat(5) + 'R.....K.');
    for (const level of ['normal', 'hard'] as const) {
      const m = chessBotMove(mateIn1, level, createRng(3));
      expect(chess.apply(mateIn1, m, 0)!.end).toBe('checkmate');
    }
  });
});
