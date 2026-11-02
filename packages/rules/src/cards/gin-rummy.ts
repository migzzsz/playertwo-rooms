import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat, isInt, isObj, pick } from '../util';
import { freshDeck, hide, rankOf, remove, suitOf } from './deck';

/** Gin Rummy for two (docs/card-rules.md). Aces low; knock at 10 or less; undercut and gin bonuses 25. */
const HAND = 10;
export const KNOCK_LIMIT = 10;
const BONUS = 25;

export interface Arrangement {
  melds: number[][];
  deadwood: number[];
  /** Deadwood points: A = 1, 2–10 face value, J/Q/K = 10. */
  points: number;
}

export interface GinShowdown {
  knocker: Seat;
  gin: boolean;
  undercut: boolean;
  knockerMelds: number[][];
  /** Cards the defender laid off onto the knocker's melds. */
  layoffs: number[];
  defenderMelds: number[][];
  deadwood: [number, number];
  points: number;
}

export interface GinRummyState {
  hands: [number[], number[]];
  stock: number[];
  discard: number[];
  t: Seat;
  phase: 'upcard' | 'draw' | 'discard' | 'over';
  /** In the upcard phase: how many players have passed on the first face-up card. */
  upcardPasses: number;
  /** After both pass on the upcard, the starter must draw from the stock. */
  stockOnly: boolean;
  /** Card taken from the discard pile this turn (may not be discarded straight back). */
  took: number | null;
  /** Cards each player took from the discard pile (public). The Hard bot avoids feeding them. */
  picked: [number[], number[]];
  first: Seat;
  w: Outcome;
  showdown: GinShowdown | null;
  last: { seat: Seat; kind: 'take' | 'pass' | 'draw-stock' | 'draw-discard' | 'discard' | 'knock'; card?: number } | null;
}

export type GinRummyAction =
  | { type: 'take-upcard' }
  | { type: 'pass-upcard' }
  | { type: 'draw'; from: 'stock' | 'discard' }
  | { type: 'discard'; card: number }
  | { type: 'knock'; card: number };

export const cardPoints = (c: number) => Math.min(10, rankOf(c) + 1);

/** Every possible meld among these cards: sets of 3–4 and runs of 3+ in one suit (aces low). */
function candidateMelds(cards: readonly number[]): number[][] {
  const out: number[][] = [];
  const byRank = new Map<number, number[]>();
  for (const c of cards) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  for (const group of byRank.values()) {
    if (group.length < 3) continue;
    out.push(group);
    // With four of a kind, any three of them is also a set (freeing the fourth for a run).
    if (group.length === 4) for (let skip = 0; skip < 4; skip++) out.push(group.filter((_, i) => i !== skip));
  }
  const have = new Set(cards);
  for (let suit = 0; suit < 4; suit++)
    for (let start = 0; start < 13; start++)
      for (let len = 3; start + len <= 13; len++) {
        const run = Array.from({ length: len }, (_, k) => suit * 13 + start + k);
        if (!run.every((c) => have.has(c))) break;
        out.push(run);
      }
  return out;
}

/** The arrangement with the lowest deadwood (exhaustive search; hands are at most 11 cards). */
export function bestArrangement(cards: readonly number[]): Arrangement {
  const melds = candidateMelds(cards);
  let best: Arrangement = { melds: [], deadwood: [...cards], points: cards.reduce((n, c) => n + cardPoints(c), 0) };
  const search = (i: number, used: Set<number>, chosen: number[][]) => {
    if (i === melds.length) {
      const deadwood = cards.filter((c) => !used.has(c));
      const points = deadwood.reduce((n, c) => n + cardPoints(c), 0);
      if (points < best.points) best = { melds: chosen.map((m) => m.slice()), deadwood, points };
      return;
    }
    const m = melds[i]!;
    if (m.every((c) => !used.has(c))) {
      m.forEach((c) => used.add(c));
      chosen.push(m);
      search(i + 1, used, chosen);
      chosen.pop();
      m.forEach((c) => used.delete(c));
    }
    search(i + 1, used, chosen);
  };
  search(0, new Set(), []);
  return best;
}

