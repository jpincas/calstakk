import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { caldav } from '@/api'
import { parseCalDate, fmtTime } from '@/lib/dates'
import { collectionColor } from '@/lib/colors'
import { useCollectionStore } from '@/state/collection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Settings, Plus } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { TaskList } from '@/components/TaskList'
import {
  format,
  isToday,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addMonths,
  isBefore,
  isAfter,
  startOfDay,
} from 'date-fns'
import type { Collection, Todo, CalEvent } from '@/types'

// ── Constants ────────────────────────────────────────────────────────────────

const SETTING_COLORS = [
  '#2563EB', '#0891B2', '#059669', '#65A30D',
  '#D97706', '#EA580C', '#DC2626', '#BE185D',
  '#7C3AED', '#6366F1', '#8B5CF6', '#10B981',
]

const BUCKET_ORDER = ['Today', 'This Week', 'This Month', 'Next Month', 'Later'] as const
type Bucket = typeof BUCKET_ORDER[number]

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TodoForm {
  uid: string
  summary: string
  description: string
  due: string
  status: string
}

const emptyTodo = (): TodoForm => ({
  uid: crypto.randomUUID(),
  summary: '',
  description: '',
  due: '',
  status: 'NEEDS-ACTION',
})

interface EventForm {
  uid: string
  summary: string
  start: string
  end: string
  description: string
  location: string
  href: string
}

const emptyEventForm = (): EventForm => ({
  uid: crypto.randomUUID(),
  summary: '',
  start: '',
  end: '',
  description: '',
  location: '',
  href: '',
})

function getEventBucket(start: Date, today: Date): Bucket | null {
  if (isBefore(start, startOfDay(today))) return null
  if (isToday(start)) return 'Today'
  const wStart = startOfWeek(today, { weekStartsOn: 1 })
  const wEnd = endOfWeek(today, { weekStartsOn: 1 })
  if (!isBefore(start, wStart) && !isAfter(start, wEnd)) return 'This Week'
  const mEnd = endOfMonth(today)
  if (!isAfter(start, mEnd)) return 'This Month'
  const nmStart = startOfMonth(addMonths(today, 1))
  const nmEnd = endOfMonth(addMonths(today, 1))
  if (!isBefore(start, nmStart) && !isAfter(start, nmEnd)) return 'Next Month'
  return 'Later'
}

// ── Main component ───────────────────────────────────────────────────────────

