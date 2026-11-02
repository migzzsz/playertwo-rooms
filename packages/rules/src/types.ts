import type { Rng } from './rng';

/** 0 = Player One (mustard), 1 = Player Two (red). */
export type Seat = 0 | 1;
/** Winner seat, -1 for a draw, or null while still playing. */
export type Outcome = Seat | -1 | null;
export type BotLevel = 'easy' | 'normal' | 'hard';

/**
 * Every turn-based game implements this contract so it gets all three play modes,
 * the shelf picture and the room server for free. States and actions are plain JSON;
 * `apply` never mutates its input and returns null for an illegal action.
 */
export interface GameDef<S, A> {
  id: string;
  name: string;
  /** true → needs pass-the-device screen locally and redacted views online. */
  hiddenInfo?: boolean;
  /** true → both seats can act at once. */
  simultaneous?: boolean;
  init(rng: Rng, opts?: unknown): S;
  /** null when over or simultaneous. */
  turnOf(s: S): Seat | null;
  canAct(s: S, seat: Seat): boolean;
  apply(s: S, a: A, seat: Seat): S | null;
  result(s: S): Outcome;
  bot(s: S, seat: Seat, level: BotLevel, rng: Rng): A;
  /** Redacted state for that seat (hidden-info games). */
  view?(s: S, seat: Seat): unknown;
  score?(s: S): [number, number];
}

/**
 * Explicit real-time contract (spec: Speed "is not automatically compatible with the turn-based
 * GameDef"). Both seats may act at any moment; `apply` is order-dependent and the authority (the
 * room server online, the stage locally) applies actions strictly in arrival order. An action that
 * arrives after the state it relied on has changed is simply refused ("too slow").
 */
export interface RealtimeGameDef<S, A> extends GameDef<S, A> {
  realtime: true;
  /** Bot reaction delay range in milliseconds for a level. */
  botDelay(level: BotLevel): [number, number];
}
