import type { Rng } from '../rng';
import type { BotLevel, Outcome, RealtimeGameDef, Seat } from '../types';
import { isInt, isObj, pick, shuffle } from '../util';
import { freshDeck, hide, rankOf, remove, withRng } from './deck';

/**
 * Speed (docs/card-rules.md). Real time: both seats act whenever they like, and actions are
 * applied in arrival order. Hand 5, draw pile 15, side stacks 5, two centre piles.
 */
const HAND = 5;

export interface SpeedState {
  hands: [number[], number[]];
  draw: [number[], number[]];
  /** Face-down side stacks that feed the centre piles when both players are stuck. */
  side: [number[], number[]];
  /** Centre piles, top card last. */
  centre: [number[], number[]];
  /** Who has pressed Flip while stuck. */
  flip: [boolean, boolean];
  seed: number;
  w: Outcome;
  last: { seat: Seat; card: number; pile: 0 | 1 } | { flip: true } | null;
  /** Number of actions applied (lets clients spot "the pile moved before my card arrived"). */
  n: number;
  /** Set in views only: whether both players are stuck (a client can't see the other hand to tell). */
  stuck?: boolean;
}

export type SpeedAction = { type: 'play'; card: number; pile: 0 | 1 } | { type: 'flip' };

/** Ranks one apart, with King and Ace connecting. */
export function connects(a: number, b: number): boolean {
  const d = (rankOf(a) - rankOf(b) + 13) % 13;
  return d === 1 || d === 12;
}

const topOf = (pile: readonly number[]) => pile[pile.length - 1];

/** Piles (0, 1) this card can go on right now. */
export function pilesFor(s: SpeedState, card: number): (0 | 1)[] {
  return ([0, 1] as const).filter((p) => {
    const t = topOf(s.centre[p]);
    return t !== undefined && connects(card, t);
  });
}

export function canPlayAny(s: SpeedState, seat: Seat): boolean {
  return s.hands[seat].some((c) => pilesFor(s, c).length > 0);
}

/** Neither player has a card that fits: time to flip. */
export const isStuck = (s: SpeedState) => !canPlayAny(s, 0) && !canPlayAny(s, 1);

const remaining = (s: SpeedState, seat: Seat) => s.hands[seat].length + s.draw[seat].length;

function turnSides(s: SpeedState): SpeedState {
  let side: [number[], number[]] = [s.side[0], s.side[1]];
  let centre: [number[], number[]] = [s.centre[0], s.centre[1]];
  let seed = s.seed;
  if (!side[0].length || !side[1].length) {
    // Rebuild the side stacks from everything under the centre tops.
    const under = [...centre[0].slice(0, -1), ...centre[1].slice(0, -1), ...side[0], ...side[1]];
    if (under.length < 2) {
      // Nothing left to turn: fewer cards remaining wins.
      const [a, b] = [remaining(s, 0), remaining(s, 1)];
      return { ...s, flip: [false, false], w: a < b ? 0 : b < a ? 1 : -1, n: s.n + 1 };
    }
    const r = withRng(seed, (rng) => shuffle(under, rng));
    seed = r.seed;
    const half = Math.ceil(r.value.length / 2);
    side = [r.value.slice(0, half), r.value.slice(half)];
    centre = [[topOf(centre[0])!], [topOf(centre[1])!]];
  }
  const [a, ...restA] = side[0];
  const [b, ...restB] = side[1];
  return { ...s, side: [restA, restB], centre: [[...centre[0], a!], [...centre[1], b!]], flip: [false, false], seed, last: { flip: true }, n: s.n + 1 };
}

function chooseAction(s: SpeedState, me: Seat, rng: Rng): SpeedAction {
  const options = s.hands[me].flatMap((card) => pilesFor(s, card).map((pile) => ({ card, pile })));
  if (!options.length) return { type: 'flip' };
  // Prefer a play after which another of our cards still fits somewhere (keeps the run going).
  const keepsGoing = options.filter(({ card, pile }) => {
    const centre: [number[], number[]] = [s.centre[0], s.centre[1]];
    centre[pile] = [...centre[pile], card];
    const after = { ...s, centre };
    return remove(s.hands[me], card)!.some((c) => pilesFor(after, c).length > 0);
  });
  const choice = pick(keepsGoing.length ? keepsGoing : options, rng);
  return { type: 'play', card: choice.card, pile: choice.pile };
}

const DELAYS: Record<BotLevel, [number, number]> = { easy: [1600, 2400], normal: [900, 1500], hard: [500, 900] };

export const speed: RealtimeGameDef<SpeedState, SpeedAction> = {
  id: 'speed',
  name: 'Speed',
  realtime: true,
  simultaneous: true,
  hiddenInfo: true,
  init(rng) {
    const deck = freshDeck(rng);
    const take = (n: number) => deck.splice(0, n);
    const hands: [number[], number[]] = [take(HAND), take(HAND)];
    const draw: [number[], number[]] = [take(15), take(15)];
    const side: [number[], number[]] = [take(5), take(5)];
    const centre: [number[], number[]] = [take(1), take(1)];
    return { hands, draw, side, centre, flip: [false, false], seed: rng.int(2 ** 31), w: null, last: null, n: 0 };
  },
  turnOf: () => null,
  canAct: (s) => s.w === null,
  apply(s, a, seat) {
    if (s.w !== null || !isObj(a)) return null;
    if (a.type === 'play') {
      if (!isInt(a.card, 0, 51) || (a.pile !== 0 && a.pile !== 1)) return null;
      if (!s.hands[seat].includes(a.card) || !pilesFor(s, a.card).includes(a.pile)) return null;
      const hands: [number[], number[]] = [s.hands[0], s.hands[1]];
      const draw: [number[], number[]] = [s.draw[0], s.draw[1]];
      const centre: [number[], number[]] = [s.centre[0], s.centre[1]];
      let hand = remove(s.hands[seat], a.card)!;
      let pile = s.draw[seat];
      // Refill the hand to five from the draw pile.
      while (hand.length < HAND && pile.length) {
        hand = [...hand, pile[0]!];
        pile = pile.slice(1);
      }
      hands[seat] = hand;
      draw[seat] = pile;
      centre[a.pile] = [...centre[a.pile], a.card];
      const won = hand.length === 0 && pile.length === 0;
      return { ...s, hands, draw, centre, flip: [false, false], w: won ? seat : null, last: { seat, card: a.card, pile: a.pile }, n: s.n + 1 };
    }
    if (a.type === 'flip') {
      if (!isStuck(s) || s.flip[seat]) return null;
      const flip: [boolean, boolean] = [s.flip[0], s.flip[1]];
      flip[seat] = true;
      if (flip[0] && flip[1]) return turnSides({ ...s, flip });
      return { ...s, flip, n: s.n + 1 };
    }
    return null;
  },
  result: (s) => s.w,
  score: (s) => [remaining(s, 0), remaining(s, 1)],
  bot: (s, seat, _level, rng) => chooseAction(s, seat, rng),
  botDelay: (level) => DELAYS[level],
  view(s, seat) {
    const opp = (1 - seat) as Seat;
    const hands: [number[], number[]] = [s.hands[0].slice(), s.hands[1].slice()];
    hands[opp] = hide(s.hands[opp]);
    return { ...s, hands, draw: [hide(s.draw[0]), hide(s.draw[1])], side: [hide(s.side[0]), hide(s.side[1])], seed: 0, stuck: s.stuck ?? isStuck(s) };
  },
};