export function ProjectPage() {
  const { collection: colName } = useParams<{ collection: string }>()
  const qc = useQueryClient()
  const { setCollection } = useCollectionStore()

  // Sync active collection to store
  useEffect(() => {
    if (colName) setCollection(colName)
  }, [colName, setCollection])

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const { data: todos = [] } = useQuery<Todo[]>({
    queryKey: ['todos', colName],
    queryFn: () => caldav.listTodos(colName!),
    enabled: !!colName,
  })

  const { data: events = [] } = useQuery<CalEvent[]>({
    queryKey: ['events', colName],
    queryFn: () => caldav.listEvents(colName!),
    enabled: !!colName,
  })

  // ── Derived data ─────────────────────────────────────────────────────────

  const col = collections.find((c) => c.name === colName)
  const names = collections.map((c) => c.name)

  const color = useMemo(() => {
    if (col?.color) return { bg: col.color, text: '#fff' }
    const c = collectionColor(names, colName ?? '')
    return { bg: c.bg, text: '#fff' }
  }, [col, names, colName])

  const displayName = col?.display_name ?? colName ?? 'Project'

  // Counts for PageBar — TaskList owns the full render; todos query is shared cache
  const activeCount = useMemo(() => todos.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length, [todos])
  const completedCount = useMemo(() => todos.filter(t => t.status === 'COMPLETED').length, [todos])

  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    collections.forEach((c) => { if (c.group) groups.add(c.group) })
    return Array.from(groups)
  }, [collections])

  const eventBuckets = useMemo(() => {
    const today = new Date()
    const bucketed: Record<Bucket, CalEvent[]> = {
      Today: [],
      'This Week': [],
      'This Month': [],
      'Next Month': [],
      Later: [],
    }

    const sorted = [...events].sort((a, b) => {
      const da = parseCalDate(a.start)
      const db = parseCalDate(b.start)
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return da.getTime() - db.getTime()
    })

    for (const event of sorted) {
      const start = parseCalDate(event.start)
      if (!start) continue
      const bucket = getEventBucket(start, today)
      if (!bucket) continue
      bucketed[bucket].push(event)
    }

    return BUCKET_ORDER.filter((b) => bucketed[b].length > 0).map((b) => ({
      label: b,
      events: bucketed[b],
    }))
  }, [events])

  // ── UI state ─────────────────────────────────────────────────────────────

  const [form, setForm] = useState<TodoForm | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [eventForm, setEventForm] = useState<EventForm | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [isNarrow, setIsNarrow] = useState(false)
  const [activeTab, setActiveTab] = useState<'Tasks' | 'Events'>('Tasks')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingColor, setSettingColor] = useState('')
  const [settingGroup, setSettingGroup] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)

  // ResizeObserver for narrow/wide detection
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 680)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Initialise settings edit state from the collection, then open the modal.
  const openSettings = () => {
    setSettingColor(col?.color ?? '')
    setSettingGroup(col?.group ?? '')
    setSettingsOpen(true)
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const todoSave = useMutation({
    mutationFn: (f: TodoForm) => {
      const payload = {
        uid: f.uid || crypto.randomUUID(),
        summary: f.summary,
        description: f.description || undefined,
        due: f.due ? f.due.replace(/-/g, '') : undefined,
        status: f.status,
      }
      return isNew
        ? caldav.createTodo(colName!, payload)
        : caldav.updateTodo(colName!, payload)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['todos', colName] })
      setForm(null)
      toast.success('Task saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  const eventSave = useMutation({
    mutationFn: (f: EventForm) =>
      caldav.createEvent(colName!, {
        uid: f.uid,
        summary: f.summary,
        start: f.start || new Date().toISOString(),
        end: f.end || undefined,
        description: f.description || undefined,
        location: f.location || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events', colName] })
      setEventForm(null)
      toast.success('Event created')
    },
    onError: (e) => toast.error(String(e)),
  })

  const saveName = useMutation({
    mutationFn: (name: string) =>
      caldav.updateCollectionProps(colName!, { displayName: name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] })
      setEditingName(false)
    },
    onError: (e) => toast.error(String(e)),
  })

  const saveSettings = useMutation({
    mutationFn: () =>
      caldav.updateCollectionProps(colName!, {
        color: settingColor || undefined,
        group: settingGroup.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] })
      setSettingsOpen(false)
      toast.success('Settings saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  // ── Name edit handler ─────────────────────────────────────────────────────

  const commitName = () => {
    if (nameInput.trim() && nameInput.trim() !== displayName) {
      saveName.mutate(nameInput.trim())
    } else {
      setEditingName(false)
    }
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!colName) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: 17, color: 'var(--ui-text-muted)' }}>Select a project from the sidebar.</p>
      </div>
    )
  }

  // ── Pane renderers ────────────────────────────────────────────────────────

  const TasksPane = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <TaskList collection={colName} accentColor={color.bg} />
      </div>
    </div>
  )

  const EventsPane = (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
        borderLeft: isNarrow ? 'none' : '1px solid var(--border)',
      }}
    >
      {/* Event list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {eventBuckets.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ fontSize: 17, color: 'var(--ui-text-muted)', margin: 0 }}>No upcoming events.</p>
          </div>
        ) : (
          eventBuckets.map(({ label, events: bucketEvents }) => (
            <div key={label}>
              {/* Period label */}
              <div
                style={{
                  padding: '12px 16px 4px',
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                  background: 'var(--background)',
                  position: 'sticky',
                  top: 0,
                }}
              >
                {label}
              </div>
              {bucketEvents.map((event) => {
                const start = parseCalDate(event.start)
                const end = event.end ? parseCalDate(event.end) : null
                const timeStr = event.all_day
                  ? 'All day'
                  : start ? `${fmtTime(start)}${end ? ` – ${fmtTime(end)}` : ''}` : null
                const dayNum = start ? format(start, 'd') : ''
                const monthStr = start ? format(start, 'MMM').toUpperCase() : ''
                return (
                  <div
                    key={event.uid}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {/* Date avatar */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: 'var(--muted)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1 }}>
                        {dayNum}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted-foreground)', letterSpacing: '0.04em', lineHeight: 1, marginTop: 2 }}>
                        {monthStr}
                      </span>
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 17,
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {event.summary}
                      </p>
                      {timeStr && (
                        <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
                          {timeStr}
                        </p>
                      )}
                      {event.location && (
                        <p
                          style={{
                            fontSize: 14,
                            color: 'var(--muted-foreground)',
                            margin: '2px 0 0',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {event.location}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <PageBar
        accentColor={color.bg}
        title={
          editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: '#fff',
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
                minWidth: 120,
              }}
            />
          ) : (
            <span
              onClick={() => { setNameInput(displayName); setEditingName(true) }}
              style={{ cursor: 'text', color: 'inherit' }}
            >
              {displayName}
            </span>
          )
        }
        detail={`${activeCount} active · ${completedCount} completed`}
        controls={
          <>
            <button
              onClick={openSettings}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'transparent', color: 'rgba(255,255,255,0.85)',
                cursor: 'pointer',
              }}
            >
              <Settings style={{ width: 18, height: 18 }} />
            </button>
            <button
              onClick={() => setEventForm(emptyEventForm())}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 16, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus style={{ width: 13, height: 13 }} />
              New event
            </button>
            <button
              onClick={() => { setForm(emptyTodo()); setIsNew(true) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 16, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus style={{ width: 13, height: 13 }} />
              New task
            </button>
          </>
        }
      />

      {/* Narrow mode tab bar */}
      {isNarrow && (
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        >
          {(['Tasks', 'Events'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '8px',
                border: 'none',
                borderBottom: activeTab === tab ? `2px solid ${color.bg}` : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontSize: 17,
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: 'pointer',
                transition: 'color 100ms',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Body: panes */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {isNarrow ? (
          activeTab === 'Tasks' ? TasksPane : EventsPane
        ) : (
          <>
            {TasksPane}
            {EventsPane}
          </>
        )}
      </div>

      {/* New task modal — creation only */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div>
                <Label>Title</Label>
                <Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} autoFocus />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </div>
              <div>
                <Label>Status</Label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="NEEDS-ACTION">To do</option>
                  <option value="IN-PROCESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => todoSave.mutate(form!)} disabled={todoSave.isPending || !form?.summary} style={{ background: color.bg, color: '#fff', border: 'none' }}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New event modal */}
      <Dialog open={!!eventForm} onOpenChange={(o) => !o && setEventForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New event</DialogTitle>
          </DialogHeader>
          {eventForm && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
              <div><Label>Title</Label><Input autoFocus value={eventForm.summary} onChange={(e) => setEventForm({ ...eventForm, summary: e.target.value })} /></div>
              <div>
                <Label>Start <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>(ISO 8601)</span></Label>
                <Input value={eventForm.start} onChange={(e) => setEventForm({ ...eventForm, start: e.target.value })} placeholder="2026-07-01T09:00:00Z" />
              </div>
              <div><Label>End</Label><Input value={eventForm.end} onChange={(e) => setEventForm({ ...eventForm, end: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => eventSave.mutate(eventForm!)}
              disabled={eventSave.isPending || !eventForm?.summary}
              style={{ background: color.bg, color: '#fff', border: 'none' }}
            >
              Create event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings modal */}
      <Dialog open={settingsOpen} onOpenChange={(o) => !o && setSettingsOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
          </DialogHeader>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 4 }}>
            {/* Colour section */}
            <div>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                  margin: '0 0 10px',
                }}
              >
                Colour
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 28px)',
                  gap: 8,
                }}
              >
                {SETTING_COLORS.map((hex) => {
                  const selected = settingColor === hex
                  return (
                    <button
                      key={hex}
                      onClick={() => setSettingColor(selected ? '' : hex)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        border: 'none',
                        background: hex,
                        cursor: 'pointer',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        outline: selected ? `3px solid ${hex}` : 'none',
                        outlineOffset: 2,
                        boxShadow: selected ? 'inset 0 0 0 2px rgba(255,255,255,0.5)' : 'none',
                      }}
                    >
                      {selected && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          style={{ position: 'absolute' }}
                        >
                          <path
                            d="M2 6l3 3 5-5"
                            stroke="white"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
              {!settingColor && (
                <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '8px 0 0' }}>
                  Using palette colour. Select a swatch to override.
                </p>
              )}
            </div>

            {/* Group section */}
            <div>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                  margin: '0 0 10px',
                }}
              >
                Group
              </p>
              {existingGroups.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {existingGroups.map((g) => {
                    const selected = settingGroup === g
                    return (
                      <button
                        key={g}
                        onClick={() => setSettingGroup(selected ? '' : g)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 20,
                          border: '1px solid var(--border)',
                          background: selected ? color.bg : 'var(--accent)',
                          color: selected ? '#fff' : 'var(--foreground)',
                          fontSize: 16,
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'background 100ms, color 100ms',
                        }}
                      >
                        {g}
                      </button>
                    )
                  })}
                </div>
              )}
              <Input
                value={settingGroup}
                onChange={(e) => setSettingGroup(e.target.value)}
                placeholder="Group name — leave empty to remove"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => saveSettings.mutate()}
              disabled={saveSettings.isPending}
              style={{ background: color.bg, color: '#fff', border: 'none' }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
