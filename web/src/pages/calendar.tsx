import { useState } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { RRule } from 'rrule'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { caldav } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { collectionColor } from '@/lib/colors'
import { parseCalDate } from '@/lib/dates'
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { useCollectionStore } from '@/state/collection'
import type { CalEvent, Collection } from '@/types'

const localizer = dateFnsLocalizer({
  format, parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales: { 'en-US': enUS },
})

function toUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

type RBCEvent = {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: CalEvent & { _colName: string }
}

function expandRecurring(e: CalEvent, colName: string, rangeStart: Date, rangeEnd: Date): RBCEvent[] {
  if (!e.rrule) return []
  const dtstart = parseCalDate(e.start)
  if (!dtstart) return []
  const isAllDay = !!e.all_day
  const rruleStart = isAllDay ? toUTCDate(dtstart) : dtstart
  let rule: RRule
  try { rule = new RRule({ ...RRule.parseString(e.rrule), dtstart: rruleStart }) } catch { return [] }
  const endDtstart = e.end ? parseCalDate(e.end) : null
  const duration = endDtstart ? Math.abs(endDtstart.getTime() - dtstart.getTime()) : 24 * 60 * 60 * 1000
  const queryStart = isAllDay ? toUTCDate(rangeStart) : new Date(rangeStart.getTime() - duration)
  const queryEnd = isAllDay ? toUTCDate(rangeEnd) : rangeEnd
  const occurrences = rule.between(queryStart, queryEnd, true)
  return occurrences.map((occ) => {
    const occLocal = isAllDay ? new Date(occ.getUTCFullYear(), occ.getUTCMonth(), occ.getUTCDate()) : occ
    return {
      id: `${e.uid}-${occ.toISOString()}`,
      title: e.summary,
      start: occLocal,
      end: new Date(occLocal.getTime() + duration),
      allDay: isAllDay,
      resource: { ...e, _colName: colName },
    }
  })
}

const VIEW_LABELS: Record<View, string> = {
  month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda', work_week: 'Work week',
}

interface EventForm {
  uid: string
  summary: string
  start: string
  end: string
  description: string
  location: string
  href: string
  _colName: string
}

const emptyForm = (uid: string, colName: string): EventForm => ({
  uid, summary: '', start: '', end: '', description: '', location: '', href: '', _colName: colName,
})

