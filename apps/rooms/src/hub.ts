import { randomBytes, randomInt } from 'node:crypto';
import {
  MAX_NAME_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_IDLE_MS,
  SEAT_HOLD_MS,
  classicById,
  createRng,
  normaliseRoomCode,
  randomSeed,
  type ClientMessage,
  type GameDef,
  type Outcome,
  type Seat,
  type SeatInfo,
  type ServerMessage,
} from '@playertwo/rules';

/** One connected client, whatever the transport. */
export interface Conn {
  send(msg: ServerMessage): void;
}

export interface GameResult {
  code: string;
  game: string;
  /** Winning seat, or -1 for a draw. */
  winner: Seat | -1;
  forfeit: boolean;
  names: [string, string];
  at: number;
}

interface SeatSlot {
  token: string;
  name: string;
  conn: Conn | null;
  /** When the player dropped, or null while connected. */
  leftAt: number | null;
}

interface Room {
  code: string;
  game: GameDef<unknown, unknown>;
  state: unknown;
  seats: [SeatSlot | null, SeatSlot | null];
  wins: [number, number];
  seq: number;
  rematch: [boolean, boolean];
  /** Who starts the next game: the loser of the last one (a draw swaps). */
  nextFirst: Seat;
  forfeit: Seat | null;
  /** The current game's result has been counted and reported. */
  settled: boolean;
  lastActive: number;
}

export interface HubOptions {
  now?: () => number;
  /** Seat hold and idle limits (overridable in tests). */
  holdMs?: number;
  idleMs?: number;
  onResult?: (r: GameResult) => void;
  /** Code generator (tests can make codes predictable). */
  makeCode?: () => string;
}

function defaultCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

