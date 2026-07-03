/**
 * usePendingCompletion — grace period for ticking tasks off. A completed
 * task stays in place for a few seconds (rendered fading out, with an inline
 * Undo) before it actually leaves the list. The completion write itself is
 * NOT deferred — undo is a compensating write, so navigating away mid-fade
 * can never lose the completion.
 */

import { useState, useRef, useEffect } from 'react'

export const COMPLETION_GRACE_MS = 5000

export interface PendingCompletion {
  /** Keys currently in their grace period (stable identity between membership changes — safe as a memo dep). */
  pending: Set<string>
  has: (key: string) => boolean
  /** Start the grace period for a key (called when a task is completed). */
  add: (key: string) => void
  /** End the grace period early (undo, or the task left the list some other way). */
  remove: (key: string) => void
}

export function usePendingCompletion(delayMs: number = COMPLETION_GRACE_MS): PendingCompletion {
  const [pending, setPending] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const map = timers.current
    return () => { for (const t of map.values()) clearTimeout(t) }
  }, [])

  const remove = (key: string) => {
    const t = timers.current.get(key)
    if (t) clearTimeout(t)
    timers.current.delete(key)
    setPending((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const add = (key: string) => {
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    setPending((prev) => new Set(prev).add(key))
    timers.current.set(key, setTimeout(() => remove(key), delayMs))
  }

  return { pending, has: (key) => pending.has(key), add, remove }
}
