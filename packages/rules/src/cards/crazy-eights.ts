import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat, isInt, isObj, pick, shuffle } from '../util';
import { freshDeck, hide, rankOf, remove, suitOf, withRng } from './deck';

/** Crazy Eights for two (docs/card-rules.md). */
const EIGHT = 7;
const HAND = 7;

export interface CrazyEightsState {
  hands: [number[], number[]];
  stock: number[];
  /** Discard pile, top card last. */
  discard: number[];
  /** Suit to follow (the called suit after an 8). */
  suit: number;
  t: Seat;
  /** The card drawn this turn, which is the only card that may still be played; null if not drawn yet. */
  drawn: number | null;
  /** Passes in a row with nothing left to draw (two ends a blocked game). */
  passes: number;
  /** Suits each player had to draw on (public: everyone saw them draw). The Hard bot uses it. */
  drewOn: [number[], number[]];
  seed: number;
  w: Outcome;
  last: { seat: Seat; kind: 'play' | 'draw' | 'pass'; card?: number; suit?: number } | null;
}

export type CrazyEightsAction = { type: 'play'; card: number; suit?: number } | { type: 'draw' } | { type: 'pass' };

const top = (s: CrazyEightsState) => s.discard[s.discard.length - 1]!;

export function playable(s: CrazyEightsState, card: number): boolean {
  return rankOf(card) === EIGHT || rankOf(card) === rankOf(top(s)) || suitOf(card) === s.suit;
}

export function legalCards(s: CrazyEightsState, seat: Seat): number[] {
  const hand = s.hands[seat];
  if (s.drawn !== null) return hand.includes(s.drawn) && playable(s, s.drawn) ? [s.drawn] : [];
  return hand.filter((c) => playable(s, c));
}

/** Can a card still come from the stock (directly, or by reshuffling the discards under the top card)? */
export const canDraw = (s: CrazyEightsState) => s.stock.length > 0 || s.discard.length > 1;

/** Penalty points left in a hand: 8 = 50, picture cards 10, Ace 1, others face value. */
export function handPenalty(hand: readonly number[]): number {
  return hand.reduce((n, c) => n + (rankOf(c) === EIGHT ? 50 : rankOf(c) >= 10 ? 10 : rankOf(c) + 1), 0);
}

function nextTurn(s: CrazyEightsState, patch: Partial<CrazyEightsState>): CrazyEightsState {
  return { ...s, ...patch, t: (1 - s.t) as Seat, drawn: null };
}

function chooseSuit(hand: readonly number[], rng: Rng, avoid: readonly number[] = []): number {
  const counts = [0, 0, 0, 0];
  for (const c of hand) if (rankOf(c) !== EIGHT) counts[suitOf(c)]!++;
  // Prefer suits the opponent had to draw on (they likely lack them), then the suit we hold most.
  const score = (suit: number) => counts[suit]! * 10 + (avoid.includes(suit) ? 5 : 0) + rng.next();
  return [0, 1, 2, 3].reduce((best, suit) => (score(suit) > score(best) ? suit : best), 0);
}

function chooseAction(s: CrazyEightsState, me: Seat, level: BotLevel, rng: Rng): CrazyEightsAction {
  const legal = legalCards(s, me);
  if (!legal.length) return s.drawn === null && canDraw(s) ? { type: 'draw' } : { type: 'pass' };
  const hand = s.hands[me];
  if (level === 'easy') {
    const card = pick(legal, rng);
    return { type: 'play', card, suit: rankOf(card) === EIGHT ? rng.int(4) : undefined };
  }
  const opp = (1 - me) as Seat;
  const plain = legal.filter((c) => rankOf(c) !== EIGHT);
  if (plain.length) {
    // Normal: play the card whose suit we hold most of (keeps options open).
    // Hard: prefer switching to a suit the opponent has had to draw on.
    const weight = (c: number) => hand.filter((h) => suitOf(h) === suitOf(c)).length + (level === 'hard' && s.drewOn[opp].includes(suitOf(c)) ? 3 : 0) + rng.next() * 0.5;
    const card = plain.reduce((best, c) => (weight(c) > weight(best) ? c : best));
    return { type: 'play', card };
  }
  // Only eights are playable: play one and call the best suit.
  const eight = legal[0]!;
  return { type: 'play', card: eight, suit: chooseSuit(remove(hand, eight)!, rng, level === 'hard' ? s.drewOn[opp] : []) };
}

