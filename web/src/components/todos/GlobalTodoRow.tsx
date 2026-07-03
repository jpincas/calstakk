/**
 * GlobalTodoRow — row for the cross-collection views (Today, Waiting,
 * per-tag lists): checkbox (inert for blocked/read-only tasks), summary, due
 * date, and a collection badge that links to the task's project. Optionally
 * selectable (Today's multi-select) and fade-out aware (completion grace).
 */

import { useState } from 'react'
import { isBefore, isToday, startOfDay } from 'date-fns'
import { Circle, CheckCircle2, Hourglass, Sun } from 'lucide-react'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import { UndoPill } from './rows'
import type { GlobalTodo } from './useGlobalTodos'

export interface GlobalTodoRowProps {
  todo: GlobalTodo
  /** Summary of the task this one waits on — renders the row greyed and non-tickable. */
  waitingOn?: string
  /** Row is part of the view's selection. */
  selected?: boolean
  /** Just completed: render fading out with an inline Undo until the grace period ends. */
  fadingOut?: boolean
  /** Single click — selection semantics live in the handler. */
  onSelect?: (e: React.MouseEvent) => void
  onToggle: (todo: GlobalTodo) => void
  onOpenCollection: (ref: string) => void
}

export function GlobalTodoRow({ todo, waitingOn, selected = false, fadingOut = false, onSelect, onToggle, onOpenCollection }: GlobalTodoRowProps) {
  const [hovered, setHovered] = useState(false)
  const done = todo.status === 'COMPLETED'
  const due = todo.due ? parseCalDate(todo.due) : null
  const overdue = !done && !!due && isBefore(due, startOfDay(new Date())) && !isToday(due)
  const dueToday = !!due && isToday(due)
  const inert = todo._colReadOnly || (!done && !!waitingOn)

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8,
        cursor: onSelect ? 'pointer' : 'default', transition: 'background 100ms',
        background: selected || hovered ? 'var(--hover-bg)' : undefined,
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      {/* Everything except the Undo pill fades during the completion grace period */}
      <div
        className={fadingOut ? 'task-fading-out' : undefined}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}
      >
        <button
          title={waitingOn ? `Waiting on “${waitingOn}”` : undefined}
          style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: inert ? 'default' : 'pointer', padding: 0 }}
          onClick={inert ? (e) => e.stopPropagation() : (e) => { e.stopPropagation(); onToggle(todo) }}
        >
          {done
            ? <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
            : waitingOn
              ? <Hourglass style={{ width: 16, height: 16, color: 'var(--ui-text-muted)' }} />
              : <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : todo._colColor }} />
          }
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 17, lineHeight: '18px', color: !done && waitingOn ? 'var(--ui-text-muted)' : 'var(--foreground)', margin: 0, textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
            {todo.summary}
          </p>
          {!done && waitingOn ? (
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
            onClick={(e) => { e.stopPropagation(); onOpenCollection(todo._colRef) }}
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

      {fadingOut && (
        <UndoPill onClick={(e) => { e.stopPropagation(); onToggle(todo) }} />
      )}
    </div>
  )
}
