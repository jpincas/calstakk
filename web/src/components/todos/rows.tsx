/**
 * Shared row primitives for the task views (list + board): the todo row
 * itself, its sortable wrapper, and the inline "new task" input row.
 * Module-level components to prevent remounts on parent re-render.
 */

import { useState } from 'react'
import { isBefore, isToday, startOfDay } from 'date-fns'
import { CheckCircle2, Circle, Sun } from 'lucide-react'
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
  /** Single click — selection (plain/ctrl/shift semantics live in the handler). */
  onSelect: (e: React.MouseEvent) => void
  /** Double click — enter edit mode (inline title + detail panel). */
  onOpenEditor: () => void
  onEditValueChange: (v: string) => void
  onEditBlur: () => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export function TodoRow({
  todo, accentColor, readOnly, onToggle,
  isEditingTitle, editingValue, isExpanded, selected,
  onSelect, onOpenEditor, onEditValueChange, onEditBlur, onEditKeyDown,
}: TodoRowProps) {
  const [hovered, setHovered] = useState(false)
  const done = todo.status === 'COMPLETED'
  const due = todo.due ? parseCalDate(todo.due) : null
  const overdue = !done && !!due && isBefore(due, startOfDay(new Date())) && !isToday(due)
  const dueToday = !!due && isToday(due)
  const showControls = hovered || isEditingTitle

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
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
      <button
        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: readOnly ? 'default' : 'pointer', padding: 0 }}
        onClick={(e) => { e.stopPropagation(); if (!readOnly) onToggle() }}
      >
        {done
          ? <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
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
            style={{ width: '100%', fontSize: 17, lineHeight: '18px', height: '18px', color: 'var(--foreground)', background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', display: 'block' }}
          />
        ) : (
          <>
            <p style={{ fontSize: 17, lineHeight: '18px', color: done ? 'var(--ui-text-muted)' : 'var(--foreground)', margin: 0, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {todo.summary}
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 500, flexShrink: 0, color: '#F59E0B' }}>
            <Sun style={{ width: 13, height: 13 }} />
            Today
          </span>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 500, flexShrink: 0, color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
            {fmtDateShort(due)}
          </span>
        )
      )}
    </div>
  )
}

// ── SortableTodoRow ───────────────────────────────────────────────────────────

export function SortableTodoRow({ containerId, ...rowProps }: TodoRowProps & { containerId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowProps.todo.uid,
    data: { type: 'task', containerId },
    disabled: rowProps.readOnly,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      {...attributes}
      {...listeners}
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
