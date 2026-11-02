import { createRng, type Rng } from '../rng';
import { shuffle } from '../util';

/** Cards 0–51: rank = card % 13 (0 = Ace … 12 = King), suit = ⌊card / 13⌋ (0 ♣, 1 ♦, 2 ♥, 3 ♠). See docs/card-rules.md. */
export const DECK_SIZE = 52;
/** A face-down card in a redacted view. */
export const HIDDEN = -1;

export const rankOf = (card: number) => card % 13;
export const suitOf = (card: number) => Math.floor(card / 13);

export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const RANK_WORDS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'] as const;

/** "Queen of hearts", for screen readers and notes. */
export function cardName(card: number): string {
  if (card < 0) return 'face-down card';
  return `${RANK_WORDS[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;
}

export function cardLabel(card: number): string {
  return `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function freshDeck(rng: Rng): number[] {
  return shuffle(
    Array.from({ length: DECK_SIZE }, (_, i) => i),
    rng,
  );
}

/**
 * Card games keep their shuffling generator's state inside the game state, so `apply` stays
 * pure and replays exactly: resume the generator, use it, and store the new state.
 */
export function withRng<T>(seed: number, use: (rng: Rng) => T): { value: T; seed: number } {
  const rng = createRng(seed);
  const value = use(rng);
  return { value, seed: rng.state };
}

/** Replaces cards with HIDDEN, keeping only how many there are. */
export const hide = (cards: readonly number[]) => cards.map(() => HIDDEN);

export function remove(cards: readonly number[], card: number): number[] | null {
  const i = cards.indexOf(card);
  if (i < 0) return null;
  return [...cards.slice(0, i), ...cards.slice(i + 1)];
}
