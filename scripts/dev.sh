#!/usr/bin/env bash
# The one command for UI development with hot reload. Runs two servers on fixed
# ports:
#   • CalDAV backend  → http://localhost:5232        (Deno)
#   • Vite dev server → http://localhost:5173/app/   (HMR, proxies CalDAV to :5232)
#
# ⇒ Open the app at  http://localhost:5173/app/  — NOT :5232, which only serves
#   the last *built* bundle (web/dist) with no hot reload.
#
# Frees both ports first (fuser -k) so ports stay predictable and zombie servers
# from earlier sessions don't pile up. Killing this process (Ctrl-C, or the
# agent stopping the background task) tears the backend down too.
set -euo pipefail
cd "$(dirname "$0")/.."

# Free our fixed ports so we always land on 5232 + 5173 — no drift, no zombies.
for port in 5232 5173; do
  if fuser -k "${port}/tcp" 2>/dev/null; then
    echo "cleared stale server on :${port}"
    sleep 0.3
  fi
done

# Backend in the background, vite in the foreground. Kill the backend when vite
# exits so we never leave a half-running environment behind.
~/.deno/bin/deno task backend &
backend=$!
trap 'kill "$backend" 2>/dev/null || true' EXIT

echo "backend up on :5232 (pid $backend) — starting vite dev on :5173"
echo "→ open http://localhost:5173/app/"
cd web && npm run dev
