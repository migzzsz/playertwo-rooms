import { startRoomServer } from './server';

const port = Number(process.env.PORT ?? 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const { close } = await startRoomServer({
  port,
  allowedOrigins,
  trustProxy: process.env.TRUST_PROXY === '1',
  // Results are reported here; storing them in game_results needs accounts (Supabase) first.
  onResult: (r) => console.log(`[result] ${r.game} ${r.code}: ${r.winner === -1 ? 'draw' : `seat ${r.winner} won`}${r.forfeit ? ' (forfeit)' : ''}`),
});
console.log(`PlayerTwo rooms listening on :${port}${allowedOrigins.length ? ` for ${allowedOrigins.join(', ')}` : ' (any origin: dev)'}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void close().then(() => process.exit(0)));