export const crazyEights: GameDef<CrazyEightsState, CrazyEightsAction> = {
  id: 'crazy-eights',
  name: 'Crazy Eights',
  hiddenInfo: true,
  init(rng, opts) {
    const deck = freshDeck(rng);
    const hands: [number[], number[]] = [deck.splice(0, HAND), deck.splice(0, HAND)];
    // Bury any eight that turns up as the starter, somewhere in the stock.
    let starter = deck.shift()!;
    while (rankOf(starter) === EIGHT) {
      deck.splice(1 + rng.int(deck.length - 1), 0, starter);
      starter = deck.shift()!;
    }
    return {
      hands,
      stock: deck,
      discard: [starter],
      suit: suitOf(starter),
      t: firstSeat(opts),
      drawn: null,
      passes: 0,
      drewOn: [[], []],
      seed: rng.int(2 ** 31),
      w: null,
      last: null,
    };
  },
  turnOf: (s) => (s.w === null ? s.t : null),
  canAct: (s, seat) => s.w === null && s.t === seat,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a)) return null;
    if (a.type === 'play') {
      if (!isInt(a.card, 0, 51) || !legalCards(s, seat).includes(a.card)) return null;
      const isEight = rankOf(a.card) === EIGHT;
      if (isEight && !isInt(a.suit, 0, 3)) return null;
      const hand = remove(s.hands[seat], a.card)!;
      const hands: [number[], number[]] = [s.hands[0], s.hands[1]];
      hands[seat] = hand;
      const suit = isEight ? (a.suit as number) : suitOf(a.card);
      return nextTurn(s, {
        hands,
        discard: [...s.discard, a.card],
        suit,
        passes: 0,
        w: hand.length === 0 ? seat : null,
        last: { seat, kind: 'play', card: a.card, suit: isEight ? suit : undefined },
      });
    }
    if (a.type === 'draw') {
      if (s.drawn !== null || !canDraw(s)) return null;
      let stock = s.stock;
      let discard = s.discard;
      let seed = s.seed;
      if (!stock.length) {
        // Reshuffle everything under the top discard into a new stock.
        const r = withRng(seed, (rng) => shuffle(discard.slice(0, -1), rng));
        stock = r.value;
        seed = r.seed;
        discard = [discard[discard.length - 1]!];
      }
      const [card, ...rest] = stock;
      const hands: [number[], number[]] = [s.hands[0], s.hands[1]];
      hands[seat] = [...s.hands[seat], card!];
      const drewOn: [number[], number[]] = [s.drewOn[0], s.drewOn[1]];
      drewOn[seat] = [...s.drewOn[seat], s.suit];
      const next: CrazyEightsState = { ...s, hands, stock: rest, discard, seed, drawn: card!, passes: 0, drewOn, last: { seat, kind: 'draw' } };
      // If the drawn card can't be played, the turn ends.
      return playable(next, card!) ? next : nextTurn(next, {});
    }
    if (a.type === 'pass') {
      // Pass after drawing (keeping a playable card), or when there's nothing to draw and nothing to play.
      const stuck = s.drawn === null && !canDraw(s) && legalCards(s, seat).length === 0;
      if (s.drawn === null && !stuck) return null;
      const passes = stuck ? s.passes + 1 : 0;
      let w: Outcome = null;
      if (passes >= 2) {
        const [p0, p1] = [handPenalty(s.hands[0]), handPenalty(s.hands[1])];
        w = p0 < p1 ? 0 : p1 < p0 ? 1 : -1;
      }
      return nextTurn(s, { passes, w, last: { seat, kind: 'pass' } });
    }
    return null;
  },
  result: (s) => s.w,
  score: (s) => [s.hands[0].length, s.hands[1].length],
  bot: (s, seat, level, rng) => chooseAction(s, seat, level, rng),
  view(s, seat) {
    const opp = (1 - seat) as Seat;
    const hands: [number[], number[]] = [s.hands[0].slice(), s.hands[1].slice()];
    // The other hand stays face down (only its size) until the game is over.
    hands[opp] = s.w === null ? hide(s.hands[opp]) : s.hands[opp].slice();
    return { ...s, hands, stock: hide(s.stock), drawn: seat === s.t ? s.drawn : null, seed: 0 };
  },
};
