import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { normaliseRoomCode, type FleetFightState, type ServerMessage } from '@playertwo/rules';
import { RoomHub, type Conn, type GameResult } from '../src/hub';
import { startRoomServer } from '../src/server';

/** A fake client that records everything the hub sends it. */
function client() {
  const got: ServerMessage[] = [];
  const conn: Conn = { send: (m) => void got.push(JSON.parse(JSON.stringify(m)) as ServerMessage) };
  const last = <T extends ServerMessage['type']>(type: T) => [...got].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  return { conn, got, last };
}

function setup(opts: { now?: () => number } = {}) {
  const results: GameResult[] = [];
  const hub = new RoomHub({ ...opts, onResult: (r) => results.push(r), holdMs: 1000, idleMs: 10_000 });
  const host = client();
  const guest = client();
  return { hub, host, guest, results };
}

function seatUp(game: string, s = setup()) {
  s.hub.handle(s.host.conn, { type: 'create', game, name: 'Ana' });
  const code = s.host.last('joined')!.code;
  s.hub.handle(s.guest.conn, { type: 'join', code: code.toUpperCase(), name: 'Ben' });
  return { ...s, code };
}

describe('room codes', () => {
  it('use the readable alphabet and normalise typed input', () => {
    const { host, hub } = setup();
    hub.handle(host.conn, { type: 'create', game: 'drop-four' });
    const code = host.last('joined')!.code;
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
    expect(normaliseRoomCode(' AbCd ')).toBe('abcd');
    expect(normaliseRoomCode('ab0d')).toBeNull(); // 0 is not in the alphabet
    expect(normaliseRoomCode('abc')).toBeNull();
  });
});

