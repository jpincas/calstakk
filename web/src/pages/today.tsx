import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { format, isToday, startOfDay, addDays } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { calendarLinkFor, parseCalDate, fmtTime, isOverdue } from '@/lib/dates'
import { expandEvent, type Occurrence } from '@/lib/recur'
import { CheckCircle2, Sun } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import {
  useGlobalTodos, useGlobalToggle, useGlobalSetDue, useGlobalSetWaitingOn, useGlobalMove,
  type GlobalTodo,
} from '@/components/todos/useGlobalTodos'
import { usePendingCompletion } from '@/components/todos/usePendingCompletion'
import { GlobalTodoRow } from '@/components/todos/GlobalTodoRow'
import { TodayBulkBar } from '@/components/todos/TodayBulkBar'
import { TaskContextMenu } from '@/components/todos/TaskContextMenu'
import { waitingOnCandidates } from '@/lib/deps'
import { useTaskSelectionStore } from '@/state/selection'
import type { Collection } from '@/types'

// Colour stops: [hour, [r, g, b]]
// Golden morning (7–9:30am) and golden evening (5:30–6:30pm) use bright amber that needs dark text.
// A coral bridge at 17h routes the blue→golden transition through warm-red rather than muddy brown.
const TIME_STOPS: [number, [number, number, number]][] = [
  [0,    [15,  23,  42]],  // midnight  — deep navy
  [4,    [30,  27,  75]],  // night     — indigo
  [5,    [49,  46,  129]], // pre-dawn  — blue-indigo
  [6,    [234, 88,  12]],  // dawn      — coral orange
  [7,    [245, 158, 11]],  // morning   — golden amber (dark text)
  [9.5,  [245, 158, 11]],  // hold      — golden through 9:30am
  [10.5, [14,  165, 233]], // mid-morn  — sky blue
  [13,   [2,   132, 199]], // midday    — deeper sky
  [15,   [37,  99,  235]], // afternoon — blue
  [17,   [210, 60,  50]],  // late arvo — warm coral-red bridge
  [17.5, [245, 158, 11]],  // evening   — golden amber (dark text)
  [18.5, [234, 88,  12]],  // dusk      — coral orange
  [19.5, [139, 92,  246]], // twilight  — violet
  [21,   [49,  46,  129]], // evening   — indigo
  [23,   [15,  23,  42]],  // late night — deep navy
  [24,   [15,  23,  42]],
]

