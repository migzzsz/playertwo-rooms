import { describe, expect, it } from 'vitest';
import {
  CARD_GAMES,
  HIDDEN,
  bestArrangement,
  connects,
  createRng,
  crazyEights,
  ginRummy,
  isStuck,
  speed,
  war,
  type BotLevel,
  type CrazyEightsState,
  type GameDef,
  type GinRummyState,
  type Seat,
  type SpeedState,
  type WarState,
} from '../src';

type AnyGame = GameDef<unknown, unknown>;

/** Every card is somewhere, exactly once. */
function cardsInPlay(id: string, s: unknown): number[] {
  switch (id) {
    case 'crazy-eights':
    case 'gin-rummy': {
      const x = s as CrazyEightsState | GinRummyState;
      return [...x.hands[0], ...x.hands[1], ...x.stock, ...x.discard];
    }
    case 'speed': {
      const x = s as SpeedState;
      return [...x.hands[0], ...x.hands[1], ...x.draw[0], ...x.draw[1], ...x.side[0], ...x.side[1], ...x.centre[0], ...x.centre[1]];
    }
    case 'war': {
      const x = s as WarState;
      const pending = x.war ? [...x.table[0], ...x.table[1]].map((t) => t.c) : [];
      return [...x.piles[0], ...x.piles[1], ...pending];
    }
  }
  return [];
}

function conserved(id: string, s: unknown) {
  const all = cardsInPlay(id, s);
  if (id === 'war' && (s as WarState).w !== null) return;
  expect(all.length).toBe(52);
  expect(new Set(all).size).toBe(52);
}

/** Cards the other seat holds privately: none of them may appear in this seat's view. */
function secretsOf(id: string, s: unknown, seat: Seat): number[] {
  const opp = (1 - seat) as Seat;
  switch (id) {
    case 'crazy-eights':
    case 'gin-rummy': {
      const x = s as CrazyEightsState;
      return [...x.hands[opp], ...x.stock];
    }
    case 'speed': {
      const x = s as SpeedState;
      return [...x.hands[opp], ...x.draw[0], ...x.draw[1], ...x.side[0], ...x.side[1]];
    }
    case 'war':
      return [...(s as WarState).piles[0], ...(s as WarState).piles[1]];
  }
  return [];
}

function playOut(game: AnyGame, levels: [BotLevel, BotLevel], seed: number, check = false) {
  const rng = createRng(seed);
  let s = game.init(rng, { first: (seed % 2) as Seat });
  for (let steps = 0; game.result(s) === null; steps++) {
    if (steps > 5000) throw new Error(`${game.id}: stuck (seed ${seed})`);
    if (check) {
      conserved(game.id, s);
      for (const seat of [0, 1] as Seat[]) {
        if (game.result(s) !== null) break;
        const secrets = secretsOf(game.id, s, seat);
        // Hidden cards appear as -1 only. (Ids may coincide with public numbers like counts, so check arrays.)
        const v = game.view!(s, seat) as Record<string, unknown>;
        for (const key of ['hands', 'stock', 'draw', 'side', 'piles']) {
          const arr = v[key];
          if (!Array.isArray(arr)) continue;
          const flat = (arr as unknown[]).flat() as number[];
          for (const c of flat) if (c !== HIDDEN) expect(secrets.includes(c) && !visibleToSeat(game.id, s, seat, c)).toBe(false);
        }
      }
    }
    const seats = ([0, 1] as Seat[]).filter((seat) => game.canAct(s, seat));
    const turn = game.turnOf(s);
    // Real-time and simultaneous games: actions arrive in a random order.
    const order = turn !== null ? [turn] : rng.next() < 0.5 ? seats : [...seats].reverse();
    let moved = false;
    for (const seat of order) {
      const a = game.bot(s, seat, levels[seat], rng);
      const next = game.apply(s, a, seat);
      if (next) {
        s = next;
        moved = true;
        break;
      }
    }
    if (!moved) throw new Error(`${game.id}: no seat could act (seed ${seed})`);
  }
  return s;
}

/** Cards a seat legitimately sees: its own hand. */
function visibleToSeat(id: string, s: unknown, seat: Seat, c: number): boolean {
  if (id === 'war') return false;
  return (s as CrazyEightsState).hands[seat].includes(c);
}