function cleanName(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  // Printable text only, trimmed and capped: names are shown to the other player.
  const name = input.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

/**
 * The authoritative room server's logic (spec §8.3), independent of the socket transport.
 * Host is seat 0, guest seat 1. Every move is validated with GameDef.apply; each seat is sent
 * only its own view of hidden-information games.
 */
export class RoomHub {
  private rooms = new Map<string, Room>();
  private where = new Map<Conn, { code: string; seat: Seat }>();
  private now: () => number;
  private holdMs: number;
  private idleMs: number;
  private onResult: (r: GameResult) => void;
  private makeCode: () => string;

  constructor(opts: HubOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.holdMs = opts.holdMs ?? SEAT_HOLD_MS;
    this.idleMs = opts.idleMs ?? ROOM_IDLE_MS;
    this.onResult = opts.onResult ?? (() => undefined);
    this.makeCode = opts.makeCode ?? defaultCode;
  }

  /** Game id for a room code (for the /join page), or null. */
  gameOf(code: string): string | null {
    const c = normaliseRoomCode(code);
    return (c && this.rooms.get(c)?.game.id) ?? null;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  handle(conn: Conn, raw: unknown): void {
    const msg = raw as ClientMessage;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return conn.send({ type: 'error', code: 'bad_request' });
    switch (msg.type) {
      case 'create':
        return this.create(conn, msg.game, msg.name);
      case 'join':
        return this.join(conn, msg.code, msg.token, msg.name);
      case 'move':
        return this.move(conn, msg.action);
      case 'rematch':
        return this.askRematch(conn);
      case 'leave':
        return this.disconnect(conn);
      default:
        return conn.send({ type: 'error', code: 'bad_request' });
    }
  }

  disconnect(conn: Conn): void {
    const at = this.where.get(conn);
    this.where.delete(conn);
    if (!at) return;
    const room = this.rooms.get(at.code);
    const slot = room?.seats[at.seat];
    if (!room || !slot || slot.conn !== conn) return;
    slot.conn = null;
    slot.leftAt = this.now();
    this.other(room, at.seat)?.conn?.send({ type: 'presence', opponent: 'left' });
    this.broadcast(room);
  }

  /** Housekeeping: forfeit players away longer than the hold, close idle or abandoned rooms. */
  tick(): void {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      if (t - room.lastActive > this.idleMs) {
        this.close(room);
        continue;
      }
      const present = room.seats.map((s) => Boolean(s?.conn));
      if (!present[0] && !present[1] && room.seats.every((s) => !s || (s.leftAt !== null && t - s.leftAt > this.holdMs))) {
        this.close(room);
        continue;
      }
      for (const seat of [0, 1] as Seat[]) {
        const slot = room.seats[seat];
        if (!slot || slot.conn || slot.leftAt === null || t - slot.leftAt <= this.holdMs) continue;
        if (!this.seatsFull(room) || room.settled) continue;
        room.forfeit = seat;
        this.settle(room, (1 - seat) as Seat);
        room.seq++;
        this.broadcast(room);
      }
    }
  }

  /* ---------- Messages ---------- */

  private create(conn: Conn, gameId: unknown, name: unknown) {
    const game = typeof gameId === 'string' ? classicById(gameId) : undefined;
    if (!game) return conn.send({ type: 'error', code: 'bad_request' });
    this.disconnect(conn);
    let code = this.makeCode();
    for (let tries = 0; this.rooms.has(code); tries++) {
      if (tries > 50) return conn.send({ type: 'error', code: 'bad_request' });
      code = this.makeCode();
    }
    const room: Room = {
      code,
      game,
      state: game.init(createRng(randomSeed()), { first: 0 }),
      seats: [{ token: newToken(), name: cleanName(name, 'Player 1'), conn, leftAt: null }, null],
      wins: [0, 0],
      seq: 1,
      rematch: [false, false],
      nextFirst: 0,
      forfeit: null,
      settled: false,
      lastActive: this.now(),
    };
    this.rooms.set(code, room);
    this.seat(conn, room, 0);
  }

  private join(conn: Conn, rawCode: unknown, token: unknown, name: unknown) {
    const code = normaliseRoomCode(rawCode);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return conn.send({ type: 'error', code: 'not_found' });
    // Reclaiming a held seat with its token (reconnect, or a refresh).
    const mine = typeof token === 'string' ? ([0, 1] as Seat[]).find((s) => room.seats[s]?.token === token) : undefined;
    if (mine !== undefined) {
      const slot = room.seats[mine]!;
      if (slot.conn && slot.conn !== conn) this.where.delete(slot.conn);
      this.disconnect(conn);
      slot.conn = conn;
      slot.leftAt = null;
      room.lastActive = this.now();
      this.other(room, mine)?.conn?.send({ type: 'presence', opponent: 'here' });
      return this.seat(conn, room, mine);
    }
    if (room.seats[1]) return conn.send({ type: 'error', code: 'full' });
    this.disconnect(conn);
    room.seats[1] = { token: newToken(), name: cleanName(name, 'Player 2'), conn, leftAt: null };
    room.lastActive = this.now();
    room.seats[0]?.conn?.send({ type: 'presence', opponent: room.seats[0]?.conn ? 'here' : 'left' });
    this.seat(conn, room, 1);
  }

  private move(conn: Conn, action: unknown) {
    const at = this.where.get(conn);
    const room = at && this.rooms.get(at.code);
    if (!at || !room) return conn.send({ type: 'error', code: 'not_found' });
    // No moves until both players are seated, or after a forfeit.
    if (!this.seatsFull(room) || room.forfeit !== null) return conn.send({ type: 'error', code: 'illegal' });
    const next = room.game.apply(room.state, action, at.seat);
    if (!next) return conn.send({ type: 'error', code: 'illegal' });
    room.state = next;
    room.seq++;
    room.lastActive = this.now();
    const result = room.game.result(next);
    if (result !== null) this.settle(room, result);
    this.broadcast(room);
  }

  private askRematch(conn: Conn) {
    const at = this.where.get(conn);
    const room = at && this.rooms.get(at.code);
    if (!at || !room || !room.settled) return conn.send({ type: 'error', code: 'illegal' });
    room.rematch[at.seat] = true;
    room.lastActive = this.now();
    if (room.rematch[0] && room.rematch[1]) {
      room.state = room.game.init(createRng(randomSeed()), { first: room.nextFirst });
      room.rematch = [false, false];
      room.forfeit = null;
      room.settled = false;
    }
    room.seq++;
    this.broadcast(room);
  }

  /* ---------- Helpers ---------- */

  private seat(conn: Conn, room: Room, seat: Seat) {
    this.where.set(conn, { code: room.code, seat });
    conn.send({ type: 'joined', code: room.code, seat, token: room.seats[seat]!.token, game: room.game.id });
    room.seq++;
    this.broadcast(room);
  }

  private seatsFull(room: Room) {
    return Boolean(room.seats[0] && room.seats[1]);
  }

  private other(room: Room, seat: Seat) {
    return room.seats[(1 - seat) as Seat];
  }

  private settle(room: Room, result: Outcome) {
    if (room.settled || result === null) return;
    room.settled = true;
    if (result === -1) room.nextFirst = (1 - room.nextFirst) as Seat;
    else {
      room.wins[result]++;
      room.nextFirst = (1 - result) as Seat;
    }
    this.onResult({
      code: room.code,
      game: room.game.id,
      winner: result,
      forfeit: room.forfeit !== null,
      names: [room.seats[0]?.name ?? 'Player 1', room.seats[1]?.name ?? 'Player 2'],
      at: this.now(),
    });
  }

  private broadcast(room: Room) {
    const seats = room.seats.map((s): SeatInfo | null => (s ? { name: s.name, present: Boolean(s.conn) } : null)) as [SeatInfo | null, SeatInfo | null];
    for (const seat of [0, 1] as Seat[]) {
      const conn = room.seats[seat]?.conn;
      if (!conn) continue;
      // Hidden-information games: each seat gets only its redacted view, never the other fleet.
      const view = room.game.hiddenInfo && room.game.view ? room.game.view(room.state, seat) : room.state;
      conn.send({ type: 'state', game: room.game.id, view, seats, wins: [...room.wins], seq: room.seq, rematch: [...room.rematch], forfeit: room.forfeit });
    }
  }

  private close(room: Room) {
    for (const slot of room.seats) {
      if (!slot?.conn) continue;
      slot.conn.send({ type: 'error', code: 'expired' });
      this.where.delete(slot.conn);
    }
    this.rooms.delete(room.code);
  }
}

function newToken(): string {
  return randomBytes(16).toString('base64url');
}
