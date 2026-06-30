import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isToday, isBefore, startOfDay } from 'date-fns'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtTime, fmtDateShort } from '@/lib/dates'
import { Circle, CheckCircle2 } from 'lucide-react'
import type { Collection, CalEvent, Todo } from '@/types'

type EventMeta = CalEvent & { _colName: string; _colDisplayName: string; _colColor: string }
type TodoMeta  = Todo      & { _colName: string; _colDisplayName: string; _colColor: string }

export function TodayPage() {
  const qc  = useQueryClient()
  const now = new Date()
  const todayLabel = format(now, 'EEEE, MMMM d')

  // ── Responsive ───────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNarrow, setIsNarrow]       = useState(false)
  const [activePane, setActivePane]   = useState<'tasks' | 'events'>('tasks')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 680)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const names          = collections.map((c) => c.name)
  const calCollections = collections.filter((c) => c.name !== 'capture')

  const eventQueries = useQueries({
    queries: calCollections.map((c) => ({
      queryKey: ['events', c.name],
      queryFn: () => caldav.listEvents(c.name),
    })),
  })

  const todoQueries = useQueries({
    queries: collections.map((c) => ({
      queryKey: ['todos', c.name],
      queryFn: () => caldav.listTodos(c.name),
    })),
  })

  // ── Derived data ─────────────────────────────────────────────────────────────
  const todayEvents: EventMeta[] = calCollections
    .flatMap((col, i) => {
      const color = collectionColor(names, col.name)
      const data  = (eventQueries[i]?.data ?? []) as CalEvent[]
      return data
        .filter((e) => {
          const start = parseCalDate(e.start)
          return start && isToday(start)
        })
        .map((e) => ({
          ...e,
          _colName:        col.name,
          _colDisplayName: col.display_name,
          _colColor:       col.color ?? color.bg,
        }))
    })
    .sort((a, b) => a.start.localeCompare(b.start))

  const todayTodos: TodoMeta[] = collections
    .flatMap((col, i) => {
      const color = collectionColor(names, col.name)
      const data  = (todoQueries[i]?.data ?? []) as Todo[]
      return data
        .filter((t) => {
          if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return false
          if (!t.due) return false
          const due = parseCalDate(t.due)
          if (!due) return false
          return isToday(due) || isBefore(due, startOfDay(now))
        })
        .map((t) => ({
          ...t,
          _colName:        col.name,
          _colDisplayName: col.display_name,
          _colColor:       col.color ?? color.bg,
        }))
    })
    .sort((a, b) => {
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due.localeCompare(b.due)
    })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const toggle = useMutation({
    mutationFn: ({ todo }: { todo: TodoMeta }) => {
      const { _colName, _colDisplayName: _dn, _colColor: _cc, ...cleanTodo } = todo
      return caldav.updateTodo(_colName, {
        ...cleanTodo,
        status: cleanTodo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED',
      })
    },
    onSuccess: (_, { todo }) => {
      qc.invalidateQueries({ queryKey: ['todos', todo._colName] })
    },
  })

  // ── Tasks pane ───────────────────────────────────────────────────────────────
  const TasksPane = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: isNarrow ? 'none' : '1px solid var(--border)',
      }}
    >
      <div style={{ padding: '14px 20px 10px', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ui-text-muted)' }}>
          Tasks
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
        {todayTodos.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, paddingTop: 48 }}>
            <CheckCircle2 style={{ width: 20, height: 20, color: 'var(--ui-text-muted)' }} />
            <p style={{ fontSize: 12, color: 'var(--ui-text-muted)', margin: 0 }}>All caught up.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {todayTodos.map((todo) => {
              const due     = todo.due ? parseCalDate(todo.due) : null
              const overdue = due ? isBefore(due, startOfDay(now)) && !isToday(due) : false
              return (
                <div
                  key={`${todo._colName}-${todo.uid}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '9px 10px',
                    borderRadius: 8,
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <button
                    style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: toggle.isPending ? 0.5 : 1 }}
                    onClick={() => toggle.mutate({ todo })}
                  >
                    <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : todo._colColor }} />
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 400, color: 'var(--foreground)', margin: 0 }}>
                      {todo.summary}
                    </p>
                    {todo.description && (
                      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {todo.description}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {overdue && due && (
                      <span style={{ fontSize: 11, color: 'var(--destructive)', fontWeight: 500 }}>
                        {fmtDateShort(due)}
                      </span>
                    )}
                    <CollectionBadge color={todo._colColor} label={todo._colDisplayName} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  // ── Events pane ──────────────────────────────────────────────────────────────
  const EventsPane = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 10px', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ui-text-muted)' }}>
          Events
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
        {todayEvents.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ui-text-muted)', padding: '8px 10px' }}>No events today.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {todayEvents.map((event) => (
              <div
                key={event.uid}
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  borderLeft: `3px solid ${event._colColor}`,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderLeftColor: event._colColor,
                  borderLeftWidth: 3,
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {event.summary}
                </p>
                {!event.all_day && event.start && (
                  <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
                    {fmtTime(event.start)}{event.end ? ` — ${fmtTime(event.end)}` : ''}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                )}
                <div style={{ marginTop: 4 }}>
                  <CollectionBadge color={event._colColor} label={event._colDisplayName} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}
    >
      {/* Top bar */}
      <div
        style={{
          flexShrink: 0,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          background: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          gap: 10,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--foreground)' }}>Today</h1>
        <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{todayLabel}</span>
        <div style={{ flex: 1 }} />
        {todayTodos.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
            {todayTodos.length} task{todayTodos.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Narrow: tab switcher */}
      {isNarrow && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        >
          {(['tasks', 'events'] as const).map((pane) => (
            <button
              key={pane}
              onClick={() => setActivePane(pane)}
              style={{
                flex: 1,
                padding: '9px 0',
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: activePane === pane ? '#F59E0B' : 'var(--muted-foreground)',
                borderBottom: activePane === pane ? '2px solid #F59E0B' : '2px solid transparent',
                textTransform: 'capitalize',
              }}
            >
              {pane}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isNarrow ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activePane === 'tasks' ? TasksPane : EventsPane}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {TasksPane}
          {EventsPane}
        </div>
      )}
    </div>
  )
}

function CollectionBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: '2px 7px',
        borderRadius: 20,
        background: `${color}1A`,
        color,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}