describe('every card game', () => {
  for (const game of CARD_GAMES) {
    it(`${game.name}: 1,000 bot games end with no illegal moves, no lost cards and no stuck states`, () => {
      const results: Record<string, number> = {};
      for (let seed = 1; seed <= 1000; seed++) {
        const end = playOut(game as AnyGame, ['normal', 'normal'], seed, seed <= 40);
        const r = String(game.result(end as never));
        results[r] = (results[r] ?? 0) + 1;
      }
      expect(Object.values(results).reduce((a, b) => a + b, 0)).toBe(1000);
    }, 180_000);

    it(`${game.name}: Easy and Hard bots play legal games too`, () => {
      for (let seed = 1; seed <= 60; seed++) playOut(game as AnyGame, ['easy', 'hard'], seed);
    }, 120_000);

    it(`${game.name}: views never contain the other player's cards or the shuffle seed`, () => {
      const s = game.init(createRng(5)) as unknown as Record<string, unknown>;
      for (const seat of [0, 1] as Seat[]) {
        const v = game.view!(s as never, seat) as Record<string, unknown>;
        const secrets = secretsOf(game.id, s, seat);
        const shown = ['hands', 'stock', 'draw', 'side', 'piles'].flatMap((k) => (Array.isArray(v[k]) ? ((v[k] as unknown[]).flat() as number[]) : []));
        for (const c of secrets) expect(shown.includes(c)).toBe(false);
        if ('seed' in s) expect(v.seed).toBe(0);
      }
    });
  }
});

describe('Crazy Eights', () => {
  const base = () => crazyEights.init(createRng(3));
  const rig = (patch: Partial<CrazyEightsState>): CrazyEightsState => ({ ...base(), ...patch });

  it('matches rank or suit; eights are wild and need a called suit', () => {
    // Top: 5♦ (card 17). Hand: 5♣ (4), 9♦ (21), K♠ (51), 8♥ (33).
    const s = rig({ hands: [[4, 21, 51, 33], [0, 1, 2]], discard: [17], suit: 1, t: 0 });
    expect(crazyEights.apply(s, { type: 'play', card: 51 }, 0)).toBeNull();
    expect(crazyEights.apply(s, { type: 'play', card: 4 }, 0)).not.toBeNull();
    expect(crazyEights.apply(s, { type: 'play', card: 21 }, 0)).not.toBeNull();
    expect(crazyEights.apply(s, { type: 'play', card: 33 }, 0)).toBeNull(); // no suit called
    const e = crazyEights.apply(s, { type: 'play', card: 33, suit: 3 }, 0)!;
    expect(e.suit).toBe(3);
    expect(e.t).toBe(1);
  });

  it('drawing an unplayable card ends the turn; a playable one may be played', () => {
    const s = rig({ hands: [[51], [0, 1]], discard: [17], suit: 1, stock: [50, 18], t: 0 });
    const after = crazyEights.apply(s, { type: 'draw' }, 0)!; // draws Q♠: can't play on 5♦
    expect(after.t).toBe(1);
    expect(after.hands[0]).toEqual([51, 50]);
    const s2 = rig({ hands: [[51], [0, 1]], discard: [17], suit: 1, stock: [18, 50], t: 0 });
    const d = crazyEights.apply(s2, { type: 'draw' }, 0)!; // draws 6♦: playable
    expect(d.t).toBe(0);
    expect(crazyEights.apply(d, { type: 'play', card: 51 }, 0)).toBeNull(); // only the drawn card
    expect(crazyEights.apply(d, { type: 'draw' }, 0)).toBeNull(); // one draw per turn
    expect(crazyEights.apply(d, { type: 'play', card: 18 }, 0)!.t).toBe(1);
  });

  it('reshuffles the discards when the stock runs out, and a blocked game goes to the lower hand', () => {
    const s = rig({ hands: [[51], [0]], discard: [10, 11, 17], suit: 1, stock: [], t: 0 });
    const d = crazyEights.apply(s, { type: 'draw' }, 0)!;
    expect(d.discard).toEqual([17]);
    expect(d.hands[0]).toHaveLength(2);
    // Nothing to draw, nothing to play: both pass → lower penalty wins (A = 1 vs K = 10).
    const blocked = rig({ hands: [[51], [39]], discard: [17], suit: 1, stock: [], t: 0 }); // K♠ vs A♠ on 5♦
    const p1 = crazyEights.apply(blocked, { type: 'pass' }, 0)!;
    const p2 = crazyEights.apply(p1, { type: 'pass' }, 1)!;
    expect(p2.w).toBe(1);
  });

  it('emptying your hand wins', () => {
    const s = rig({ hands: [[4], [0, 1]], discard: [17], suit: 1, t: 0 });
    expect(crazyEights.apply(s, { type: 'play', card: 4 }, 0)!.w).toBe(0);
  });
});

