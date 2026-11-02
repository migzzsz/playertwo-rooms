import { dotsAndBoxes } from './games/dots-and-boxes';
import { dropFour } from './games/drop-four';
import { fleetFight } from './games/fleet-fight';
import { mancala } from './games/mancala';
import { triviaDuel } from './games/trivia-duel';
import { chess } from './games/chess';
import { ultimateNoughts } from './games/ultimate-noughts';
import { crazyEights } from './cards/crazy-eights';
import { ginRummy } from './cards/gin-rummy';
import { speed } from './cards/speed';
import { war } from './cards/war';
import type { GameDef } from './types';

/** The classics in shelf order. */
export const CLASSICS = [dropFour, fleetFight, dotsAndBoxes, ultimateNoughts, mancala, triviaDuel, chess] as const;
export type ClassicId = (typeof CLASSICS)[number]['id'];

// The catalogue is used generically (any game, any state), so states are opaque here.
type AnyGame = GameDef<unknown, unknown>;

/** The four card games, in table order. */
export const CARD_GAMES = [crazyEights, ginRummy, speed, war] as const;
export type CardGameId = (typeof CARD_GAMES)[number]['id'];

/** Any playable game (classic or card) by id. */
export function classicById(id: string): AnyGame | undefined {
  return ([...CLASSICS, ...CARD_GAMES] as readonly unknown[]).find((g) => (g as AnyGame).id === id) as AnyGame | undefined;
}

export const gameById = classicById;