/** Deadwood points after discarding the best card (what a knock would leave). */
export function bestDiscard(hand: readonly number[], banned: number | null): { card: number; points: number } {
  let best = { card: hand[0]!, points: Infinity };
  for (const c of hand) {
    if (c === banned) continue;
    const pts = bestArrangement(remove(hand, c)!).points;
    if (pts < best.points || (pts === best.points && cardPoints(c) > cardPoints(best.card))) best = { card: c, points: pts };
  }
  return best;
}

/** Lay off the defender's deadwood onto the knocker's melds, repeating while anything fits. */
function layOff(melds: number[][], deadwood: number[]): { melds: number[][]; laid: number[]; rest: number[] } {
  const ms = melds.map((m) => m.slice());
  let rest = deadwood.slice();
  const laid: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of rest) {
      const target = ms.find((m) => {
        const isSet = m.every((x) => rankOf(x) === rankOf(m[0]!));
        if (isSet) return m.length < 4 && rankOf(c) === rankOf(m[0]!);
        const lo = Math.min(...m);
        const hi = Math.max(...m);
        return suitOf(c) === suitOf(lo) && (c === lo - 1 ? rankOf(lo) > 0 : c === hi + 1 && rankOf(hi) < 12);
      });
      if (target) {
        target.push(c);
        laid.push(c);
        rest = remove(rest, c)!;
        changed = true;
        break;
      }
    }
  }
  return { melds: ms, laid, rest };
}

function showdown(hands: [number[], number[]], knocker: Seat): { w: Seat; sd: GinShowdown } {
  const defender = (1 - knocker) as Seat;
  const k = bestArrangement(hands[knocker]);
  const d = bestArrangement(hands[defender]);
  const gin = k.points === 0;
  const lay = gin ? { melds: k.melds, laid: [], rest: d.deadwood } : layOff(k.melds, d.deadwood);
  const defenderPoints = lay.rest.reduce((n, c) => n + cardPoints(c), 0);
  const undercut = !gin && defenderPoints <= k.points;
  const w = undercut ? defender : knocker;
  const points = gin ? defenderPoints + BONUS : undercut ? k.points - defenderPoints + BONUS : defenderPoints - k.points;
  const deadwood: [number, number] = [0, 0];
  deadwood[knocker] = k.points;
  deadwood[defender] = defenderPoints;
  return { w, sd: { knocker, gin, undercut, knockerMelds: lay.melds, layoffs: lay.laid, defenderMelds: d.melds, deadwood, points } };
}

const other = (seat: Seat) => (1 - seat) as Seat;

function setHand(s: GinRummyState, seat: Seat, hand: number[]): [number[], number[]] {
  const hands: [number[], number[]] = [s.hands[0], s.hands[1]];
  hands[seat] = hand;
  return hands;
}

/* ---------- Bot ---------- */

function chooseAction(s: GinRummyState, me: Seat, level: BotLevel, rng: Rng): GinRummyAction {
  const hand = s.hands[me];
  const upcard = s.discard[s.discard.length - 1];
  // Does taking this card lower our best deadwood (after the discard it forces)?
  const helps = (card: number | undefined) => card !== undefined && bestDiscard([...hand, card], card).points < bestArrangement(hand).points;
  if (s.phase === 'upcard') return helps(upcard) ? { type: 'take-upcard' } : { type: 'pass-upcard' };
  if (s.phase === 'draw') return !s.stockOnly && helps(upcard) ? { type: 'draw', from: 'discard' } : { type: 'draw', from: 'stock' };
  // Discard phase.
  let choice = bestDiscard(hand, s.took);
  if (level === 'hard') {
    // Don't feed the opponent: avoid cards matching or next to what they took from the pile.
    const opp = s.picked[other(me)];
    const risky = (c: number) => opp.some((p) => rankOf(p) === rankOf(c) || (suitOf(p) === suitOf(c) && Math.abs(rankOf(p) - rankOf(c)) <= 2));
    if (risky(choice.card)) {
      const alt = hand
        .filter((c) => c !== s.took && !risky(c))
        .map((c) => ({ card: c, points: bestArrangement(remove(hand, c)!).points }))
        .sort((x, y) => x.points - y.points)[0];
      if (alt && alt.points <= choice.points + 2) choice = alt;
    }
  }
  const late = s.stock.length < 10;
  const knockAt = level === 'easy' ? KNOCK_LIMIT : level === 'hard' ? (late ? KNOCK_LIMIT : 3) : late ? KNOCK_LIMIT : 7;
  if (choice.points <= knockAt && choice.points <= KNOCK_LIMIT) return { type: 'knock', card: choice.card };
  if (level === 'easy' && rng.next() < 0.5) return { type: 'discard', card: pick(hand.filter((c) => c !== s.took), rng) };
  return { type: 'discard', card: choice.card };
}