describe('Gin Rummy', () => {
  const rig = (patch: Partial<GinRummyState>): GinRummyState => ({ ...ginRummy.init(createRng(2)), ...patch });

  it('finds the lowest-deadwood arrangement, with aces low', () => {
    // A♣ 2♣ 3♣ (run), 7♦ 7♥ 7♠ (set), K♣ (10), Q♠ A♦... deadwood K♣ 10 + Q♠ 10 + A♦ 1 = 21
    const a = bestArrangement([0, 1, 2, 19, 32, 45, 12, 50, 13]);
    expect(a.points).toBe(21);
    expect(a.melds).toHaveLength(2);
    // Q-K-A is not a run.
    expect(bestArrangement([11, 12, 0]).points).toBe(21);
    // A card in both a set and a run goes where it saves most.
    // 5-6-7♣ with 6♦ 6♥: run (leaves 6+6) or set of sixes (leaves 5+7) both leave 12.
    expect(bestArrangement([4, 5, 6, 18, 31]).points).toBe(12);
  });

  it('runs the upcard phase: take, or both pass and the starter draws from the stock', () => {
    const s = rig({});
    const p1 = ginRummy.apply(s, { type: 'pass-upcard' }, s.t)!;
    expect(p1.t).toBe(1 - s.t);
    const p2 = ginRummy.apply(p1, { type: 'pass-upcard' }, p1.t)!;
    expect(p2).toMatchObject({ phase: 'draw', t: s.t, stockOnly: true });
    expect(ginRummy.apply(p2, { type: 'draw', from: 'discard' }, p2.t)).toBeNull();
    const taken = ginRummy.apply(s, { type: 'take-upcard' }, s.t)!;
    expect(taken.phase).toBe('discard');
    expect(ginRummy.apply(taken, { type: 'discard', card: taken.took! }, taken.t)).toBeNull(); // not straight back
  });

  it('knocks only at 10 or less; gin beats everything; undercut goes to the defender', () => {
    // Knocker (0): run A-2-3♣, set 7♦7♥7♠, run 9-10-J♥, + 2♦ (2) + K♠ to discard → deadwood 2.
    const knocker = [0, 1, 2, 19, 32, 45, 34, 35, 36, 14, 51];
    // Defender (1): deadwood 1 (A♦) after melds: Q♣ K♣ J♣ run, 5♦5♥5♠ set, 9♣ 10♣? ... keep it simple
    const defender = [10, 11, 12, 17, 30, 43, 3, 16, 29, 13];
    const s = rig({ hands: [knocker, defender], phase: 'discard', t: 0, took: null });
    const k = ginRummy.apply(s, { type: 'knock', card: 51 }, 0)!;
    expect(k.phase).toBe('over');
    expect(k.showdown!.deadwood).toEqual([2, 1]);
    expect(k.w).toBe(1); // undercut: defender's 1 ≤ knocker's 2
    expect(k.showdown!.undercut).toBe(true);
    // Too much deadwood: refused.
    const loose = rig({ hands: [[0, 13, 26, 4, 18, 31, 44, 8, 22, 36, 50], defender], phase: 'discard', t: 0, took: null });
    expect(ginRummy.apply(loose, { type: 'knock', card: 50 }, 0)).toBeNull();
    // Gin: no deadwood at all.
    const ginHand = [0, 1, 2, 19, 32, 45, 34, 35, 36, 37, 51];
    const g = ginRummy.apply(rig({ hands: [ginHand, defender], phase: 'discard', t: 0, took: null }), { type: 'knock', card: 51 }, 0)!;
    expect(g.showdown!.gin).toBe(true);
    expect(g.w).toBe(0);
  });

  it('the defender lays off onto the knocker’s melds', () => {
    const knocker = [0, 1, 2, 19, 32, 45, 34, 35, 36, 14, 51]; // runs A-3♣, 9-J♥; set 7s; 2♦ deadwood
    // 4♣ extends A-3♣, Q♥ extends 9-J♥, 7♣ completes the 7s; 8s set and 9-J♦ run are the defender's own.
    const defender = [3, 37, 6, 20, 33, 46, 21, 22, 23, 50];
    const s = rig({ hands: [knocker, defender], phase: 'discard', t: 0, took: null });
    const k = ginRummy.apply(s, { type: 'knock', card: 51 }, 0)!;
    expect(k.showdown!.layoffs.sort((a, b) => a - b)).toEqual([3, 6, 37]);
    expect(k.showdown!.deadwood).toEqual([2, 10]); // only Q♠ left
  });

  it('bots actually finish hands: most games end in a knock or gin, not a void draw', () => {
    let decided = 0;
    let gins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const end = playOut(ginRummy as unknown as AnyGame, ['normal', 'normal'], seed) as GinRummyState;
      if (end.w !== -1) decided++;
      if (end.showdown?.gin) gins++;
    }
    expect(decided).toBeGreaterThan(150);
    expect(gins).toBeGreaterThan(0);
  });

  it('a hand with two cards left in the stock and no knock is a draw', () => {
    const s = rig({ hands: [[0, 13, 26, 4, 18, 31, 44, 8, 22, 36, 50], [1, 2, 3, 5, 6, 7, 9, 10, 11, 12]], stock: [40, 41], phase: 'discard', t: 0, took: null });
    const st = ginRummy.apply(s, { type: 'discard', card: 50 }, 0)!;
    expect(st.w).toBe(-1);
  });
});

