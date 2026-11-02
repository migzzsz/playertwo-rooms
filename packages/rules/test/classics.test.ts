import { describe, expect, it } from 'vitest';
import {
  CLASSICS,
  correctSlot,
  createRng,
  dotsAndBoxes,
  fleetFight,
  isValidFleet,
  legalSquares,
  mancala,
  randomFleet,
  triviaDuel,
  ultimateNoughts,
  type BotLevel,
  type DotsAndBoxesState,
  type FleetFightState,
  type FleetFightView,
  type GameDef,
  type MancalaState,
  type Seat,
  type TriviaDuelState,
  type UltimateNoughtsState,
} from '../src';

type AnyGame = GameDef<unknown, unknown>;

/** Bot-vs-bot to the end. Throws on an illegal bot move, a mutated state or a stuck game. */
function playOut(game: AnyGame, levels: [BotLevel, BotLevel], seed: number, maxSteps = 500) {
  const rng = createRng(seed);
  let s = game.init(rng);
  for (let steps = 0; game.result(s) === null; steps++) {
    if (steps > maxSteps) throw new Error(`${game.id}: stuck after ${maxSteps} steps (seed ${seed})`);
    const seats = ([0, 1] as Seat[]).filter((seat) => game.canAct(s, seat));
    if (!seats.length) throw new Error(`${game.id}: nobody can act (seed ${seed})`);
    const seat = game.turnOf(s) ?? seats[rng.int(seats.length)]!;
    const a = game.bot(s, seat, levels[seat], rng);
    const frozen = JSON.stringify(s);
    const next = game.apply(s, a, seat);
    if (JSON.stringify(s) !== frozen) throw new Error(`${game.id}: apply mutated its input`);
    if (!next) throw new Error(`${game.id}: illegal bot move ${JSON.stringify(a)} (seed ${seed})`);
    s = next;
  }
  return s;
}

describe('every classic', () => {
  it('ships all six in shelf order with unique ids', () => {
    expect(CLASSICS.map((g) => g.id)).toEqual(['drop-four', 'fleet-fight', 'dots-and-boxes', 'ultimate-noughts', 'mancala', 'trivia-duel']);
  });

  for (const game of CLASSICS) {
    it(`${game.name}: 1,000 Normal-vs-Normal games finish with no illegal moves or stuck states`, () => {
      const results: Record<number, number> = { 0: 0, 1: 0, [-1]: 0 };
      for (let seed = 1; seed <= 1000; seed++) {
        const end = playOut(game as AnyGame, ['normal', 'normal'], seed);
        results[game.result(end as never) as number]!++;
      }
      expect(results[0]! + results[1]! + results[-1]!).toBe(1000);
    }, 120_000);

    it(`${game.name}: Easy and Hard bots also play legal games`, () => {
      const hardGames = game.id === 'ultimate-noughts' ? 4 : 30;
      for (let seed = 1; seed <= 100; seed++) playOut(game as AnyGame, ['easy', 'normal'], seed);
      for (let seed = 1; seed <= hardGames; seed++) playOut(game as AnyGame, ['hard', 'easy'], seed);
    }, 120_000);

    it(`${game.name}: rejects junk actions and actions out of turn`, () => {
      const s = game.init(createRng(7)) as never;
      for (const junk of [null, undefined, 42, 'x', {}, { i: -1 }, { c: 99 }, { p: 1.5 }, { k: 'z', i: 999 }, { type: 'fire', i: 999 }, { i: 999 }])
        expect(game.apply(s, junk as never, 0)).toBeNull();
      if (game.turnOf(s) === 0) expect(game.apply(s, game.bot(s, 0, 'normal', createRng(1)) as never, 1)).toBeNull();
    });
  }
});

/** Plays `games` matches with seats swapped each game; returns wins for the first level. */
function headToHead(game: AnyGame, a: BotLevel, b: BotLevel, games: number) {
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1;
    const end = playOut(game, swap ? [b, a] : [a, b], 9000 + i);
    const w = game.result(end);
    const aSeat = swap ? 1 : 0;
    if (w === aSeat) wins++;
    else if (w === 1 - aSeat) losses++;
  }
  return { wins, losses };
}

describe('who moves first', () => {
  it('every turn-based classic lets seat 1 start (the loser of the last game starts the next)', () => {
    for (const game of CLASSICS) {
      if (game.simultaneous) continue;
      const rng = createRng(2);
      let s = (game as AnyGame).init(rng, { first: 1 });
      if (game.id === 'fleet-fight') s = fleetFight.apply(fleetFight.apply(s as FleetFightState, { type: 'ready' }, 0)!, { type: 'ready' }, 1)!;
      expect(game.turnOf(s as never)).toBe(1);
      expect((game as AnyGame).turnOf((game as AnyGame).init(rng))).toBe(game.id === 'fleet-fight' ? null : 0);
    }
  });
});

