/**
 * Shared "waiting on" (RELATED-TO;RELTYPE=DEPENDS-ON) dependency helpers.
 * Used by both the detail panel's select and the list/board context menu's
 * "Waiting on" submenu — one cycle-safe candidate computation, not forked.
 */

import type { Todo } from '@/types'

/**
 * Open, non-cycle-forming candidates `targetUid` could wait on, within
 * `todos` (expected to be a single collection's todos). Excludes the target
 * itself, completed/cancelled todos, and any todo whose own dependency chain
 * already leads back to the target (which would create a cycle).
 */
export function waitingOnCandidates(todos: Todo[], targetUid: string): Todo[] {
  const byUid = new Map(todos.map((t) => [t.uid, t]))
  const leadsBackToTarget = (startUid: string): boolean => {
    const seen = new Set<string>()
    let cur: string | undefined = startUid
    while (cur && !seen.has(cur)) {
      if (cur === targetUid) return true
      seen.add(cur)
      cur = byUid.get(cur)?.depends_on
    }
    return false
  }
  return todos.filter((t) =>
    t.uid !== targetUid &&
    t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
    !leadsBackToTarget(t.uid),
  )
}
