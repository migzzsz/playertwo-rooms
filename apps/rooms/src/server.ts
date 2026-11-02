import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomHub, type Conn, type HubOptions } from './hub';

export interface RoomServerOptions extends HubOptions {
  port: number;
  /** Origins allowed to open sockets and call the HTTP lookup. Empty = allow any (local dev). */
  allowedOrigins?: string[];
  tickMs?: number;
  /** Creates and joins allowed per IP per minute. */
  joinsPerMinute?: number;
  /** Messages allowed per socket per 10 seconds. */
  messagesPer10s?: number;
  /** Use X-Forwarded-For; only behind a proxy that sets it. */
  trustProxy?: boolean;
}

const MAX_MESSAGE_BYTES = 8 * 1024;
const HEARTBEAT_MS = 30_000;

/** Fixed window counter. */
function overLimit(hits: Map<string, { start: number; n: number }>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || now - cur.start > windowMs) {
    hits.set(key, { start: now, n: 1 });
    return false;
  }
  return ++cur.n > max;
}

/**
 * HTTP + WebSocket transport for the room hub.
 *   GET /health         → { ok: true, rooms }
 *   GET /rooms/:code    → { game } (so /join/CODE knows which game to open) or 404
 *   WS  /ws             → the room protocol (JSON messages)
 */
export function startRoomServer(opts: RoomServerOptions): Promise<{ server: Server; hub: RoomHub; close: () => Promise<void> }> {
  const hub = new RoomHub(opts);
  const allowed = opts.allowedOrigins ?? [];
  const originOk = (origin: string | undefined) => allowed.length === 0 || (origin !== undefined && allowed.includes(origin));

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && originOk(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method === 'GET' && url.pathname === '/health') return res.end(JSON.stringify({ ok: true, rooms: hub.roomCount() }));
    const m = req.method === 'GET' ? /^\/rooms\/([^/]+)$/.exec(url.pathname) : null;
    if (m) {
      const game = hub.gameOf(decodeURIComponent(m[1]!));
      res.statusCode = game ? 200 : 404;
      return res.end(JSON.stringify(game ? { game } : { error: 'not_found' }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/ws' || !originOk(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const alive = new WeakMap<WebSocket, boolean>();
  const joins = new Map<string, { start: number; n: number }>();
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const forwarded = opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    const flood = new Map<string, { start: number; n: number }>();
    const conn: Conn = { send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)) };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return conn.send({ type: 'error', code: 'bad_request' });
      }
      // A flood closes the socket; too many new games just gets a polite refusal.
      if (overLimit(flood, 'm', opts.messagesPer10s ?? 300, 10_000)) return ws.close(1008, 'rate limited');
      const type = (parsed as { type?: unknown } | null)?.type;
      if ((type === 'create' || type === 'join') && overLimit(joins, ip, opts.joinsPerMinute ?? 120, 60_000)) return conn.send({ type: 'error', code: 'rate_limited' });
      hub.handle(conn, parsed);
    });
    ws.on('close', () => hub.disconnect(conn));
    ws.on('error', () => ws.terminate());
  });

  // Drop sockets that stopped answering pings (sleeping phones, lost Wi-Fi) so their seat is held.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  const ticker = setInterval(() => hub.tick(), opts.tickMs ?? 5000);

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      clearInterval(ticker);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(() => resolve());
    });

  return new Promise((resolve) => server.listen(opts.port, () => resolve({ server, hub, close })));
}
