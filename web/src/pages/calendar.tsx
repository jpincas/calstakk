import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { RRule } from 'rrule'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { listEvents, putEvent, deleteCalObject } from '@/api/caldav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { collectionColor } from '@/lib/colors'
import { useQuery as useCollectionsQuery } from '@tanstack/react-query'
import { listCollections } from '@/api/collections'
import { parseCalDate } from '@/lib/dates'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalEvent } from '@/types'

const localizer = dateFnsLocalizer({
  format, parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales: { 'en-US': enUS },
})

function toUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function expandRecurring(e: CalEvent, rangeStart: Date, rangeEnd: Date) {
  if (!e.rrule) return null
  const dtstart = parseCalDate(e.start)
  if (!dtstart) return null
  const isAllDay = !!e.all_day
  const rruleStart = isAllDay ? toUTCDate(dtstart) : dtstart
  let rule: RRule
  try { rule = new RRule({ ...RRule.parseString(e.rrule), dtstart: rruleStart }) } catch { return null }
  const endDtstart = e.end ? parseCalDate(e.end) : null
  const duration = endDtstart ? Math.abs(endDtstart.getTime() - dtstart.getTime()) : 24 * 60 * 60 * 1000
  const queryStart = isAllDay ? toUTCDate(rangeStart) : new Date(rangeStart.getTime() - duration)
  const queryEnd = isAllDay ? toUTCDate(rangeEnd) : rangeEnd
  const occurrences = rule.between(queryStart, queryEnd, true)
  return occurrences.map(occ => {
    const occLocal = isAllDay ? new Date(occ.getUTCFullYear(), occ.getUTCMonth(), occ.getUTCDate()) : occ
    return { id: `${e.uid}-${occ.toISOString()}`, title: e.summary, start: occLocal, end: new Date(occLocal.getTime() + duration), allDay: isAllDay, resource: e }
  })
}

const VIEW_LABELS: Record<View, string> = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda', work_week: 'Work week' }

interface EventForm { uid: string; summary: string; start: string; end: string; description: string; location: string }
const empty = (uid = ''): EventForm => ({ uid, summary: '', start: '', end: '', description: '', location: '' })

export function CalendarPage() {
  const { collection } = useParams<{ collection: string }>()
  const qc = useQueryClient()
  const { data: collections = [] } = useCollectionsQuery({ queryKey: ['collections'], queryFn: listCollections })
  const color = collection ? collectionColor(collections.map(c => c.name), collection) : { bg: '#2563eb', light: '#eff6ff', muted: '#dbeafe', border: '#93c5fd', text: '#fff' }

  const [view, setView] = useState<View>('month')
  const [date, setDate] = useState(new Date())
  const [form, setForm] = useState<EventForm | null>(null)
  const [isNew, setIsNew] = useState(false)

  const rangeStart = subMonths(startOfMonth(date), 1)
  const rangeEnd = addMonths(endOfMonth(date), 1)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', collection],
    queryFn: () => listEvents(collection!),
    enabled: !!collection,
  })

  const save = useMutation({
    mutationFn: (f: EventForm) => putEvent(collection!, { uid: f.uid, summary: f.summary, start: f.start || new Date().toISOString(), end: f.end || undefined, description: f.description || undefined, location: f.location || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events', collection] }); setForm(null); toast.success('Event saved') },
    onError: (e) => toast.error(String(e)),
  })
  const del = useMutation({
    mutationFn: (uid: string) => deleteCalObject(collection!, uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events', collection] }); setForm(null); toast.success('Event deleted') },
    onError: (e) => toast.error(String(e)),
  })

  const bigCalEvents = events.flatMap(e => {
    if (e.rrule) return expandRecurring(e, rangeStart, rangeEnd) ?? []
    const start = parseCalDate(e.start)
    if (!start) return []
    const end = e.end ? (parseCalDate(e.end) ?? new Date(start.getTime() + 24 * 60 * 60 * 1000)) : new Date(start.getTime() + (e.all_day ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000))
    return [{ id: e.uid, title: e.summary, start, end, allDay: !!e.all_day, resource: e }]
  })

  const viewLabel = view === 'month' ? format(date, 'MMMM yyyy') : view === 'week' ? `Week of ${format(startOfWeek(date, { weekStartsOn: 1 }), 'd MMM yyyy')}` : format(date, 'd MMMM yyyy')

  return (
    <div className="flex flex-col h-full" style={{ '--cal-accent': color.bg } as React.CSSProperties}>
      {/* Custom toolbar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setDate(d => view === 'month' ? subMonths(d, 1) : new Date(d.getTime() - 7 * 86400000))}
              className="px-3 py-1.5 hover:bg-gray-50 text-gray-500 hover:text-gray-800 transition-colors border-r border-gray-200">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setDate(new Date())} className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-200">
              Today
            </button>
            <button onClick={() => setDate(d => view === 'month' ? addMonths(d, 1) : new Date(d.getTime() + 7 * 86400000))}
              className="px-3 py-1.5 hover:bg-gray-50 text-gray-500 hover:text-gray-800 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{viewLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['month', 'week', 'day'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={cn('px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-0 border-gray-200',
                  view === v ? 'text-white' : 'text-gray-500 hover:bg-gray-50')}
                style={view === v ? { background: color.bg } : {}}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <button onClick={() => { setForm(empty(crypto.randomUUID())); setIsNew(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: color.bg }}>
            <Plus className="w-3.5 h-3.5" /> New event
          </button>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 p-4 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
        ) : (
          <BigCalendar
            localizer={localizer}
            events={bigCalEvents}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            toolbar={false}
            eventPropGetter={() => ({ style: { backgroundColor: color.bg, borderColor: 'transparent', borderRadius: '4px', fontSize: '12px', fontWeight: 500 } })}
            onSelectEvent={e => { const ev = e.resource as CalEvent; setForm({ uid: ev.uid, summary: ev.summary, start: ev.start, end: ev.end ?? '', description: ev.description ?? '', location: ev.location ?? '' }); setIsNew(false) }}
            style={{ height: '100%' }}
          />
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(o: boolean) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isNew ? 'New event' : 'Edit event'}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div><Label>Title</Label><Input value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} autoFocus /></div>
              <div><Label>Start <span className="text-gray-400 font-normal">(ISO 8601)</span></Label><Input value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} placeholder="2026-05-15T09:00:00Z" /></div>
              <div><Label>End</Label><Input value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {!isNew && <Button variant="destructive" onClick={() => del.mutate(form!.uid)}>Delete</Button>}
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending} style={{ background: color.bg }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
