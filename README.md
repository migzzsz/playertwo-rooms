# PlayerTwo rooms

The WebSocket room server for PlayerTwo's online two-device play, plus the game rules it reuses.
This is a copy of `apps/rooms` and `packages/rules` from the main (private) PlayerTwo repo, kept
public so the host can deploy it. Make changes in the main repo and copy them here.

    npm ci --include=dev
    npx tsx apps/rooms/src/main.ts

Settings: `PORT`, `ALLOWED_ORIGINS` (comma-separated site addresses), `TRUST_PROXY=1` behind a proxy.
