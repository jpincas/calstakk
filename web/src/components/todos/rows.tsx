/**
 * Shared row primitives for the task views (list + board): the todo row
 * itself, its sortable wrapper, and the inline "new task" input row.
 * Module-level components to prevent remounts on parent re-render.
 */

import { useState } from 'react'
import { isBefore, isToday, startOfDay } from 'date-fns'
import { CheckCircle2, Circle, Hourglass, Sun } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import type { Todo } from '@/types'

// ── TodoRow ───────────────────────────────────────────────────────────────────

export interface TodoRowProps {
  todo: Todo
  accentColor: string
  readOnly: boolean
  onToggle: () => void
  isEditingTitle: boolean
  editingValue: string
  isExpanded: boolean
  selected: boolean
  /** Summary of the task this one is waiting on — set only while that task is still open. */
  waitingOn?: string
  /** Just completed: render fading out with an inline Undo until the grace period ends. */
  fadingOut?: boolean
  /** Single click — selection (plain/ctrl/shift semantics live in the handler). */
  onSelect: (e: React.MouseEvent) => void
  /** Double click — enter edit mode (inline title + detail panel). */
  onOpenEditor: () => void
  onEditValueChange: (v: string) => void
  onEditBlur: () => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/** Small inline pill for tags and the waiting indicator — flows with the summary text. */
function InlineChip({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '0 7px', borderRadius: 20, marginLeft: 6,
        background: bg, color,
        fontSize: 13, fontWeight: 500, lineHeight: '16px',
        verticalAlign: 'text-bottom', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

export function TodoRow({
  todo, accentColor, readOnly, onToggle,
  isEditingTitle, editingValue, isExpanded, selected, waitingOn, fadingOut,
  onSelect, onOpenEditor, onEditValueChange, onEditBlur, onEditKeyDown,
}: TodoRowProps) {
  const [hovered, setHovered] = useState(false)
  const done = todo.status === 'COMPLETED'
  const due = todo.due ? parseCalDate(todo.due) : null
  const overdue = !done && !!due && isBefore(due, startOfDay(new Date())) && !isToday(due)
  const dueToday = !!due && isToday(due)
  const showControls = hovered || isEditingTitle
  const waiting = !done && !!waitingOn

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px',
        borderRadius: isExpanded ? '8px 8px 0 0' : 8,
        cursor: 'pointer', transition: 'background 100ms',
        background: selected || showControls ? 'var(--hover-bg)' : undefined,
        // Double-click enters edit mode — must not flash a text selection first.
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={!isEditingTitle ? onSelect : undefined}
      onDoubleClick={!isEditingTitle ? onOpenEditor : undefined}
    >
      {/* Everything except the Undo pill fades during the completion grace period */}
      <div
        className={fadingOut ? 'task-fading-out' : undefined}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}
      >
      <button
        title={waiting ? `Waiting on “${waitingOn}”` : undefined}
        style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: readOnly || waiting ? 'default' : 'pointer', padding: 0 }}
        onClick={(e) => { e.stopPropagation(); if (!readOnly && !waiting) onToggle() }}
      >
        {done
          ? <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
          : waiting
            ? <Hourglass style={{ width: 16, height: 16, color: 'var(--ui-text-muted)' }} />
            : <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : accentColor }} />
        }
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditingTitle ? (
          <input
            autoFocus
            value={editingValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', fontSize: 17, lineHeight: '18px', height: '18px', color: 'var(--foreground)', background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', display: 'block', userSelect: 'text' }}
          />
        ) : (
          <>
            <p style={{ fontSize: 17, lineHeight: '18px', color: done || waiting ? 'var(--ui-text-muted)' : 'var(--foreground)', margin: 0, textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
              {todo.summary}
              {(todo.categories ?? []).map((cat) => (
                <InlineChip key={cat} bg={`${accentColor}1A`} color={accentColor}>{cat}</InlineChip>
              ))}
              {waiting && (
                <InlineChip bg="var(--hover-bg)" color="var(--muted-foreground)">
                  <Hourglass style={{ width: 10, height: 10 }} />
                  waiting on {waitingOn}
                </InlineChip>
              )}
            </p>
            {todo.description && (
              <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {todo.description}
              </p>
            )}
          </>
        )}
      </div>
      {!isEditingTitle && due && (
        dueToday ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 500, flexShrink: 0, color: '#F59E0B', lineHeight: '18px' }}>
            <Sun style={{ width: 13, height: 13 }} />
            Today
          </span>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 500, flexShrink: 0, color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)', lineHeight: '18px' }}>
            {fmtDateShort(due)}
          </span>
        )
      )}
      </div>
      {fadingOut && (
        <UndoPill onClick={(e) => { e.stopPropagation(); onToggle() }} />
      )}
    </div>
  )
}

/** Solid (never faded) inline cancel for a completion in its grace period. */
export function UndoPill({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Keep this task active"
      style={{
        flexShrink: 0, padding: '1px 10px', borderRadius: 20,
        border: '1px solid var(--border)', background: 'var(--card)',
        color: 'var(--foreground)', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', lineHeight: '16px',
      }}
    >
      Undo
    </button>
  )
}

// ── SortableTodoRow ───────────────────────────────────────────────────────────

export function SortableTodoRow({ containerId, ...rowProps }: TodoRowProps & { containerId: string }) {
  // Drag must stay off while the title is being edited — text selection in
  // the input would otherwise start a drag (same rule as section headers).
  const dragDisabled = rowProps.readOnly || rowProps.isEditingTitle
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowProps.todo.uid,
    data: { type: 'task', containerId },
    disabled: dragDisabled,
  })
  const handleProps = dragDisabled ? {} : { ...attributes, ...listeners }
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      {...handleProps}
    >
      <TodoRow {...rowProps} />
    </div>
  )
}

// ── InlineNewRow ──────────────────────────────────────────────────────────────

export interface InlineNewRowProps {
  value: string
  accentColor: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}

export function InlineNewRow({ value, accentColor, inputRef, onChange, onKeyDown, onBlur }: InlineNewRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, background: 'var(--hover-bg)' }}>
      <Circle style={{ width: 16, height: 16, color: accentColor, flexShrink: 0 }} />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder="Task name…"
        style={{ flex: 1, fontSize: 17, lineHeight: '18px', height: '18px', color: 'var(--foreground)', background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', display: 'block' }}
      />
    </div>
  )
}