describe('Hard bots are stronger than Normal', () => {
  it('Mancala (minimax depth 6)', () => {
    const { wins, losses } = headToHead(mancala as AnyGame, 'hard', 'normal', 30);
    expect(wins).toBeGreaterThan(losses * 2);
  }, 120_000);

  it('Ultimate Noughts (MCTS)', () => {
    const { wins, losses } = headToHead(ultimateNoughts as AnyGame, 'hard', 'normal', 12);
    expect(wins).toBeGreaterThan(losses);
  }, 240_000);

  it('Fleet Fight (probability density) sinks the fleet in fewer shots', () => {
    const shotsToWin = (level: BotLevel) => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const rng = createRng(seed);
        let s = fleetFight.init(rng);
        s = fleetFight.apply(fleetFight.apply(s, { type: 'ready' }, 0)!, { type: 'ready' }, 1)!;
        let shots = 0;
        while (s.w === null) {
          s = fleetFight.apply(s, fleetFight.bot(s, 0, level, rng), 0)!;
          shots++;
          if (s.w === null) s = fleetFight.apply(s, { type: 'fire', i: s.sh[1].indexOf(0) }, 1)!; // seat 1 sweeps in order
        }
        total += shots;
      }
      return total / 60;
    };
    expect(shotsToWin('hard')).toBeLessThan(shotsToWin('normal'));
    expect(shotsToWin('normal')).toBeLessThan(shotsToWin('easy'));
  }, 120_000);

  it('Dots & Boxes (chain-aware, double-dealing)', () => {
    const { wins, losses } = headToHead(dotsAndBoxes as AnyGame, 'hard', 'normal', 60);
    expect(wins).toBeGreaterThan(losses);
  }, 120_000);
});

describe('Fleet Fight', () => {
  const ready = (s: FleetFightState) => fleetFight.apply(fleetFight.apply(s, { type: 'ready' }, 0)!, { type: 'ready' }, 1)!;

  it('validates placements: lengths, straight lines, on the grid, no overlap', () => {
    expect(isValidFleet(randomFleet(createRng(3)))).toBe(true);
    expect(isValidFleet([[0, 1, 2, 3], [8, 9, 10], [16, 17, 18], [24, 25]])).toBe(true); // touching is allowed
    expect(isValidFleet([[0, 1, 2, 3], [3, 4, 5], [16, 17, 18], [24, 25]])).toBe(false); // overlap
    expect(isValidFleet([[6, 7, 8, 9], [16, 17, 18], [32, 33, 34], [48, 49]])).toBe(false); // wraps a row
    expect(isValidFleet([[0, 1, 2, 10], [16, 17, 18], [32, 33, 34], [48, 49]])).toBe(false); // bent
    expect(isValidFleet([[0, 1, 2], [16, 17, 18], [32, 33, 34], [48, 49]])).toBe(false); // wrong length
  });

  it('runs setup then alternating shots, reports hits and sinkings, and ends when a fleet is sunk', () => {
    let s = fleetFight.init(createRng(5));
    expect(fleetFight.apply(s, { type: 'fire', i: 0 }, 0)).toBeNull(); // still in setup
    const mine = [[0, 1, 2, 3], [8, 9, 10], [16, 17, 18], [24, 25]];
    s = fleetFight.apply(s, { type: 'fleet', ships: mine }, 1)!;
    expect(s.f[1]).toEqual(mine);
    s = ready(s);
    expect(s.phase).toBe('play');
    expect(fleetFight.apply(s, { type: 'fleet', ships: mine }, 0)).toBeNull(); // no moving ships mid-game
    // Seat 0 sinks the Patrol (24, 25) while seat 1 fires at empty water.
    s = fleetFight.apply(s, { type: 'fire', i: 24 }, 0)!;
    expect(s.last).toMatchObject({ hit: true, sunk: -1 });
    expect(fleetFight.apply(s, { type: 'fire', i: 24 }, 0)).toBeNull(); // not your turn
    s = fleetFight.apply(s, { type: 'fire', i: 63 }, 1)!;
    expect(fleetFight.apply(s, { type: 'fire', i: 24 }, 0)).toBeNull(); // already fired there
    s = fleetFight.apply(s, { type: 'fire', i: 25 }, 0)!;
    expect(s.last).toMatchObject({ hit: true, sunk: 3 });
    let spare = 62;
    for (const i of [0, 1, 2, 3, 8, 9, 10, 16, 17, 18]) {
      s = fleetFight.apply(s, { type: 'fire', i: spare-- }, 1)!;
      s = fleetFight.apply(s, { type: 'fire', i }, 0)!;
    }
    expect(s.w).toBe(0);
  });

  it("never shows a player the other side's unsunk ships", () => {
    let s = ready(fleetFight.init(createRng(9)));
    const v0 = fleetFight.view!(s, 0) as FleetFightView;
    expect(v0.f[0]).toEqual(s.f[0]);
    expect(v0.f[1].every((x) => x === null)).toBe(true);
    // Sink seat 1's patrol: it becomes visible to seat 0 only.
    const patrol = s.f[1][3]!;
    for (const i of patrol) {
      s = fleetFight.apply(s, { type: 'fire', i }, 0)!;
      s = fleetFight.apply(s, { type: 'fire', i: s.sh[1].indexOf(0) }, 1)!;
    }
    const v0b = fleetFight.view!(s, 0) as FleetFightView;
    expect(v0b.f[1][3]).toEqual(patrol);
    expect(v0b.f[1].slice(0, 3).every((x) => x === null)).toBe(true);
    const v1 = fleetFight.view!(s, 1) as FleetFightView;
    expect(v1.f[1]).toEqual(s.f[1]);
    expect(JSON.stringify(v1.f[0])).not.toContain(JSON.stringify(s.f[0][0]));
  });
});

