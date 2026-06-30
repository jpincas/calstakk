#!/usr/bin/env bash
# PreToolUse hook for Bash: deny commands that route around the gate.
#
# Reads the tool input as JSON on stdin, checks the `command` field, and
# exits 2 with a stderr reason to block. Exit 0 lets the command proceed.
#
# Blocked:
#   - git commit --no-verify       (skips pre-commit hook)
#   - git push --force / -f to main (overwrites shared history)
#   - nohup / & disown              (use the tool's native backgrounding)
#   - direct shell writes to shadcn-managed primitives (use `npx shadcn add`):
#       web/src/components/ui/

set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

if [ -z "$cmd" ]; then
  exit 0
fi

block() {
  echo "blocked by deny-bypass hook: $1" >&2
  exit 2
}

case "$cmd" in
  *"--no-verify"*)
    block "git --no-verify skips the pre-commit gate. Fix the failure instead." ;;
  *nohup*|*"& disown"*|*"&disown"*)
    block "no nohup/disown — use your tool's native backgrounding (run_in_background: true)." ;;
esac

if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$))'; then
  if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(main|master)([[:space:]]|$)'; then
    block "force-push to main/master is denied."
  fi
fi

# Direct shell writes to shadcn-managed primitives — use `npx shadcn@latest add <name>` instead.
if printf '%s' "$cmd" | grep -Eq '(>|tee|sed -i|cp .* )(web/src/components/ui/)'; then
  block "don't edit shadcn primitives directly — use 'npx shadcn@latest add <name>'."
fi

exit 0