export const ginRummy: GameDef<GinRummyState, GinRummyAction> = {
  id: 'gin-rummy',
  name: 'Gin Rummy',
  hiddenInfo: true,
  init(rng, opts) {
    const deck = freshDeck(rng);
    const first = firstSeat(opts);
    const hands: [number[], number[]] = [deck.splice(0, HAND), deck.splice(0, HAND)];
    const upcard = deck.shift()!;
    return { hands, stock: deck, discard: [upcard], t: first, phase: 'upcard', upcardPasses: 0, stockOnly: false, took: null, picked: [[], []], first, w: null, showdown: null, last: null };
  },
  turnOf: (s) => (s.w === null && s.phase !== 'over' ? s.t : null),
  canAct: (s, seat) => s.w === null && s.phase !== 'over' && s.t === seat,
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a)) return null;
    const top = s.discard[s.discard.length - 1];
    switch (a.type) {
      case 'take-upcard': {
        if (s.phase !== 'upcard' || top === undefined) return null;
        const picked: [number[], number[]] = [s.picked[0], s.picked[1]];
        picked[seat] = [...picked[seat], top];
        return { ...s, hands: setHand(s, seat, [...s.hands[seat], top]), discard: s.discard.slice(0, -1), phase: 'discard', took: top, picked, last: { seat, kind: 'take', card: top } };
      }
      case 'pass-upcard': {
        if (s.phase !== 'upcard') return null;
        const passes = s.upcardPasses + 1;
        if (passes === 1) return { ...s, upcardPasses: passes, t: other(seat), last: { seat, kind: 'pass' } };
        return { ...s, upcardPasses: passes, t: s.first, phase: 'draw', stockOnly: true, last: { seat, kind: 'pass' } };
      }
      case 'draw': {
        if (s.phase !== 'draw') return null;
        if (a.from === 'stock') {
          if (!s.stock.length) return null;
          const [card, ...stock] = s.stock;
          return { ...s, hands: setHand(s, seat, [...s.hands[seat], card!]), stock, phase: 'discard', took: null, stockOnly: false, last: { seat, kind: 'draw-stock' } };
        }
        if (a.from !== 'discard' || s.stockOnly || top === undefined) return null;
        const picked: [number[], number[]] = [s.picked[0], s.picked[1]];
        picked[seat] = [...picked[seat], top];
        return { ...s, hands: setHand(s, seat, [...s.hands[seat], top]), discard: s.discard.slice(0, -1), phase: 'discard', took: top, picked, last: { seat, kind: 'draw-discard', card: top } };
      }
      case 'discard':
      case 'knock': {
        if (s.phase !== 'discard' || !isInt(a.card, 0, 51) || a.card === s.took) return null;
        const hand = remove(s.hands[seat], a.card);
        if (!hand) return null;
        if (a.type === 'knock') {
          if (bestArrangement(hand).points > KNOCK_LIMIT) return null;
          const hands = setHand(s, seat, hand);
          const { w, sd } = showdown(hands, seat);
          return { ...s, hands, discard: [...s.discard, a.card], phase: 'over', w, showdown: sd, took: null, last: { seat, kind: 'knock', card: a.card } };
        }
        const next: GinRummyState = { ...s, hands: setHand(s, seat, hand), discard: [...s.discard, a.card], t: other(seat), phase: 'draw', took: null, last: { seat, kind: 'discard', card: a.card } };
        // Two cards left in the stock and no knock: the hand is void.
        if (next.stock.length <= 2) return { ...next, phase: 'over', w: -1 };
        return next;
      }
      default:
        return null;
    }
  },
  result: (s) => s.w,
  bot: (s, seat, level, rng) => chooseAction(s, seat, level, rng),
  view(s, seat) {
    const opp = other(seat);
    const hands: [number[], number[]] = [s.hands[0].slice(), s.hands[1].slice()];
    if (s.phase !== 'over') hands[opp] = hide(s.hands[opp]);
    return { ...s, hands, stock: hide(s.stock) };
  },
};
