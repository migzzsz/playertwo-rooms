import type { Seat } from './types';

/**
 * Two-device play protocol (spec §8.3), shared by the room server and the web client.
 * The server is authoritative: it validates every move with the game's rules and sends each
 * seat only what that seat may see (GameDef.view for hidden-information games).
 */

/** No 0/O or 1/l/i, so codes are easy to read aloud and type. Shown in uppercase. */
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ROOM_CODE_LENGTH = 4;
/** An absent player's seat is held this long, then they forfeit. */
export const SEAT_HOLD_MS = 2 * 60 * 1000;
/** Rooms with no activity for this long are closed. */
export const ROOM_IDLE_MS = 30 * 60 * 1000;
export const MAX_NAME_LENGTH = 16;

/** Lower-cases and checks a typed code. Returns null if it can't be a room code. */
export function normaliseRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toLowerCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export type ClientMessage =
  | { type: 'create'; game: string; name?: string }
  | { type: 'join'; code: string; token?: string; name?: string }
  | { type: 'move'; action: unknown }
  | { type: 'rematch' }
  | { type: 'leave' };

export interface SeatInfo {
  name: string;
  present: boolean;
  /** They pressed Leave: the seat is not coming back (no hold, no rematch). */
  gone?: boolean;
}

export type ServerMessage =
  /** You hold this seat. Keep the token (session storage) to reclaim it after a reconnect. */
  | { type: 'joined'; code: string; seat: Seat; token: string; game: string }
  | {
      type: 'state';
      game: string;
      /** The game state as this seat may see it. */
      view: unknown;
      seats: [SeatInfo | null, SeatInfo | null];
      wins: [number, number];
      /** Increases with every update; clients ignore older ones. */
      seq: number;
      /** Who has asked for a rematch. */
      rematch: [boolean, boolean];
      /** Seat that forfeited by staying away too long, if any. */
      forfeit: Seat | null;
    }
  | { type: 'error'; code: 'full' | 'not_found' | 'illegal' | 'bad_request' | 'expired' | 'rate_limited' }
  | { type: 'presence'; opponent: 'here' | 'left' };
