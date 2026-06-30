import { useQuery, useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import { isBefore, startOfDay, isToday } from 'date-fns'
import { Circle } from 'lucide-react'
import type { Collection, Todo } from '@/types'

export function TasksPage() {
  const navigate = useNavigate()
  const now = new Date()

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const visible = collections.filter((c) => c.name !== 'capture')
  const names   = collections.map((c) => c.name)

  const todoQueries = useQueries({
    queries: visible.map((c) => ({
      queryKey: ['todos', c.name],
      queryFn:  () => caldav.listTodos(c.name),
    })),
  })

  const projects = visible.map((col, i) => {
    const color = col.color ?? collectionColor(names, col.name).bg
    const todos: Todo[] = (todoQueries[i]?.data ?? []) as Todo[]

    const active = todos
      .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .sort((a, b) => {
        if (!a.due && !b.due) return 0
        if (!a.due) return 1
        if (!b.due) return -1
        return a.due.localeCompare(b.due)
      })
      .slice(0, 5)

    return { col, color, active, total: todos.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}>
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
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--foreground)' }}>Tasks</h1>
      </div>

      {/* Card grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {projects.map(({ col, color, active, total }) => (
            <ProjectCard
              key={col.name}
              col={col}
              color={color}
              active={active}
              total={total}
              now={now}
              onNavigate={() => navigate(`/${col.name}`)}
            />
          ))}
        </div>

        {projects.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ui-text-muted)', textAlign: 'center', paddingTop: 64 }}>
            No projects yet.
          </p>
        )}
      </div>
    </div>
  )
}

interface CardProps {
  col: Collection
  color: string
  active: Todo[]
  total: number
  now: Date
  onNavigate: () => void
}

function ProjectCard({ col, color, active, total, now, onNavigate }: CardProps) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header strip */}
      <button
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: color,
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col.display_name}
        </span>
        {total > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: '#fff',
              opacity: 0.75,
              flexShrink: 0,
            }}
          >
            {total} active
          </span>
        )}
      </button>

      {/* Task list */}
      <div style={{ padding: '6px 0' }}>
        {active.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ui-text-muted)', padding: '10px 14px', margin: 0 }}>
            Nothing to do!
          </p>
        ) : (
          active.map((todo, i) => {
            const due      = todo.due ? parseCalDate(todo.due) : null
            const overdue  = due ? isBefore(due, startOfDay(now)) && !isToday(due) : false
            const dueToday = due ? isToday(due) : false

            return (
              <div
                key={todo.uid}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 9,
                  padding: '7px 14px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <Circle
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    marginTop: 2,
                    color: overdue ? 'var(--destructive)' : `${color}99`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--foreground)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {todo.summary}
                  </p>
                </div>
                {due && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      flexShrink: 0,
                      color: overdue
                        ? 'var(--destructive)'
                        : dueToday
                        ? '#F59E0B'
                        : 'var(--ui-text-muted)',
                    }}
                  >
                    {fmtDateShort(due)}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
