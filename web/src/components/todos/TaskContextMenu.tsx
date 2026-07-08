/**
 * Right-click context menu shared by the task views (list + board):
 * quick due-date setters and move-to-collection.
 */

import { addDays } from 'date-fns'
import { CalendarClock, Hourglass } from 'lucide-react'
import { toIcalDate } from '@/lib/dates'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import type { Collection, Todo } from '@/types'

export interface TaskContextMenuProps {
  children: React.ReactNode
  collections: Collection[]
  currentCollection: string
  /** How many tasks the actions will apply to (>1 when the row is part of a multi-selection). */
  targetCount?: number
  onMove: (targetCollection: string) => void
  onSetDue: (due: string) => void
  /** Candidate tasks the target could wait on (cycle-safe, open, same collection). Omit to hide the submenu. */
  waitingOnCandidates?: Todo[]
  /** Whether the (single) target already has an active dependency, to show "Clear waiting-on". */
  isWaiting?: boolean
  /** Set (or clear, with `null`) the target's "waiting on" dependency. Single-target only. */
  onSetWaitingOn?: (uid: string | null) => void
}

export function TaskContextMenu({
  children, collections, currentCollection, targetCount = 1, onMove, onSetDue,
  waitingOnCandidates, isWaiting, onSetWaitingOn,
}: TaskContextMenuProps) {
  // Move targets must be writable — moving into a read-only shared collection would 403.
  const targets = collections.filter((c) => c.ref !== currentCollection && c.ref !== 'inbox' && c.myAccess !== 'read')
  return (
    <ContextMenu>
      <ContextMenuTrigger style={{ display: 'block' }}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {targetCount > 1 && (
          <>
            <div style={{ padding: '4px 8px', fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>
              {targetCount} selected tasks
            </div>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onSetDue(toIcalDate(new Date()))}>
          <CalendarClock style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.7 }} />
          Due today
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSetDue(toIcalDate(addDays(new Date(), 1)))}>
          <CalendarClock style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.7 }} />
          Due tomorrow
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {targets.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 16, color: 'var(--muted-foreground)' }}>No other lists</div>
            ) : (
              targets.map((c) => (
                <ContextMenuItem key={c.ref} onSelect={() => onMove(c.ref)}>
                  {c.display_name}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {targetCount === 1 && onSetWaitingOn && waitingOnCandidates && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Waiting on</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {isWaiting && (
                <>
                  <ContextMenuItem onSelect={() => onSetWaitingOn(null)}>
                    Clear waiting-on
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              {waitingOnCandidates.length === 0 ? (
                <div style={{ padding: '6px 8px', fontSize: 16, color: 'var(--muted-foreground)' }}>No other open tasks</div>
              ) : (
                waitingOnCandidates.map((t) => (
                  <ContextMenuItem key={t.uid} onSelect={() => onSetWaitingOn(t.uid)}>
                    <Hourglass style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.7 }} />
                    {t.summary}
                  </ContextMenuItem>
                ))
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
