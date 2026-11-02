import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRoomServer } from '../src/server';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

const open = (port: number) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

describe('room server limits', () => {
  it('refuses too many new games from one address', async () => {
    const { close } = await startRoomServer({ port: 3977, joinsPerMinute: 2 });
    stop = close;
    const ws = await open(3977);
    const replies: { type: string; code?: string }[] = [];
    ws.on('message', (d) => replies.push(JSON.parse(String(d))));
    for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ type: 'join', code: 'nope' }));
    await expect.poll(() => replies.length).toBe(3);
    expect(replies.map((r) => r.code)).toEqual(['not_found', 'not_found', 'rate_limited']);
    ws.close();
  });

  it('closes a socket that floods messages', async () => {
    const { close } = await startRoomServer({ port: 3978, messagesPer10s: 3 });
    stop = close;
    const ws = await open(3978);
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'rematch' }));
    expect(await closed).toBe(1008);
  });
});
