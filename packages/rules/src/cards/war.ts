import type { GameDef, Outcome, Seat } from '../types';
import { isObj, shuffle } from '../util';
import { HIDDEN, freshDeck, hide, rankOf, withRng } from './deck';

/** War (docs/card-rules.md): no decisions; both flip, higher card takes the trick, ties go to war. */
export const BATTLE_LIMIT = 300;
const WAR_DOWN = 3;

export interface TableCard {
  c: number;
  up: boolean;
}

export interface WarState {
  piles: [number[], number[]];
  /** Cards on the table this battle, per player, in the order played. */
  table: [TableCard[], TableCard[]];
  flip: [boolean, boolean];
  /** A tie is pending: the next flip goes to war (three down, one up). */
  war: boolean;
  battles: number;
  seed: number;
  w: Outcome;
  /** The last resolved battle: who took it, how many cards, and whether a war was involved. */
  last: { winner: Seat; cards: number; war: boolean } | null;
}

export type WarAction = { type: 'flip' };

/** Ace high. */
const value = (c: number) => (rankOf(c) === 0 ? 13 : rankOf(c));

function resolve(s: WarState): WarState {
  const piles: [number[], number[]] = [s.piles[0].slice(), s.piles[1].slice()];
  // A fresh battle starts a clean table (the last trick stayed on show until now); a war builds on it.
  const table: [TableCard[], TableCard[]] = s.war ? [s.table[0].slice(), s.table[1].slice()] : [[], []];
  for (const seat of [0, 1] as Seat[]) {
    if (s.war) {
      // Three face down, keeping at least one for the face-up card.
      const down = Math.min(WAR_DOWN, Math.max(0, piles[seat].length - 1));
      for (let i = 0; i < down; i++) table[seat].push({ c: piles[seat].shift()!, up: false });
    }
  }
  const empty = ([0, 1] as Seat[]).filter((seat) => piles[seat].length === 0);
  if (empty.length) {
    // Out of cards when a card is needed: that player loses (both out: draw).
    return { ...s, piles, table, flip: [false, false], w: empty.length === 2 ? -1 : ((1 - empty[0]!) as Seat) };
  }
  for (const seat of [0, 1] as Seat[]) table[seat].push({ c: piles[seat].shift()!, up: true });
  const a = value(table[0][table[0].length - 1]!.c);
  const b = value(table[1][table[1].length - 1]!.c);
  const battles = s.battles + 1;
  if (a === b) return { ...s, piles, table, flip: [false, false], war: true, battles };
  const winner: Seat = a > b ? 0 : 1;
  const pot = [...table[0], ...table[1]].map((t) => t.c);
  const r = withRng(s.seed, (rng) => shuffle(pot, rng));
  piles[winner] = [...piles[winner], ...r.value];
  let w: Outcome = null;
  if (piles[1 - winner]!.length === 0) w = winner;
  else if (battles >= BATTLE_LIMIT) w = piles[0].length > piles[1].length ? 0 : piles[1].length > piles[0].length ? 1 : -1;
  return { ...s, piles, table, flip: [false, false], war: false, battles, seed: r.seed, w, last: { winner, cards: pot.length, war: pot.length > 2 } };
}

export const war: GameDef<WarState, WarAction> = {
  id: 'war',
  name: 'War',
  simultaneous: true,
  hiddenInfo: true,
  init(rng) {
    const deck = freshDeck(rng);
    return { piles: [deck.slice(0, 26), deck.slice(26)], table: [[], []], flip: [false, false], war: false, battles: 0, seed: rng.int(2 ** 31), w: null, last: null };
  },
  turnOf: () => null,
  canAct: (s, seat) => s.w === null && !s.flip[seat],
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a) || a.type !== 'flip') return null;
    const flip: [boolean, boolean] = [s.flip[0], s.flip[1]];
    flip[seat] = true;
    if (!(flip[0] && flip[1])) return { ...s, flip };
    return resolve({ ...s, flip });
  },
  result: (s) => s.w,
  score: (s) => [s.piles[0].length, s.piles[1].length],
  bot: () => ({ type: 'flip' }),
  view(s) {
    // Pile order is secret; face-down war cards stay face down.
    const table = s.table.map((cards) => cards.map((t) => (t.up ? t : { c: HIDDEN, up: false }))) as [TableCard[], TableCard[]];
    return { ...s, piles: [hide(s.piles[0]), hide(s.piles[1])], table, seed: 0 };
  },
};