describe('Dots & Boxes', () => {
  const play = (s: DotsAndBoxesState, moves: [string, number][]) =>
    moves.reduce((acc, [k, i]) => dotsAndBoxes.apply(acc, { k: k as 'h' | 'v', i }, acc.t)!, s);

  it('passes the turn on a plain line, and closing a box scores and keeps the turn', () => {
    let s = dotsAndBoxes.init(createRng(1));
    s = play(s, [['h', 0]]);
    expect(s.t).toBe(1);
    s = play(s, [['h', 4], ['v', 0]]);
    expect(s.t).toBe(1);
    s = play(s, [['v', 1]]); // seat 1 closes box 0
    expect(s.bx[0]).toBe(1);
    expect(s.t).toBe(1);
    expect(dotsAndBoxes.score!(s)).toEqual([0, 1]);
    expect(dotsAndBoxes.apply(s, { k: 'h', i: 0 }, 1)).toBeNull(); // already drawn
  });

  it('one line can close two boxes; the game ends when all 40 lines are drawn', () => {
    let s = dotsAndBoxes.init(createRng(1));
    // Boxes 0 and 1 share v1; draw everything else around them first.
    s = play(s, [['h', 0], ['h', 1], ['h', 4], ['h', 5], ['v', 0], ['v', 2]]);
    const mover = s.t;
    s = play(s, [['v', 1]]);
    expect(s.bx[0]).toBe(mover);
    expect(s.bx[1]).toBe(mover);
    const end = playOut(dotsAndBoxes as AnyGame, ['normal', 'normal'], 3) as DotsAndBoxesState;
    expect(end.h.concat(end.v).every((x) => x >= 0)).toBe(true);
    const [a, b] = dotsAndBoxes.score!(end);
    expect(a + b).toBe(16);
    expect(end.w).toBe(a > b ? 0 : b > a ? 1 : -1);
  });
});

describe('Ultimate Noughts', () => {
  const play = (s: UltimateNoughtsState, squares: number[]) => squares.reduce((acc, i) => ultimateNoughts.apply(acc, { i }, acc.t)!, s);

  it('sends the opponent to the board matching the square played', () => {
    const s = play(ultimateNoughts.init(createRng(1)), [4 * 9 + 2]); // centre board, top-right square
    expect(s.nx).toBe(2);
    expect(legalSquares(s).every((i) => Math.floor(i / 9) === 2)).toBe(true);
    expect(ultimateNoughts.apply(s, { i: 0 }, 1)).toBeNull();
  });

  it('wins a small board with three in a row, and a finished board frees the next move', () => {
    // X takes squares 1, 2, 0 of board 0; O's replies send X back to board 0 each time.
    let t = ultimateNoughts.init(createRng(1));
    t = play(t, [0 * 9 + 1, 1 * 9 + 0, 0 * 9 + 2, 2 * 9 + 0, 0 * 9 + 0]);
    expect(t.sw[0]).toBe(0);
    // O is sent to board 0 (square 0), which is won, so O may play anywhere open.
    expect(t.nx).toBe(-1);
    expect(new Set(legalSquares(t).map((i) => Math.floor(i / 9))).size).toBe(8);
  });

  it('three small boards in a row win the game; more boards wins when no line', () => {
    let s = ultimateNoughts.init(createRng(1));
    s = { ...s, sw: [0, 0, -1, 1, 1, -1, -1, -1, -1], b: s.b.map((x, i) => (Math.floor(i / 9) === 2 && i % 9 < 2 ? 0 : x)), nx: 2, t: 0 };
    const won = ultimateNoughts.apply(s, { i: 2 * 9 + 2 }, 0)!;
    expect(won.sw[2]).toBe(0);
    expect(won.w).toBe(0);
  });
});

