#!/usr/bin/env bash
# Stop hook (main agent): a fast, NON-blocking smoke check after coding turns.
#
# This is not the gate — the pre-commit hook (`deno task check`) is, and it runs
# the complete backend+web suite. This just surfaces backend type errors early so
# a broken edit doesn't sit unnoticed until commit time.
#
# Two deliberate choices:
#   - Dirty-tree guard: a stop hook fires on EVERY turn, including pure
#     conversation. If nothing changed there's nothing to check, so exit fast and
#     keep those turns free.
#   - Always exit 0: this is advisory. Claude Code blocks the main agent's turn
#     only on exit 2; we never want to trap the main loop on a smoke check.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Clean tree → nothing to smoke-check.
[ -n "$(git status --porcelain 2>/dev/null)" ] || exit 0

~/.deno/bin/deno check server.ts 2>&1 | tail -8
exit 0
