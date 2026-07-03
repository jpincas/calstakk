/**
 * GlobalTodoRow — read-mostly row for the cross-collection views (Waiting,
 * per-tag lists): checkbox (inert for blocked/read-only tasks), summary, due
 * date, and a collection badge that links to the task's project.
 */

import { isBefore, isToday, startOfDay } from 'date-fns'
import { Circle, CheckCircle2, Hourglass, Sun } from 'lucide-react'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import type { GlobalTodo } from './useGlobalTodos'

export interface GlobalTodoRowProps {
  todo: GlobalTodo
  /** Summary of the task this one waits on — renders the row greyed and non-tickable. */
  waitingOn?: string
  onToggle: (todo: GlobalTodo) => void
  onOpenCollection: (ref: string) => void
}

export function GlobalTodoRow({ todo, waitingOn, onToggle, onOpenCollection }: GlobalTodoRowProps) {
  const done = todo.status === 'COMPLETED'
  const due = todo.due ? parseCalDate(todo.due) : null
  const overdue = !done && !!due && isBefore(due, startOfDay(new Date())) && !isToday(due)
  const dueToday = !!due && isToday(due)
  const inert = todo._colReadOnly || !!waitingOn

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'default' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      <button
        title={waitingOn ? `Waiting on “${waitingOn}”` : undefined}
        style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: inert ? 'default' : 'pointer', padding: 0 }}
        onClick={inert ? undefined : () => onToggle(todo)}
      >
        {done
          ? <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
          : waitingOn
            ? <Hourglass style={{ width: 16, height: 16, color: 'var(--ui-text-muted)' }} />
            : <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : todo._colColor }} />
        }
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 17, lineHeight: '18px', color: waitingOn ? 'var(--ui-text-muted)' : 'var(--foreground)', margin: 0, overflowWrap: 'anywhere' }}>
          {todo.summary}
        </p>
        {waitingOn ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, color: 'var(--muted-foreground)', margin: '3px 0 0' }}>
            <Hourglass style={{ width: 11, height: 11, flexShrink: 0 }} />
            waiting on {waitingOn}
          </p>
        ) : todo.description ? (
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {todo.description}
          </p>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {due && (
          dueToday ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 500, color: '#F59E0B' }}>
              <Sun style={{ width: 13, height: 13 }} />
              Today
            </span>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 500, color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
              {fmtDateShort(due)}
            </span>
          )
        )}
        <button
          onClick={() => onOpenCollection(todo._colRef)}
          style={{
            fontSize: 13, fontWeight: 500, padding: '2px 7px', borderRadius: 20,
            background: `${todo._colColor}1A`, color: todo._colColor,
            border: 'none', cursor: 'pointer', flexShrink: 0,
          }}
        >
          {todo._colDisplayName}
        </button>
      </div>
    </div>
  )
}