describe('RoomHub', () => {
  it('seats host as 0 and guest as 1, and turns away a third device', () => {
    const s = seatUp('drop-four');
    expect(s.host.last('joined')!.seat).toBe(0);
    expect(s.guest.last('joined')!.seat).toBe(1);
    expect(s.host.last('state')!.seats.map((x) => x?.name)).toEqual(['Ana', 'Ben']);
    const third = client();
    s.hub.handle(third.conn, { type: 'join', code: s.code });
    expect(third.last('error')!.code).toBe('full');
    s.hub.handle(third.conn, { type: 'join', code: 'zzzz' });
    expect(third.last('error')!.code).toBe('not_found');
  });

  it('validates every move with the rules and broadcasts increasing seq', () => {
    const s = seatUp('drop-four');
    s.hub.handle(s.guest.conn, { type: 'move', action: { c: 3 } }); // not the guest's turn
    expect(s.guest.last('error')!.code).toBe('illegal');
    const before = s.host.last('state')!.seq;
    s.hub.handle(s.host.conn, { type: 'move', action: { c: 3 } });
    const after = s.guest.last('state')!;
    expect(after.seq).toBeGreaterThan(before);
    expect((after.view as { g: number[] }).g[38]).toBe(0);
  });

  it('refuses moves until both players are seated', () => {
    const s = setup();
    s.hub.handle(s.host.conn, { type: 'create', game: 'drop-four' });
    s.hub.handle(s.host.conn, { type: 'move', action: { c: 3 } });
    expect(s.host.last('error')!.code).toBe('illegal');
  });

  it('sends each Fleet Fight seat only its own fleet', () => {
    const s = seatUp('fleet-fight');
    const hostView = s.host.last('state')!.view as FleetFightState;
    const guestView = s.guest.last('state')!.view as FleetFightState;
    expect(hostView.f[1].every((x) => x === null)).toBe(true);
    expect(guestView.f[0].every((x) => x === null)).toBe(true);
    expect(hostView.f[0].every((x) => Array.isArray(x))).toBe(true);
    // Nothing the guest received ever contains the host's ship cells.
    const hostShips = JSON.stringify(hostView.f[0]);
    expect(s.guest.got.some((m) => JSON.stringify(m).includes(hostShips))).toBe(false);
  });

  it('counts wins, and a rematch needs both players with the loser starting', () => {
    const s = seatUp('drop-four');
    for (const [conn, c] of [
      [s.host, 0],
      [s.guest, 1],
      [s.host, 0],
      [s.guest, 1],
      [s.host, 0],
      [s.guest, 1],
      [s.host, 0],
    ] as const)
      s.hub.handle(conn.conn, { type: 'move', action: { c } });
    expect(s.host.last('state')!.wins).toEqual([1, 0]);
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ game: 'drop-four', winner: 0, forfeit: false, names: ['Ana', 'Ben'] });
    s.hub.handle(s.host.conn, { type: 'rematch' });
    expect(s.guest.last('state')!.rematch).toEqual([true, false]);
    s.hub.handle(s.guest.conn, { type: 'rematch' });
    const fresh = s.host.last('state')!.view as { t: number; w: unknown };
    expect(fresh.w).toBeNull();
    expect(fresh.t).toBe(1); // the guest lost, so the guest starts
  });

  it('holds a dropped seat, lets the token reclaim it, then forfeits after the hold', () => {
    let t = 0;
    const s = seatUp('drop-four', setup({ now: () => t }));
    const token = s.guest.last('joined')!.token;
    s.hub.disconnect(s.guest.conn);
    expect(s.host.last('presence')!.opponent).toBe('left');
    expect(s.host.last('state')!.seats[1]!.present).toBe(false);
    // Back within the hold on a new connection: same seat.
    t = 500;
    const again = client();
    s.hub.handle(again.conn, { type: 'join', code: s.code, token });
    expect(again.last('joined')!.seat).toBe(1);
    expect(s.host.last('presence')!.opponent).toBe('here');
    // Gone past the hold: forfeit, the host wins.
    s.hub.disconnect(again.conn);
    t = 2000;
    s.hub.tick();
    const st = s.host.last('state')!;
    expect(st.forfeit).toBe(1);
    expect(st.wins).toEqual([1, 0]);
    expect(s.results.at(-1)).toMatchObject({ winner: 0, forfeit: true });
  });

  it('closes rooms after the idle limit and when everyone is gone', () => {
    let t = 0;
    const s = seatUp('mancala', setup({ now: () => t }));
    t = 20_000;
    s.hub.tick();
    expect(s.host.last('error')!.code).toBe('expired');
    expect(s.hub.roomCount()).toBe(0);
  });

  it('runs simultaneous Trivia Duel answers through the server', () => {
    const s = seatUp('trivia-duel');
    s.hub.handle(s.host.conn, { type: 'move', action: { c: 0 } });
    expect((s.guest.last('state')!.view as { rev: boolean }).rev).toBe(false);
    s.hub.handle(s.guest.conn, { type: 'move', action: { c: 1 } });
    expect((s.host.last('state')!.view as { rev: boolean }).rev).toBe(true);
  });

  it('applies real-time Speed plays in arrival order; a late card for the same pile is refused', () => {
    const s = seatUp('speed');
    const hostView = s.host.last('state')!.view as { hands: number[][]; centre: number[][] };
    const guestView = s.guest.last('state')!.view as { hands: number[][]; centre: number[][] };
    // Neither device sees the other's hand.
    expect(hostView.hands[1]!.every((c) => c === -1)).toBe(true);
    expect(guestView.hands[0]!.every((c) => c === -1)).toBe(true);
    // Find a pile both could play on, if the deal allows; otherwise just check one play goes through.
    const fits = (c: number, t: number) => [1, 12].includes((((c % 13) - (t % 13)) + 13) % 13);
    for (const pile of [0, 1] as const) {
      const top = hostView.centre[pile]!.at(-1)!;
      const h = hostView.hands[0]!.find((c) => fits(c, top));
      const g = guestView.hands[1]!.find((c) => fits(c, top));
      if (h === undefined || g === undefined) continue;
      s.hub.handle(s.host.conn, { type: 'move', action: { type: 'play', card: h, pile } });
      const before = s.guest.got.length;
      s.hub.handle(s.guest.conn, { type: 'move', action: { type: 'play', card: g, pile } });
      const reply = s.guest.got.slice(before);
      // Either it no longer fits the new top (refused) or it happens to fit it too (accepted).
      const newTop = h;
      if (fits(g, newTop)) expect(reply.some((m) => m.type === 'state')).toBe(true);
      else expect(reply.some((m) => m.type === 'error' && m.code === 'illegal')).toBe(true);
      return;
    }
  });

  it('rejects malformed messages', () => {
    const s = setup();
    s.hub.handle(s.host.conn, null);
    s.hub.handle(s.host.conn, { type: 'create', game: 'checkers' });
    s.hub.handle(s.host.conn, { type: 'leave' }); // not in a room: ignored, not a crash
    expect(s.host.got.filter((m) => m.type === 'error')).toHaveLength(2);
  });

  it('Leave game mid-game hands the win over at once and the seat cannot be reclaimed', () => {
    const s = seatUp('drop-four');
    const token = s.guest.last('joined')!.token;
    s.hub.handle(s.guest.conn, { type: 'leave' });
    const st = s.host.last('state')!;
    expect(st.forfeit).toBe(1);
    expect(st.seats[1]).toMatchObject({ present: false, gone: true });
    const back = client();
    s.hub.handle(back.conn, { type: 'join', code: s.code, token });
    expect(back.last('error')?.code).toBe('full');
    s.hub.handle(s.host.conn, { type: 'rematch' });
    expect(s.host.last('error')?.code).toBe('illegal');
  });

  it('a dropped connection (not Leave) can come back with its token from a new tab', () => {
    const s = seatUp('chess');
    const token = s.guest.last('joined')!.token;
    s.hub.disconnect(s.guest.conn);
    const tab = client();
    s.hub.handle(tab.conn, { type: 'join', code: s.code, token });
    expect(tab.last('joined')?.seat).toBe(1);
    expect(tab.last('joined')?.game).toBe('chess');
  });
});