function lerpRgb(a: [number,number,number], b: [number,number,number], t: number): [number,number,number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function relativeLuminance(r: number, g: number, b: number): number {
  const ch = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

function timeOfDayColors(date: Date | null): { bg: string; text: string } {
  const fallback = { bg: '#71717a', text: '#fff' }
  if (!date) return fallback
  const h = date.getHours() + date.getMinutes() / 60
  for (let i = 0; i < TIME_STOPS.length - 1; i++) {
    const [t0, c0] = TIME_STOPS[i]
    const [t1, c1] = TIME_STOPS[i + 1]
    if (h >= t0 && h <= t1) {
      const [r, g, b] = lerpRgb(c0, c1, (h - t0) / (t1 - t0))
      const lum = relativeLuminance(r, g, b)
      return { bg: `rgb(${r},${g},${b})`, text: lum > 0.179 ? '#09090b' : '#ffffff' }
    }
  }
  return fallback
}

type EventMeta = { occ: Occurrence; _colName: string; _colDisplayName: string; _colColor: string }

/** Selection scope key for the Today view (real collections use their ref). */
const SEL_SCOPE = '__today__'
const selKey = (t: GlobalTodo) => `${t._colRef}/${t.uid}`

export function TodayPage() {
  const navigate = useNavigate()
  const now = new Date()
  const todayLabel = format(now, 'EEEE d MMMM')

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

  const names          = collections.map((c) => c.ref)
  const calCollections = collections.filter((c) => c.ref !== 'capture')

  const eventQueries = useQueries({
    queries: calCollections.map((c) => ({
      queryKey: ['events', c.ref],
      queryFn: () => caldav.listEvents(c.ref),
    })),
  })

  const { all: allTodos, waiting } = useGlobalTodos()
  const globalToggle = useGlobalToggle()
  const globalSetDue = useGlobalSetDue()
  const globalSetWaitingOn = useGlobalSetWaitingOn()
  const globalMove = useGlobalMove()
  const pendingCompletion = usePendingCompletion()

  // ── Derived data ─────────────────────────────────────────────────────────────
  // Recurring events are expanded over today's window; an event appears once
  // per occurrence that starts today (matching the previous raw-start filter).
  const dayStart = startOfDay(now)
  const dayEnd   = addDays(dayStart, 1)
  const todayEvents: EventMeta[] = calCollections
    .flatMap((col, i) => {
      const color = collectionColor(names, col.ref)
      const data  = (eventQueries[i]?.data ?? [])
      return data
        .flatMap((e) => expandEvent(e, dayStart, dayEnd))
        .filter((occ) => isToday(occ.start))
        .map((occ) => ({
          occ,
          _colName:        col.ref,
          _colDisplayName: col.display_name,
          _colColor:       col.color ?? color.bg,
        }))
    })
    .sort((a, b) => a.occ.start.getTime() - b.occ.start.getTime())

  // Due today or overdue. Just-completed tasks stay for their fade-out grace period.
  const sortByDue = (a: GlobalTodo, b: GlobalTodo) => {
    if (!a.due && !b.due) return 0
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due.localeCompare(b.due)
  }

  const dueCandidates: GlobalTodo[] = allTodos.filter((t) => {
    const isActive = t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
    if (!isActive && !pendingCompletion.has(selKey(t))) return false
    if (!t.due) return false
    const due = parseCalDate(t.due)
    if (!due) return false
    return isToday(due) || isOverdue(t.due)
  })

  const overdueTodos: GlobalTodo[]  = dueCandidates.filter((t) => isOverdue(t.due)).sort(sortByDue)
  const dueTodayTodos: GlobalTodo[] = dueCandidates.filter((t) => !isOverdue(t.due)).sort(sortByDue)

  // Combined, overdue-first — drives multi-select and the header count.
  const todayTodos: GlobalTodo[] = [...overdueTodos, ...dueTodayTodos]

  const blockerOf = new Map(waiting.map(({ todo, blocker }) => [selKey(todo), blocker]))

  // ── Selection (cross-collection, so keys are "ref/uid") ─────────────────────
  const selCollection = useTaskSelectionStore((s) => s.collection)
  const selUids = useTaskSelectionStore((s) => s.uids)
  const selectOnly = useTaskSelectionStore((s) => s.selectOnly)
  const toggleSel = useTaskSelectionStore((s) => s.toggle)
  const rangeTo = useTaskSelectionStore((s) => s.rangeTo)
  const clearSel = useTaskSelectionStore((s) => s.clear)

  const selectedSet = useMemo(
    () => new Set(selCollection === SEL_SCOPE ? selUids : []),
    [selCollection, selUids],
  )
  // Read-only rows can't take any bulk action, so they're not selectable.
  const selectableKeys = todayTodos.filter((t) => !t._colReadOnly).map(selKey)
  const selectedTodos = todayTodos.filter((t) => selectedSet.has(selKey(t)))

  const handleRowSelect = (todo: GlobalTodo, e: React.MouseEvent) => {
    e.stopPropagation() // the pane's blank-area click clears the selection
    if (todo._colReadOnly) return
    const key = selKey(todo)
    if (e.ctrlKey || e.metaKey) toggleSel(SEL_SCOPE, key)
    else if (e.shiftKey) rangeTo(SEL_SCOPE, key, selectableKeys)
    else selectOnly(SEL_SCOPE, key)
  }

  useEffect(() => {
    if (selectedSet.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) clearSel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSet.size, clearSel])

  // The selection belongs to this view — navigating away drops it.
  useEffect(() => () => {
    const s = useTaskSelectionStore.getState()
    if (s.collection === SEL_SCOPE) s.clear()
  }, [])

  // ── Toggle with completion grace ─────────────────────────────────────────────
  const handleToggle = (todo: GlobalTodo) => {
    globalToggle.mutate(todo)
    if (todo.status !== 'COMPLETED') pendingCompletion.add(selKey(todo))
    else pendingCompletion.remove(selKey(todo))
  }

  // ── Row rendering (context menu wired per-row against the todo's own collection) ─
  const renderTodoRow = (todo: GlobalTodo) => {
    const row = (
      <GlobalTodoRow
        key={selKey(todo)}
        todo={todo}
        waitingOn={blockerOf.get(selKey(todo))?.summary}
        selected={selectedSet.has(selKey(todo))}
        fadingOut={pendingCompletion.has(selKey(todo))}
        onSelect={(e) => handleRowSelect(todo, e)}
        onToggle={handleToggle}
        onOpenCollection={(ref) => { void navigate(`/${ref}`) }}
      />
    )
    if (todo._colReadOnly) return row
    const sameCollectionTodos = allTodos.filter((t) => t._colRef === todo._colRef)
    return (
      <TaskContextMenu
        key={selKey(todo)}
        collections={collections}
        currentCollection={todo._colRef}
        targetCount={1}
        onMove={(to) => globalMove.mutate({ todo, to })}
        onSetDue={(due) => globalSetDue.mutate({ todo, due })}
        waitingOnCandidates={waitingOnCandidates(sameCollectionTodos, todo.uid)}
        isWaiting={!!blockerOf.get(selKey(todo))}
        onSetWaitingOn={(uid) => globalSetWaitingOn.mutate({ todo, uid })}
      >
        {row}
      </TaskContextMenu>
    )
  }

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
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}
        onClick={() => { if (selectedSet.size > 0) clearSel() }}
      >
        {todayTodos.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, paddingTop: 48 }}>
            <CheckCircle2 style={{ width: 20, height: 20, color: 'var(--ui-text-muted)' }} />
            <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', margin: 0 }}>All caught up.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {overdueTodos.length > 0 && (
              <>
                <GroupHeader label="Overdue" color="var(--destructive)" />
                {overdueTodos.map(renderTodoRow)}
              </>
            )}
            {dueTodayTodos.length > 0 && (
              <>
                <GroupHeader label="Today" color="var(--ui-text-muted)" />
                {dueTodayTodos.map(renderTodoRow)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // ── Events pane ──────────────────────────────────────────────────────────────
  const EventsPane = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}>
        {todayEvents.length === 0 ? (
          <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', padding: '8px 10px' }}>No events today.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {todayEvents.map((event) => {
              const { occ } = event
              const { start, end, allDay } = occ
              const location = occ.fields.location
              const { bg: bgColor, text: textColor } = allDay
                ? { bg: '#71717a', text: '#fff' }
                : timeOfDayColors(start)
              const hourLabel = !allDay ? format(start, 'h') : null
              const ampm      = !allDay ? format(start, 'a').toLowerCase() : null
              const timeStr = !allDay
                ? `${fmtTime(start)} — ${fmtTime(end)}${location ? ` · ${location}` : ''}`
                : location ?? null
              return (
                <div
                  key={`${event._colName}-${occ.master.uid}-${occ.key}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 10px',
                    borderRadius: 8,
                    transition: 'background 100ms',
                    cursor: 'pointer',
                  }}
                  onClick={() => { void navigate(calendarLinkFor(start)) }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* Time avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: bgColor,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {hourLabel ? (
                      <>
                        <span style={{ fontSize: 18, fontWeight: 700, color: textColor, lineHeight: 1 }}>{hourLabel}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: textColor, opacity: 0.7, letterSpacing: '0.04em', lineHeight: 1, marginTop: 2 }}>{ampm}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 600, color: textColor, opacity: 0.7, letterSpacing: '0.04em', textTransform: 'uppercase' }}>all day</span>
                    )}
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 17, fontWeight: 500, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {occ.fields.summary}
                    </p>
                    {timeStr && (
                      <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {timeStr}
                      </p>
                    )}
                  </div>
                  <CollectionBadge color={event._colColor} label={event._colDisplayName} />
                </div>
              )
            })}
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
      <PageBar
        icon={<Sun size={14} color="#F59E0B" strokeWidth={2.2} />}
        title="Today"
        detail={todayLabel}
        controls={
          <>
            <TodayBulkBar
              selected={selectedTodos}
              onClear={clearSel}
              onCompleted={(items) => items.forEach((t) => pendingCompletion.add(selKey(t)))}
            />
            {todayTodos.length > 0 && (
              <span style={{ fontSize: 16, color: 'var(--muted-foreground)' }}>
                {todayTodos.length} task{todayTodos.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
      />

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
                fontSize: 16,
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

function GroupHeader({ label, color }: { label: string; color: string }) {
  return (
    <p
      style={{
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color,
        margin: '10px 10px 4px',
      }}
    >
      {label}
    </p>
  )
}

function CollectionBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 13,
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