describe('Speed', () => {
  it('connects ranks one apart, with King and Ace wrapping', () => {
    expect(connects(0, 12)).toBe(true); // A–K
    expect(connects(12, 0)).toBe(true);
    expect(connects(4, 5)).toBe(true);
    expect(connects(4, 6)).toBe(false);
    expect(connects(4, 17)).toBe(false); // same rank, different suit
  });

  it('refills the hand to five, and a second card for the same pile is refused if it no longer fits', () => {
    const s = speed.init(createRng(9));
    const rigged: SpeedState = { ...s, centre: [[4], [30]], hands: [[5, 40, 41, 42, 43], [3, 44, 45, 46, 47]] };
    // Both reach for pile 0 (top 5♣): seat 0's 6♣ (5) arrives first.
    const a = speed.apply(rigged, { type: 'play', card: 5, pile: 0 }, 0)!;
    expect(a.hands[0]).toHaveLength(5);
    expect(a.draw[0]).toHaveLength(14);
    // Seat 1's 4♣ (3) was meant for the 5♣, but the top is now 6♣: too slow.
    expect(speed.apply(a, { type: 'play', card: 3, pile: 0 }, 1)).toBeNull();
  });

  it('flip only works when both are stuck, and needs both players', () => {
    const s = speed.init(createRng(4));
    const stuck: SpeedState = { ...s, centre: [[0], [13]], hands: [[5, 6, 7, 8, 9], [18, 19, 20, 21, 22]] };
    expect(isStuck(stuck)).toBe(true);
    const one = speed.apply(stuck, { type: 'flip' }, 0)!;
    expect(one.flip).toEqual([true, false]);
    expect(speed.apply(one, { type: 'flip' }, 0)).toBeNull();
    const both = speed.apply(one, { type: 'flip' }, 1)!;
    expect(both.centre[0]).toHaveLength(2);
    expect(both.side[0]).toHaveLength(4);
    const notStuck: SpeedState = { ...s, centre: [[4], [30]], hands: [[5, 40, 41, 42, 43], [3, 44, 45, 46, 47]] };
    expect(speed.apply(notStuck, { type: 'flip' }, 0)).toBeNull();
  });
});

describe('War', () => {
  const rig = (a: number[], b: number[]): WarState => ({ ...war.init(createRng(1)), piles: [a, b] });
  const flipBoth = (s: WarState) => war.apply(war.apply(s, { type: 'flip' }, 0)!, { type: 'flip' }, 1)!;

  it('the higher card takes the battle, Ace high', () => {
    const s = flipBoth(rig([0, 5], [12, 6])); // A vs K
    expect(s.piles[0]).toHaveLength(3);
    expect(s.last).toMatchObject({ winner: 0, cards: 2, war: false });
  });

  it('a tie goes to war: three down, one up, winner takes all', () => {
    let s = rig([4, 1, 2, 3, 9, 20], [17, 21, 22, 23, 5, 30]); // 5♣ vs 5♦ tie; then 10♣ vs 6♣
    s = flipBoth(s);
    expect(s.war).toBe(true);
    s = flipBoth(s);
    expect(s.last).toMatchObject({ winner: 0, cards: 10, war: true });
    expect(s.piles[0]).toHaveLength(11);
  });

  it('running out during a war loses', () => {
    let s = rig([4, 1], [17, 21, 22, 23, 5]);
    s = flipBoth(s); // tie
    s = flipBoth(s); // seat 0 has 1 card: none face down, its 2♣ face up, loses to 6♣ and is out
    expect(s.w).toBe(1);
  });
});
