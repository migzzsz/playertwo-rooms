import { describe, expect, it } from 'vitest';
import { createRng, dropFour, type DropFourState, type BotLevel, type Seat } from '../src';

function play(s: DropFourState, cols: number[]): DropFourState {
  for (const c of cols) {
    const next = dropFour.apply(s, { c }, s.t);
    if (!next) throw new Error(`illegal move in fixture: column ${c}`);
    s = next;
  }
  return s;
}

function playOut(levels: [BotLevel, BotLevel], seed: number) {
  const rng = createRng(seed);
  let s = dropFour.init(rng);
  let moves = 0;
  while (dropFour.result(s) === null) {
    const seat = dropFour.turnOf(s) as Seat;
    const a = dropFour.bot(s, seat, levels[seat], rng);
    const next = dropFour.apply(s, a, seat);
    if (!next) throw new Error(`bot made an illegal move: ${JSON.stringify(a)} (seed ${seed})`);
    s = next;
    if (++moves > 42) throw new Error(`stuck game (seed ${seed})`);
  }
  return s;
}

describe('Drop Four rules', () => {
  it('drops a disc to the lowest empty slot and alternates turns', () => {
    const s = play(dropFour.init(createRng(1)), [3, 3]);
    expect(s.g[5 * 7 + 3]).toBe(0);
    expect(s.g[4 * 7 + 3]).toBe(1);
    expect(s.t).toBe(0);
    expect(s.last).toBe(4 * 7 + 3);
  });

  it('rejects illegal moves without mutating state', () => {
    const s0 = dropFour.init(createRng(1));
    const frozen = JSON.stringify(s0);
    expect(dropFour.apply(s0, { c: 7 }, 0)).toBeNull();
    expect(dropFour.apply(s0, { c: -1 }, 0)).toBeNull();
    expect(dropFour.apply(s0, { c: 2.5 }, 0)).toBeNull();
    expect(dropFour.apply(s0, { c: 3 }, 1)).toBeNull(); // not seat 1's turn
    dropFour.apply(s0, { c: 3 }, 0);
    expect(JSON.stringify(s0)).toBe(frozen);
    const full = play(s0, [0, 0, 0, 0, 0, 0]);
    expect(dropFour.apply(full, { c: 0 }, full.t)).toBeNull();
  });

  it('detects horizontal, vertical and both diagonal wins with the winning line', () => {
    const h = play(dropFour.init(createRng(1)), [0, 0, 1, 1, 2, 2, 3]);
    expect(h.w).toBe(0);
    expect(h.line).toEqual([35, 36, 37, 38]);
    const v = play(dropFour.init(createRng(1)), [0, 1, 0, 1, 0, 1, 0]);
    expect(v.w).toBe(0);
    // Rising diagonal for seat 0: (5,0) (4,1) (3,2) (2,3)
    const d1 = play(dropFour.init(createRng(1)), [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(d1.w).toBe(0);
    expect(d1.line).toHaveLength(4);
    // Falling diagonal for seat 0: (2,3) (3,4) (4,5) (5,6)
    const d2 = play(dropFour.init(createRng(1)), [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    expect(d2.w).toBe(0);
    expect(dropFour.canAct(d2, 1)).toBe(false);
    expect(dropFour.turnOf(d2)).toBeNull();
  });

  it('detects a draw when all 42 slots fill with no line', () => {
    // Column pairs filled in an order that never makes four in a row.
    const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
    const s = play(dropFour.init(createRng(1)), order);
    expect(s.g.includes(-1)).toBe(false);
    expect(s.w).toBe(-1);
    expect(s.line).toBeNull();
  });

  it('normal bot takes a win, then blocks an immediate loss', () => {
    const rng = createRng(7);
    // Seat 1 to move with three of its own in column 6: it must win there.
    const win = play(dropFour.init(rng), [0, 6, 1, 6, 0, 6, 1]);
    expect(dropFour.bot(win, 1, 'normal', rng)).toEqual({ c: 6 });
    // Seat 1 to move, seat 0 threatens column 3 horizontally (0,1,2 filled on the bottom row).
    const block = play(dropFour.init(rng), [0, 6, 1, 6, 2]);
    expect(dropFour.bot(block, 1, 'normal', rng)).toEqual({ c: 3 });
  });

  it('hard bot finds a forced win and blocks', () => {
    const rng = createRng(3);
    const block = play(dropFour.init(rng), [0, 6, 1, 6, 2]);
    expect(dropFour.bot(block, 1, 'hard', rng)).toEqual({ c: 3 });
    const win = play(dropFour.init(rng), [0, 6, 1, 6, 0, 6, 1]);
    expect(dropFour.bot(win, 1, 'hard', rng)).toEqual({ c: 6 });
  });

  it('plays 1,000 normal bot-vs-bot games with no illegal moves or stuck states', () => {
    const tally = { 0: 0, 1: 0, draw: 0 };
    for (let seed = 1; seed <= 1000; seed++) {
      const s = playOut(['normal', 'normal'], seed);
      if (s.w === -1) tally.draw++;
      else tally[s.w as Seat]++;
    }
    expect(tally[0] + tally[1] + tally.draw).toBe(1000);
  });

  it('plays 300 easy-vs-normal games cleanly, and normal wins most', () => {
    let normalWins = 0;
    for (let seed = 1; seed <= 300; seed++) if (playOut(['easy', 'normal'], seed).w === 1) normalWins++;
    expect(normalWins).toBeGreaterThan(150);
  });

  it('hard beats normal in most of 20 games', { timeout: 60_000 }, () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 20; seed++) if (playOut(['normal', 'hard'], seed).w === 1) hardWins++;
    expect(hardWins).toBeGreaterThanOrEqual(14);
  });

  it('is deterministic for a given seed', () => {
    expect(playOut(['normal', 'normal'], 42)).toEqual(playOut(['normal', 'normal'], 42));
  });
});