describe('Mancala (Kalah)', () => {
  it('sows anticlockwise and grants an extra turn for landing in your store', () => {
    const s = mancala.apply(mancala.init(createRng(1)), { p: 2 }, 0)!;
    expect(s.a.slice(0, 7)).toEqual([4, 4, 0, 5, 5, 5, 1]);
    expect(s.t).toBe(0);
    expect(s.note).toBe('extra');
  });

  it("skips the opponent's store and captures from an empty pit on your side", () => {
    const base = mancala.init(createRng(1));
    const skip: MancalaState = { ...base, a: [0, 0, 0, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0], t: 0 };
    const after = mancala.apply(skip, { p: 5 }, 0)!;
    expect(after.a[13]).toBe(0); // skipped, so the 10th seed wraps round to pit 2
    expect(after.last).toBe(2);
    // Pit 2 was empty, so that last seed captures the opposite pit (10) as well.
    expect(after.note).toBe('capture');
    expect(after.a.slice(7, 13)).toEqual([2, 2, 2, 0, 2, 2]);
    expect(after.a[6]).toBe(1 + 2 + 1);
    const cap: MancalaState = { ...base, a: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 3, 0], t: 0 };
    const c = mancala.apply(cap, { p: 0 }, 0)!;
    expect(c.note).toBe('capture');
    expect(c.a[6]).toBe(8); // 7 captured + the capturing seed
    expect(c.a[1]).toBe(0);
    expect(c.a[11]).toBe(0);
  });

  it('ends when a side is empty, sweeping the rest into the owner’s store', () => {
    const base = mancala.init(createRng(1));
    const s: MancalaState = { ...base, a: [0, 0, 0, 0, 0, 1, 20, 2, 0, 0, 0, 0, 3, 10], t: 0 };
    const end = mancala.apply(s, { p: 5 }, 0)!;
    expect(end.a[6]).toBe(21);
    expect(end.a[13]).toBe(15);
    expect(end.w).toBe(0);
    expect(mancala.apply(base, { p: 7 }, 0)).toBeNull(); // not your pit
  });
});

describe('Trivia Duel', () => {
  it('draws 10 distinct questions with all four answers', () => {
    const s = triviaDuel.init(createRng(4));
    expect(s.qs).toHaveLength(10);
    expect(new Set(s.qs.map((q) => q[0])).size).toBe(10);
    for (const q of s.qs) expect([...q.slice(1)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('keeps answers locked until both are in, then scores and moves on', () => {
    let s = triviaDuel.init(createRng(4));
    const k = correctSlot(s);
    s = triviaDuel.apply(s, { c: k }, 0)!;
    expect(s.rev).toBe(false);
    expect(triviaDuel.apply(s, { c: k }, 0)).toBeNull(); // no changing a locked answer
    expect(triviaDuel.apply(s, { next: true }, 0)).toBeNull(); // can't skip before both answer
    s = triviaDuel.apply(s, { c: (k + 1) % 4 }, 1)!;
    expect(s.rev).toBe(true);
    expect(s.sc).toEqual([1, 0]);
    s = triviaDuel.apply(s, { next: true }, 1)!;
    expect(s).toMatchObject({ n: 1, ans: [-1, -1], rev: false });
  });

  it('ends after 10 questions with the higher score winning', () => {
    const end = playOut(triviaDuel as AnyGame, ['hard', 'easy'], 11) as TriviaDuelState;
    expect(end.n).toBe(9);
    expect(end.w).toBe(end.sc[0] > end.sc[1] ? 0 : end.sc[1] > end.sc[0] ? 1 : -1);
  });

  it('bot accuracy follows its level', () => {
    const rate = (level: BotLevel) => {
      let right = 0;
      const rng = createRng(77);
      for (let i = 0; i < 2000; i++) {
        const s = triviaDuel.init(rng);
        if ((triviaDuel.bot(s, 1, level, rng) as { c: number }).c === correctSlot(s)) right++;
      }
      return right / 2000;
    };
    expect(rate('easy')).toBeCloseTo(0.5, 1);
    expect(rate('normal')).toBeCloseTo(0.7, 1);
    expect(rate('hard')).toBeCloseTo(0.85, 1);
  });
});
