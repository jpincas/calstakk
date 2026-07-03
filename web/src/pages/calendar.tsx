import { useEffect, useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import RBCDragAndDropAddon, { type EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop'

// Vite's CJS interop double-wraps this package's default export in dev; unwrap defensively.
const withDragAndDrop = (
  typeof RBCDragAndDropAddon === 'function'
    ? RBCDragAndDropAddon
    : (RBCDragAndDropAddon as unknown as { default: typeof RBCDragAndDropAddon }).default
)
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { enUS } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { caldav } from '@/api'
import { displayColor } from '@/lib/colors'
import { parseCalDate, fmtTime } from '@/lib/dates'
import { expandEvent, shiftSeries, toICalString, type Occurrence } from '@/lib/recur'
import { EventDialog } from '@/components/calendar/EventDialog'
import { ScopeDialog, type EditScope } from '@/components/calendar/ScopeDialog'
import { useEventMutations } from '@/components/calendar/useEventMutations'
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, CalendarDays } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { useCollectionStore } from '@/state/collection'
import type { CalEvent, Collection, Todo } from '@/types'

const localizer = dateFnsLocalizer({
  format, parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales: { 'en-US': enUS },
})

type RBCResource =
  | { kind: 'event'; occ: Occurrence; _colName: string }
  | ({ kind: 'todo' } & Todo & { _colName: string })

type RBCEvent = {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: RBCResource
}

const DnDCalendar = withDragAndDrop<RBCEvent, object>(BigCalendar)

const VIEW_LABELS: Record<View, string> = {
  month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda', work_week: 'Work week',
}

/** Everything the event dialog needs to open: what's being edited (or a create prefill). */
interface DialogState {
  occ: Occurrence | null
  col: string
  range?: { start: Date; end: Date; allDay: boolean }
}

/** A pending drag/resize of a recurring occurrence, awaiting its scope choice. */
interface PendingMove {
  occ: Occurrence
  col: string
  start: Date
  end: Date
}

// Link-throughs land on /calendar?date=yyyy-MM-dd&view=day|week|month.
function viewParamOf(params: URLSearchParams): View | null {
  const v = params.get('view')
  return v === 'day' || v === 'week' || v === 'month' ? v : null
}

function dateParamOf(params: URLSearchParams): Date | null {
  const s = params.get('date')
  if (!s) return null
  const d = parse(s, 'yyyy-MM-dd', new Date())
  return isNaN(d.getTime()) ? null : d
}

export function CalendarPage() {
  const { collection: collectionParam } = useParams<{ collection?: string }>()
  const { activeCollection, hiddenCollections, focusedCollection, showTasksOnCalendar, toggleShowTasksOnCalendar } = useCollectionStore()
  const navigateTo = useNavigate()
  const isMulti = !collectionParam

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  // Read-only shared collections: their events must not be dragged/resized/edited.
  const readOnlyRefs = new Set(
    collections.filter((c: Collection) => c.myAccess === 'read').map((c: Collection) => c.ref)
  )

  // New events must target a writable collection; fall back to the first writable one.
  const preferredCol = collectionParam ?? activeCollection ?? collections[0]?.ref ?? ''
  const defaultCol = preferredCol && !readOnlyRefs.has(preferredCol)
    ? preferredCol
    : collections.find((c: Collection) => c.myAccess !== 'read')?.ref ?? ''

  // Hide "New event" when there is no writable creation target — e.g. the
  // single-collection view of a read-only share (falling back to another
  // collection there would create the event somewhere unexpected).
  const canCreate = isMulti ? defaultCol !== '' : !!collectionParam && !readOnlyRefs.has(collectionParam)

  const visibleCollections: Collection[] = isMulti
    ? (focusedCollection
        ? collections.filter((c: Collection) => c.ref === focusedCollection)
        : collections.filter((c: Collection) => c.ref !== 'capture' && !hiddenCollections.includes(c.ref)))
    : collections.filter((c: Collection) => c.ref === collectionParam)

  // Tasks additionally come from the inbox (it holds todos, never events).
  const todoCollections: Collection[] = isMulti
    ? (focusedCollection
        ? collections.filter((c: Collection) => c.ref === focusedCollection)
        : collections.filter((c: Collection) => !hiddenCollections.includes(c.ref)))
    : collections.filter((c: Collection) => c.ref === collectionParam)

  const accentBg = collectionParam ? displayColor(collections, collectionParam) : '#6366F1'

  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<View>(() => viewParamOf(searchParams) ?? 'month')
  const [date, setDate] = useState<Date>(() => dateParamOf(searchParams) ?? new Date())
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  // The params are a one-shot navigation intent, consumed by the lazy state
  // initialisers above (the page remounts on every link-through). Drop them
  // so refresh/back doesn't re-apply a stale jump.
  useEffect(() => {
    if (searchParams.toString() === '') return
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const rangeStart = subMonths(startOfMonth(date), 1)
  const rangeEnd = addMonths(endOfMonth(date), 1)

  const eventQueries = useQueries({
    queries: visibleCollections.map((c: Collection) => ({
      queryKey: ['events', c.ref],
      queryFn: () => caldav.listEvents(c.ref),
    })),
  })

  const todoQueries = useQueries({
    queries: todoCollections.map((c: Collection) => ({
      queryKey: ['todos', c.ref],
      queryFn: () => caldav.listTodos(c.ref),
    })),
  })

  const isLoading = eventQueries.some((q) => q.isLoading)

  const bigCalEvents: RBCEvent[] = visibleCollections.flatMap((col: Collection, i: number) => {
    const events: CalEvent[] = eventQueries[i]?.data ?? []
    return events.flatMap((e: CalEvent) =>
      expandEvent(e, rangeStart, rangeEnd).map((occ) => ({
        id: `${e.uid}-${occ.key}`,
        title: occ.fields.summary,
        start: occ.start,
        end: occ.end,
        allDay: occ.allDay,
        resource: { kind: 'event' as const, occ, _colName: col.ref },
      })),
    )
  })

  const taskEvents: RBCEvent[] = showTasksOnCalendar
    ? todoCollections.flatMap((col: Collection, i: number) => {
        const todos: Todo[] = todoQueries[i]?.data ?? []
        return todos.flatMap((t: Todo) => {
          if (!t.due || t.status === 'COMPLETED' || t.status === 'CANCELLED') return []
          const due = parseCalDate(t.due)
          if (!due) return []
          const isAllDay = t.due.length === 8 // date-only DUE
          const start = isAllDay ? due : new Date(due.getTime() - 30 * 60 * 1000)
          const end = isAllDay ? new Date(due.getTime() + 24 * 60 * 60 * 1000) : due
          return [{
            id: `todo-${col.ref}-${t.uid}`,
            title: t.summary,
            start,
            end,
            allDay: isAllDay,
            resource: { kind: 'todo' as const, ...t, _colName: col.ref },
          }]
        })
      })
    : []

  const mutations = useEventMutations()

  // Drag/resize: plain events reschedule directly (full event preserved); a
  // recurring occurrence first asks for its scope (this event / all events).
  const handleMove = ({ event, start, end }: EventInteractionArgs<RBCEvent>) => {
    if (event.resource.kind !== 'event') return
    const { occ, _colName } = event.resource
    if (readOnlyRefs.has(_colName)) return // server would 403
    const startD = new Date(start)
    const endD = new Date(end)
    if (!occ.isRecurring) {
      mutations.saveSeries.mutate({
        col: _colName,
        master: occ.master,
        edits: {
          start: toICalString(startD, occ.allDay),
          end: toICalString(endD, occ.allDay),
          all_day: occ.allDay,
        },
      })
      return
    }
    setPendingMove({ occ, col: _colName, start: startD, end: endD })
  }

  const handleMoveScope = (scope: EditScope) => {
    const m = pendingMove
    setPendingMove(null)
    if (!m) return
    if (scope === 'this') {
      mutations.saveOccurrence.mutate({
        col: m.col,
        occ: m.occ,
        edits: {
          start: toICalString(m.start, m.occ.allDay),
          end: toICalString(m.end, m.occ.allDay),
          all_day: m.occ.allDay || undefined,
        },
      })
    } else {
      const delta = m.start.getTime() - m.occ.start.getTime()
      const duration = m.end.getTime() - m.start.getTime()
      mutations.saveSeries.mutate({
        col: m.col,
        master: m.occ.master,
        edits: shiftSeries(m.occ.master, delta, duration, m.occ.allDay),
      })
    }
  }

  const moveResetsOverrides = !!pendingMove &&
    ((pendingMove.occ.master.overrides?.length ?? 0) > 0 || (pendingMove.occ.master.exdates?.length ?? 0) > 0)

  const viewLabel =
    view === 'month'
      ? format(date, 'MMMM yyyy')
      : view === 'week'
      ? `Week of ${format(startOfWeek(date, { weekStartsOn: 1 }), 'd MMM yyyy')}`
      : format(date, 'd MMMM yyyy')

  const navigate = (dir: -1 | 1) => {
    setDate((d) => {
      if (view === 'month') return dir === 1 ? addMonths(d, 1) : subMonths(d, 1)
      return new Date(d.getTime() + dir * 7 * 86_400_000)
    })
  }

  const navBtnStyle: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: 16,
    fontWeight: 500,
    background: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'color 100ms',
  }

  const viewBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: 16,
    fontWeight: 500,
    background: active ? accentBg : 'transparent',
    color: active ? '#fff' : 'var(--muted-foreground)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 100ms, color 100ms',
  })

  return (
    <div
      className="flex flex-col h-full"
      style={{ '--cal-accent': accentBg } as React.CSSProperties}
    >
      <PageBar
        icon={<CalendarDays size={14} color="#6366F1" strokeWidth={2.2} />}
        title={viewLabel}
        detail={
          <div style={{ display: 'flex', alignItems: 'center', borderRadius: 7, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <button onClick={() => navigate(-1)} style={{ ...navBtnStyle, borderRight: '1px solid var(--border)' }}>
              <ChevronLeft style={{ width: 14, height: 14 }} />
            </button>
            <button onClick={() => setDate(new Date())} style={{ ...navBtnStyle, padding: '4px 10px', borderRight: '1px solid var(--border)' }}>
              Today
            </button>
            <button onClick={() => navigate(1)} style={navBtnStyle}>
              <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
        }
        controls={
          <>
            <button
              onClick={toggleShowTasksOnCalendar}
              title={showTasksOnCalendar ? 'Hide tasks on the calendar' : 'Show tasks on the calendar'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 7,
                border: '1px solid var(--border)',
                background: showTasksOnCalendar ? accentBg : 'transparent',
                color: showTasksOnCalendar ? '#fff' : 'var(--muted-foreground)',
                fontSize: 16, fontWeight: 500, cursor: 'pointer',
                transition: 'background 100ms, color 100ms',
              }}
            >
              <CheckCircle2 style={{ width: 13, height: 13 }} />
              Show tasks
            </button>
            <div style={{ display: 'flex', borderRadius: 7, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {(['month', 'week', 'day'] as View[]).map((v, i, arr) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{ ...viewBtnStyle(view === v), borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            {canCreate && (
              <button
                onClick={() => setDialog({ occ: null, col: defaultCol })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 7, border: 'none',
                  background: accentBg, color: '#fff',
                  fontSize: 16, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Plus style={{ width: 13, height: 13 }} />
                New event
              </button>
            )}
          </>
        }
      />

      {/* Calendar */}
      <div style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ui-text-muted)', fontSize: 17 }}>
            Loading…
          </div>
        ) : (
          <DnDCalendar
            localizer={localizer}
            events={[...bigCalEvents, ...taskEvents]}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            toolbar={false}
            resizable
            selectable={canCreate}
            onSelectSlot={(slot) => {
              if (!canCreate) return
              const start = new Date(slot.start)
              const end = new Date(slot.end)
              // Month-view (and all-day row) selections come through as whole days.
              const allDay = view === 'month' ||
                (start.getHours() === 0 && end.getHours() === 0 && end.getTime() - start.getTime() >= 24 * 60 * 60 * 1000)
              setDialog({ occ: null, col: defaultCol, range: { start, end, allDay } })
            }}
            draggableAccessor={(event) => event.resource.kind === 'event' && !readOnlyRefs.has(event.resource._colName)}
            resizableAccessor={(event) => event.resource.kind === 'event' && !readOnlyRefs.has(event.resource._colName)}
            onEventDrop={handleMove}
            onEventResize={handleMove}
            eventPropGetter={(event) => {
              const colName = (event).resource?._colName
              const bg = colName ? displayColor(collections, colName) : accentBg
              if (event.resource.kind === 'todo') {
                return {
                  style: {
                    backgroundColor: 'transparent',
                    color: 'var(--foreground)',
                    borderColor: 'transparent',
                    borderRadius: 4,
                    fontSize: 16,
                    fontWeight: 500,
                  },
                }
              }
              return event.allDay
                ? {
                    style: {
                      backgroundColor: bg,
                      color: '#fff',
                      borderColor: 'transparent',
                      borderRadius: 4,
                      fontSize: 16,
                      fontWeight: 500,
                    },
                  }
                : {
                    style: {
                      backgroundColor: 'transparent',
                      color: 'var(--foreground)',
                      borderColor: 'transparent',
                      borderRadius: 4,
                      fontSize: 16,
                      fontWeight: 500,
                    },
                  }
            }}
            components={{
              event: ({ event }: { event: RBCEvent }) => {
                const colName = event.resource?._colName
                const bg = colName ? displayColor(collections, colName) : accentBg
                if (event.resource.kind === 'todo') {
                  return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                      <CheckCircle2 style={{ width: 12, height: 12, color: bg, flexShrink: 0 }} strokeWidth={2.5} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</span>
                    </span>
                  )
                }
                if (event.allDay) return <>{event.title}</>
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: bg, flexShrink: 0 }} />
                    <span style={{ opacity: 0.75, flexShrink: 0 }}>{fmtTime(event.start)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</span>
                  </span>
                )
              },
            }}
            onSelectEvent={(e) => {
              const ev = (e).resource
              if (ev.kind === 'todo') {
                // The capture list has its own page at /inbox rather than /:collection.
                void navigateTo(ev._colName === 'capture' ? '/inbox' : `/${ev._colName}`)
                return
              }
              setDialog({ occ: ev.occ, col: ev._colName })
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>

      {/* Event dialog */}
      {dialog && (
        <EventDialog
          occurrence={dialog.occ}
          initialRange={dialog.range}
          collections={collections}
          colRef={dialog.col}
          showCollectionPicker={isMulti && !dialog.occ}
          readOnly={readOnlyRefs.has(dialog.col)}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Scope chooser for dragging/resizing a recurring occurrence */}
      <ScopeDialog
        open={!!pendingMove}
        accent={accentBg}
        title="Move recurring event"
        warning={moveResetsOverrides
          ? 'Moving all events resets skipped and edited occurrences of this series.'
          : undefined}
        options={[
          { value: 'this', label: 'This event', hint: 'Only this occurrence moves.' },
          { value: 'all', label: 'All events', hint: 'The whole series shifts by the same amount.' },
        ]}
        onChoose={handleMoveScope}
        onCancel={() => setPendingMove(null)}
      />
    </div>
  )
}