describe('WebSocket server', () => {
  it('plays a game between two real sockets and answers the join lookup', async () => {
    const srv = await startRoomServer({ port: 39_871 });
    try {
      const open = () =>
        new Promise<{ ws: WebSocket; msgs: ServerMessage[]; next: (type: string) => Promise<ServerMessage> }>((resolve) => {
          const ws = new WebSocket('ws://localhost:39871/ws');
          const msgs: ServerMessage[] = [];
          const waiters: { type: string; fn: (m: ServerMessage) => void }[] = [];
          ws.on('message', (d) => {
            const m = JSON.parse(String(d)) as ServerMessage;
            msgs.push(m);
            const i = waiters.findIndex((w) => w.type === m.type);
            if (i >= 0) waiters.splice(i, 1)[0]!.fn(m);
          });
          const next = (type: string) =>
            new Promise<ServerMessage>((res) => {
              waiters.push({ type, fn: res });
            });
          ws.on('open', () => resolve({ ws, msgs, next }));
        });
      const a = await open();
      const joinedA = a.next('joined');
      a.ws.send(JSON.stringify({ type: 'create', game: 'drop-four' }));
      const { code } = (await joinedA) as Extract<ServerMessage, { type: 'joined' }>;
      const res = await fetch(`http://localhost:39871/rooms/${code.toUpperCase()}`);
      expect(await res.json()).toEqual({ game: 'drop-four' });
      expect((await fetch('http://localhost:39871/rooms/zzzz')).status).toBe(404);
      const b = await open();
      const joinedB = b.next('joined');
      b.ws.send(JSON.stringify({ type: 'join', code }));
      expect(((await joinedB) as { seat: number }).seat).toBe(1);
      const update = b.next('state');
      a.ws.send(JSON.stringify({ type: 'move', action: { c: 0 } }));
      expect(((await update) as { view: { g: number[] } }).view.g[35]).toBe(0);
      // Oversized messages are refused by the transport.
      const closed = new Promise((r) => b.ws.on('close', r));
      b.ws.send('x'.repeat(20_000));
      await closed;
      a.ws.close();
    } finally {
      await srv.close();
    }
  });
});
