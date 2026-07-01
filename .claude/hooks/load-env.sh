#!/usr/bin/env bash
# SessionStart hook: load .env + .env.local into the session so every Bash tool
# call has the CALSTAKK_* vars in scope.
#
# .env.local wins — the same net precedence the server gets via --env-file,
# reached the opposite way: the shell keeps the LAST value written, so we emit
# .env then .env.local; deno's --env-file keeps the FIRST, so the tasks load
# .env.local then .env. Mirror images, same result.
set -euo pipefail

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"

emit() {
  [ -f "$1" ] || return 0
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    v=${v%$'\r'}
    # %q quotes the value for safe shell re-input, so a secret in .env.local
    # with spaces or shell metacharacters can't produce a broken export line.
    printf 'export %s=%q\n' "$k" "$v"
  done < "$1"
}

# .env first, .env.local second — last write wins when the shell sources the
# file, so this preserves the precedence the server sees.
{ emit .env; emit .env.local; } >> "$CLAUDE_ENV_FILE"