export function CalendarPage() {
  const { collection: collectionParam } = useParams<{ collection?: string }>()
  const { activeCollection, hiddenCollections, focusedCollection } = useCollectionStore()
  const qc = useQueryClient()
  const isMulti = !collectionParam

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const names = collections.map((c: Collection) => c.name)

  const defaultCol = collectionParam ?? activeCollection ?? collections[0]?.name ?? ''

  const visibleCollections: Collection[] = isMulti
    ? (focusedCollection
        ? collections.filter((c: Collection) => c.name === focusedCollection)
        : collections.filter((c: Collection) => c.name !== 'inbox' && !hiddenCollections.includes(c.name)))
    : collections.filter((c: Collection) => c.name === collectionParam)

  const accentColor = collectionParam
    ? collectionColor(names, collectionParam)
    : { bg: '#6366F1', text: '#fff', light: '#eef2ff', border: '#a5b4fc', muted: '#c7d2fe' }

  const [view, setView] = useState<View>('month')
  const [date, setDate] = useState(new Date())
  const [form, setForm] = useState<EventForm | null>(null)
  const [isNew, setIsNew] = useState(false)

  const rangeStart = subMonths(startOfMonth(date), 1)
  const rangeEnd = addMonths(endOfMonth(date), 1)

  const eventQueries = useQueries({
    queries: visibleCollections.map((c: Collection) => ({
      queryKey: ['events', c.name],
      queryFn: () => caldav.listEvents(c.name),
    })),
  })

  const isLoading = eventQueries.some((q) => q.isLoading)

  const bigCalEvents: RBCEvent[] = visibleCollections.flatMap((col: Collection, i: number) => {
    const events: CalEvent[] = eventQueries[i]?.data ?? []
    return events.flatMap((e: CalEvent) => {
      if (e.rrule) return expandRecurring(e, col.name, rangeStart, rangeEnd)
      const start = parseCalDate(e.start)
      if (!start) return []
      const end = e.end
        ? (parseCalDate(e.end) ?? new Date(start.getTime() + 24 * 60 * 60 * 1000))
        : new Date(start.getTime() + (e.all_day ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000))
      return [{ id: e.uid, title: e.summary, start, end, allDay: !!e.all_day, resource: { ...e, _colName: col.name } }]
    })
  })

  const save = useMutation({
    mutationFn: async (f: EventForm) => {
      const col = f._colName || defaultCol
      if (!col) throw new Error('No collection selected')
      const event = {
        uid: f.uid,
        summary: f.summary,
        start: f.start || new Date().toISOString(),
        end: f.end || undefined,
        description: f.description || undefined,
        location: f.location || undefined,
        href: f.href,
      }
      if (isNew) {
        await caldav.createEvent(col, event)
      } else {
        await caldav.updateEvent(col, event)
      }
    },
    onSuccess: (_, f) => {
      void qc.invalidateQueries({ queryKey: ['events', f._colName || defaultCol] })
      setForm(null)
      toast.success(isNew ? 'Event created' : 'Event saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  const del = useMutation({
    mutationFn: (f: EventForm) => caldav.deleteEvent(f._colName || defaultCol, f.uid),
    onSuccess: (_, f) => {
      void qc.invalidateQueries({ queryKey: ['events', f._colName || defaultCol] })
      setForm(null)
      toast.success('Event deleted')
    },
    onError: (e) => toast.error(String(e)),
  })

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
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: 500,
    background: active ? accentColor.bg : 'transparent',
    color: active ? '#fff' : 'var(--muted-foreground)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 100ms, color 100ms',
  })

  return (
    <div
      className="flex flex-col h-full"
      style={{ '--cal-accent': accentColor.bg } as React.CSSProperties}
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
            <button
              onClick={() => { setForm(emptyForm(crypto.randomUUID(), defaultCol)); setIsNew(true) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7, border: 'none',
                background: accentColor.bg, color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus style={{ width: 13, height: 13 }} />
              New event
            </button>
          </>
        }
      />

      {/* Calendar */}
      <div style={{ flex: 1, padding: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ui-text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : (
          <BigCalendar
            localizer={localizer}
            events={bigCalEvents}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            toolbar={false}
            eventPropGetter={(event) => {
              const colName = (event).resource?._colName
              const c = colName ? collectionColor(names, colName) : accentColor
              return {
                style: {
                  backgroundColor: c.bg,
                  borderColor: 'transparent',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 500,
                },
              }
            }}
            onSelectEvent={(e) => {
              const ev = (e).resource
              setForm({
                uid: ev.uid,
                summary: ev.summary,
                start: ev.start,
                end: ev.end ?? '',
                description: ev.description ?? '',
                location: ev.location ?? '',
                href: ev.href,
                _colName: ev._colName,
              })
              setIsNew(false)
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>

      {/* Event dialog */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? 'New event' : 'Edit event'}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              {isMulti && isNew && (
                <div>
                  <Label>Collection</Label>
                  <select
                    value={form._colName}
                    onChange={(e) => setForm({ ...form, _colName: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {collections
                      .filter((c: Collection) => c.name !== 'inbox')
                      .map((c: Collection) => (
                        <option key={c.name} value={c.name}>{c.display_name}</option>
                      ))}
                  </select>
                </div>
              )}
              <div><Label>Title</Label><Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} autoFocus /></div>
              <div>
                <Label>Start <span className="text-muted-foreground font-normal">(ISO 8601)</span></Label>
                <Input value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} placeholder="2026-05-15T09:00:00Z" />
              </div>
              <div><Label>End</Label><Input value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {!isNew && (
              <Button variant="destructive" onClick={() => del.mutate(form!)}>Delete</Button>
            )}
            <Button
              onClick={() => save.mutate(form!)}
              disabled={save.isPending}
              style={{ background: accentColor.bg, color: '#fff', border: 'none' }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
