import { useQuery, useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { addDays, format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { AlertTriangle, CheckCircle2, Hourglass, LayoutDashboard, Circle } from 'lucide-react'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtTime, fmtDateShort, isOverdue, calendarLinkFor } from '@/lib/dates'
import { canonicalTaskOrder } from '@/lib/todoOrder'
import { expandEvent, type Occurrence } from '@/lib/recur'
import { useGlobalTodos, type GlobalTodo } from '@/components/todos/useGlobalTodos'
import { PageBar } from '@/components/layout/PageBar'
import type { Collection, Section } from '@/types'

const ACCENT = '#F43F5E'

interface DayOccurrence {
  occ: Occurrence
  color: string
}

const sectionHeading: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
  margin: '0 0 10px',
}

const card: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  overflow: 'hidden',
}

export function DashboardPage() {
  const navigate = useNavigate()
  const now = new Date()
  const dayStart = startOfDay(now)
  const weekEnd = addDays(dayStart, 7)

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const visible = collections.filter((c) => c.ref !== 'capture')
  const names = collections.map((c) => c.ref)
  const { all, waiting, isLoading } = useGlobalTodos()

  const eventQueries = useQueries({
    queries: visible.map((c) => ({
      queryKey: ['events', c.ref],
      queryFn: () => caldav.listEvents(c.ref),
    })),
  })

  const sectionQueries = useQueries({
    queries: visible.map((c) => ({
      queryKey: ['sections', c.ref],
      queryFn: () => caldav.getSections(c.ref),
      staleTime: 60_000,
    })),
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const activeAll = all.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
  const overdue = activeAll.filter((t) => isOverdue(t.due))
  const blockedUids = new Set(waiting.map((w) => `${w.todo._colRef}/${w.todo.uid}`))

  const occurrences: DayOccurrence[] = visible.flatMap((col, i) => {
    const color = col.color ?? collectionColor(names, col.ref).bg
    return (eventQueries[i]?.data ?? [])
      .flatMap((e) => expandEvent(e, dayStart, weekEnd))
      .map((occ) => ({ occ, color }))
  })

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(dayStart, i)
    const next = addDays(day, 1)
    const events = occurrences
      .filter(({ occ }) => occ.start < next && occ.end > day)
      .sort((a, b) =>
        (a.occ.allDay === b.occ.allDay ? a.occ.start.getTime() - b.occ.start.getTime() : a.occ.allDay ? -1 : 1))
    const tasks = activeAll
      .filter((t) => {
        const due = t.due ? parseCalDate(t.due) : null
        return !!due && due >= day && due < next
      })
      .sort((a, b) => a.summary.localeCompare(b.summary))
    return { day, events, tasks }
  })

  const projects = visible.map((col, i) => {
    const todos = all.filter((t) => t._colRef === col.ref)
    const sections: Section[] = sectionQueries[i]?.data ?? []
    const ordered = canonicalTaskOrder(todos, sections)
    const done = todos.filter((t) => t.status === 'COMPLETED').length
    return {
      col,
      color: col.color ?? collectionColor(names, col.ref).bg,
      top: ordered.slice(0, 2),
      active: ordered.length,
      done,
      overdue: ordered.filter((t) => isOverdue(t.due)).length,
      blocked: ordered.filter((t) => blockedUids.has(`${col.ref}/${t.uid}`)).length,
    }
  })

  const openTodo = (t: GlobalTodo) => {
    void navigate(t._colRef === 'capture' ? '/inbox' : `/${t._colRef}`)
  }

  const dayLabel = (day: Date) =>
    isToday(day) ? 'Today' : isTomorrow(day) ? 'Tomorrow' : format(day, 'EEE d')

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ui-text-muted)', fontSize: 17 }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}>
      <PageBar
        icon={<LayoutDashboard size={14} color={ACCENT} strokeWidth={2.2} />}
        title="Home"
        detail={format(now, 'EEEE, d MMMM')}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* Overdue banner */}
        {overdue.length > 0 && (
          <button
            onClick={() => { void navigate('/today') }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', borderRadius: 10, textAlign: 'left',
              border: '1px solid color-mix(in srgb, var(--destructive) 35%, transparent)',
              background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
              color: 'var(--destructive)', fontSize: 16, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
            {overdue.length} overdue task{overdue.length !== 1 ? 's' : ''} — see Today
          </button>
        )}

        {/* The week ahead */}
        <section>
          <h2 style={sectionHeading}>This week</h2>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {days.map(({ day, events, tasks }) => {
              const today = isToday(day)
              return (
                <div
                  key={day.toISOString()}
                  style={{
                    ...card,
                    flex: '1 0 168px',
                    minWidth: 168,
                    borderColor: today ? '#F59E0B88' : 'var(--border)',
                  }}
                >
                  <div
                    style={{
                      padding: '7px 12px', fontSize: 14, fontWeight: 700,
                      color: today ? '#F59E0B' : 'var(--muted-foreground)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {dayLabel(day)}
                  </div>
                  <div style={{ padding: '6px 0', display: 'flex', flexDirection: 'column' }}>
                    {events.length === 0 && tasks.length === 0 && (
                      <p style={{ fontSize: 14, color: 'var(--ui-text-muted)', margin: 0, padding: '5px 12px' }}>—</p>
                    )}
                    {events.map(({ occ, color }) => (
                      <button
                        key={`${occ.master.uid}-${occ.key}`}
                        onClick={() => { void navigate(calendarLinkFor(occ.start)) }}
                        title={occ.fields.summary}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                          padding: '4px 12px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        {!occ.allDay && (
                          <span style={{ fontSize: 13.5, color: 'var(--muted-foreground)', flexShrink: 0 }}>
                            {fmtTime(occ.start)}
                          </span>
                        )}
                        <span style={{ fontSize: 15, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {occ.fields.summary}
                        </span>
                      </button>
                    ))}
                    {tasks.map((t) => (
                      <button
                        key={`${t._colRef}-${t.uid}`}
                        onClick={() => openTodo(t)}
                        title={t.summary}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                          padding: '4px 12px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <CheckCircle2 style={{ width: 12, height: 12, color: t._colColor, flexShrink: 0 }} strokeWidth={2.5} />
                        <span style={{ fontSize: 15, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.summary}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Projects */}
        <section>
          <h2 style={sectionHeading}>Projects</h2>
          {projects.length === 0 ? (
            <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', margin: 0 }}>No projects yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14, alignItems: 'start' }}>
              {projects.map(({ col, color, top, active, done, overdue: over, blocked }) => {
                const total = active + done
                const pct = total === 0 ? 0 : Math.round((done / total) * 100)
                return (
                  <div key={col.ref} style={card}>
                    <button
                      onClick={() => { void navigate(`/${col.ref}`) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '9px 13px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {col.display_name}
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--muted-foreground)', flexShrink: 0 }}>
                        {active} active
                      </span>
                    </button>

                    <div style={{ padding: '10px 13px 6px' }}>
                      {/* Progress */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--muted)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted-foreground)', flexShrink: 0 }}>{pct}%</span>
                      </div>
                      <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: '5px 0 0' }}>
                        {done} done
                        {over > 0 && <span style={{ color: 'var(--destructive)', fontWeight: 600 }}> · {over} overdue</span>}
                        {blocked > 0 && <span> · {blocked} blocked</span>}
                      </p>
                    </div>

                    <div style={{ padding: '2px 0 6px' }}>
                      {top.length === 0 ? (
                        <p style={{ fontSize: 15, color: 'var(--ui-text-muted)', margin: 0, padding: '5px 13px' }}>Nothing to do!</p>
                      ) : (
                        top.map((t) => (
                          <div key={t.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 13px' }}>
                            <Circle style={{ width: 13, height: 13, flexShrink: 0, color: `${color}99` }} />
                            <span style={{ fontSize: 15.5, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {t.summary}
                            </span>
                            {t.due && (
                              <span style={{ fontSize: 13.5, fontWeight: 500, flexShrink: 0, color: isOverdue(t.due) ? 'var(--destructive)' : 'var(--ui-text-muted)' }}>
                                {fmtDateShort(parseCalDate(t.due))}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Blocked tasks */}
        {waiting.length > 0 && (
          <section>
            <h2 style={sectionHeading}>Waiting on</h2>
            <div style={card}>
              {waiting.map(({ todo, blocker }, i) => (
                <button
                  key={`${todo._colRef}-${todo.uid}`}
                  onClick={() => openTodo(todo)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '8px 14px', background: 'none', border: 'none',
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: todo._colColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 16, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {todo.summary}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, color: '#8B5CF6', flexShrink: 0, minWidth: 0 }}>
                    <Hourglass style={{ width: 12, height: 12, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      waits on “{blocker.summary}”
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
