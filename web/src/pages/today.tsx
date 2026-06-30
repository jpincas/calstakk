import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isToday, isBefore, startOfDay } from 'date-fns'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtTime, fmtDateShort } from '@/lib/dates'
import { Circle } from 'lucide-react'
import type { Collection, CalEvent, Todo } from '@/types'

type EventMeta = CalEvent & { _colName: string; _colDisplayName: string; _colColor: string }
type TodoMeta = Todo & { _colName: string; _colDisplayName: string; _colColor: string }

export function TodayPage() {
  const qc = useQueryClient()
  const now = new Date()
  const todayLabel = format(now, 'EEEE, MMMM d')

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const names = collections.map((c: Collection) => c.name)
  const calCollections = collections.filter((c: Collection) => c.name !== 'capture')

  const eventQueries = useQueries({
    queries: calCollections.map((c: Collection) => ({
      queryKey: ['events', c.name],
      queryFn: () => caldav.listEvents(c.name),
    })),
  })

  const todoQueries = useQueries({
    queries: collections.map((c: Collection) => ({
      queryKey: ['todos', c.name],
      queryFn: () => caldav.listTodos(c.name),
    })),
  })

  const todayEvents: EventMeta[] = calCollections
    .flatMap((col: Collection, i: number) => {
      const color = collectionColor(names, col.name)
      const data = eventQueries[i]?.data ?? []
      return data
        .filter((e: CalEvent) => {
          const start = parseCalDate(e.start)
          return start && isToday(start)
        })
        .map((e: CalEvent) => ({
          ...e,
          _colName: col.name,
          _colDisplayName: col.display_name,
          _colColor: color.bg,
        }))
    })
    .sort((a: EventMeta, b: EventMeta) => a.start.localeCompare(b.start))

  const todayTodos: TodoMeta[] = collections
    .flatMap((col: Collection, i: number) => {
      const color = collectionColor(names, col.name)
      const data = todoQueries[i]?.data ?? []
      return data
        .filter((t: Todo) => {
          if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return false
          if (!t.due) return false
          const due = parseCalDate(t.due)
          if (!due) return false
          return isToday(due) || isBefore(due, startOfDay(now))
        })
        .map((t: Todo) => ({
          ...t,
          _colName: col.name,
          _colDisplayName: col.display_name,
          _colColor: color.bg,
        }))
    })
    .sort((a: TodoMeta, b: TodoMeta) => {
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due.localeCompare(b.due)
    })

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

  const isLoading = eventQueries.some((q) => q.isLoading) || todoQueries.some((q) => q.isLoading)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Loading…</div>
      </div>
    )
  }

  const isEmpty = todayEvents.length === 0 && todayTodos.length === 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 640, margin: '0 auto' }}>
      {/* Heading */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
            Today
          </h1>
          <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{todayLabel}</span>
        </div>
      </div>

      {isEmpty && (
        <div style={{ textAlign: 'center', paddingTop: 64 }}>
          <p style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Nothing scheduled for today.</p>
        </div>
      )}

      {/* Events */}
      {todayEvents.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <SectionLabel>Events</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {todayEvents.map((event) => (
              <div
                key={event.uid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 9,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${event._colColor}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.summary}
                  </p>
                  {!event.all_day && event.start && (
                    <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
                      {fmtTime(event.start)}
                      {event.end ? ` — ${fmtTime(event.end)}` : ''}
                    </p>
                  )}
                </div>
                <CollectionBadge color={event._colColor} label={event._colDisplayName} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Todos */}
      {todayTodos.length > 0 && (
        <section>
          <SectionLabel>Tasks</SectionLabel>
          <div className="cs-card" style={{ overflow: 'hidden' }}>
            {todayTodos.map((todo, i) => {
              const due = todo.due ? parseCalDate(todo.due) : null
              const overdue = due ? isBefore(due, startOfDay(now)) && !isToday(due) : false
              return (
                <div
                  key={`${todo._colName}-${todo.uid}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom:
                      i < todayTodos.length - 1
                        ? '1px solid var(--border)'
                        : 'none',
                  }}
                >
                  <button
                    style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: toggle.isPending ? 0.5 : 1 }}
                    onClick={() => toggle.mutate({ todo })}
                  >
                    <Circle
                      style={{
                        width: 16,
                        height: 16,
                        color: overdue ? 'var(--destructive)' : todo._colColor,
                      }}
                    />
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
        </section>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ui-text-muted)',
        margin: '0 0 8px',
      }}
    >
      {children}
    </p>
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
        color: color,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}
