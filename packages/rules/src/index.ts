export type { Seat, Outcome, BotLevel, GameDef, RealtimeGameDef } from './types';
export { createRng, randomSeed, type Rng } from './rng';
export {
  dropFour,
  dropRow,
  lineThrough,
  COLS as DROP_FOUR_COLS,
  ROWS as DROP_FOUR_ROWS,
  type DropFourState,
  type DropFourAction,
} from './games/drop-four';
export { fleetFight, GRID, randomFleet, isValidFleet, shipCells, sunkShips, SHIP_LENGTHS, SHIP_NAMES, type Fleet, type FleetFightState, type FleetFightAction, type FleetFightView } from './games/fleet-fight';
export { dotsAndBoxes, openLines, type DotsAndBoxesState, type DotsAndBoxesAction } from './games/dots-and-boxes';
export { ultimateNoughts, legalSquares, type UltimateNoughtsState, type UltimateNoughtsAction } from './games/ultimate-noughts';
export { mancala, legalPits, storeOf, type MancalaState, type MancalaAction } from './games/mancala';
export { triviaDuel, correctSlot, currentQuestion, BOT_ACCURACY, TRIVIA_ROUNDS, type TriviaDuelState, type TriviaDuelAction } from './games/trivia-duel';
export { TRIVIA_BANK } from './games/trivia-bank';
export { CLASSICS, CARD_GAMES, classicById, gameById, type ClassicId, type CardGameId } from './catalogue';
export { DECK_SIZE, HIDDEN, rankOf, suitOf, cardName, cardLabel, SUIT_SYMBOLS, SUIT_NAMES, RANK_LABELS } from './cards/deck';
export { crazyEights, legalCards, playable, canDraw, handPenalty, type CrazyEightsState, type CrazyEightsAction } from './cards/crazy-eights';
export { ginRummy, bestArrangement, bestDiscard, cardPoints, KNOCK_LIMIT, type GinRummyState, type GinRummyAction, type GinShowdown, type Arrangement } from './cards/gin-rummy';
export { speed, connects, pilesFor, canPlayAny, isStuck, type SpeedState, type SpeedAction } from './cards/speed';
export { war, BATTLE_LIMIT, type WarState, type WarAction, type TableCard } from './cards/war';
export {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_IDLE_MS,
  SEAT_HOLD_MS,
  MAX_NAME_LENGTH,
  normaliseRoomCode,
  type ClientMessage,
  type ServerMessage,
  type SeatInfo,
} from './room-protocol';
export * from './datenight/library';
export * from './datenight/consent';
export * from './datenight/session';
export * from './datenight/generator';
export * from './datenight/after-hours';
