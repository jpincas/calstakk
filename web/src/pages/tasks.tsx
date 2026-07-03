import { useQuery, useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import { canonicalTaskOrder } from '@/lib/todoOrder'
import { isBefore, startOfDay, isToday } from 'date-fns'
import { Circle, ListTodo, Sun } from 'lucide-react'
import type { Collection, Section, Todo } from '@/types'
import { PageBar } from '@/components/layout/PageBar'

export function TasksPage() {
  const navigate = useNavigate()
  const now = new Date()

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const visible = collections.filter((c) => c.ref !== 'capture')
  const names   = collections.map((c) => c.ref)

  const todoQueries = useQueries({
    queries: visible.map((c) => ({
      queryKey: ['todos', c.ref],
      queryFn:  () => caldav.listTodos(c.ref),
    })),
  })

  const sectionQueries = useQueries({
    queries: visible.map((c) => ({
      queryKey: ['sections', c.ref],
      queryFn:  () => caldav.getSections(c.ref),
      staleTime: 60_000,
    })),
  })

  const projects = visible.map((col, i) => {
    const color = col.color ?? collectionColor(names, col.ref).bg
    const todos: Todo[] = (todoQueries[i]?.data ?? [])
    const sections: Section[] = (sectionQueries[i]?.data ?? [])

    // Same order as the project's own task list (sections + manual sort).
    const ordered = canonicalTaskOrder(todos, sections)

    return { col, color, active: ordered.slice(0, 5), total: ordered.length }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}>
      <PageBar
        icon={<ListTodo size={14} color="#10B981" strokeWidth={2.2} />}
        title="Tasks"
        detail={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}
      />

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
              key={col.ref}
              col={col}
              color={color}
              active={active}
              total={total}
              now={now}
              onNavigate={() => { void navigate(`/${col.ref}`) }}
            />
          ))}
        </div>

        {projects.length === 0 && (
          <p style={{ fontSize: 17, color: 'var(--ui-text-muted)', textAlign: 'center', paddingTop: 64 }}>
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
        <span style={{ fontSize: 17, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col.display_name}
        </span>
        {total > 0 && (
          <span
            style={{
              fontSize: 14,
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
          <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', padding: '10px 14px', margin: 0 }}>
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
                  alignItems: 'center',
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
                    color: overdue ? 'var(--destructive)' : `${color}99`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 17,
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
                  dueToday ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 500, flexShrink: 0, color: '#F59E0B' }}>
                      <Sun style={{ width: 13, height: 13 }} />
                      Today
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        flexShrink: 0,
                        color: overdue ? 'var(--destructive)' : 'var(--ui-text-muted)',
                      }}
                    >
                      {fmtDateShort(due)}
                    </span>
                  )
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
