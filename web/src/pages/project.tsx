import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import { calendarLinkFor, fmtTime } from '@/lib/dates'
import { expandEvent, type Occurrence } from '@/lib/recur'
import { collectionColor, SETTING_COLORS } from '@/lib/colors'
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
import { Settings, Plus, Share2, Eye, Columns3, LayoutList } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { TasksView } from '@/components/todos/TasksView'
import { TaskBulkBar } from '@/components/todos/TaskBulkBar'
import { ShareDialog } from '@/components/ShareDialog'
import { NewTaskDialog } from '@/components/NewTaskDialog'
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

const BUCKET_ORDER = ['Today', 'This Week', 'This Month', 'Next Month', 'Later'] as const
type Bucket = typeof BUCKET_ORDER[number]

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const navigate = useNavigate()
  const { setCollection, taskView, setTaskView } = useCollectionStore()

  // Sync active collection to store
  useEffect(() => {
    if (colName) setCollection(colName)
  }, [colName, setCollection])

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const { data: me = null } = useQuery({
    queryKey: ['me'],
    queryFn: () => caldav.whoami(),
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

  const col = collections.find((c) => c.ref === colName)
  const names = collections.map((c) => c.ref)
  const isOwner = !col || col.myAccess === 'owner'
  const readOnly = col?.myAccess === 'read'

  const color = useMemo(() => {
    if (col?.color) return { bg: col.color, text: '#fff' }
    const c = collectionColor(names, colName ?? '')
    return { bg: c.bg, text: '#fff' }
  }, [col, names, colName])

  const displayName = col?.display_name ?? colName ?? 'Project'
  const view = (colName ? taskView[colName] : undefined) ?? 'list'

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
    const bucketed: Record<Bucket, Occurrence[]> = {
      Today: [],
      'This Week': [],
      'This Month': [],
      'Next Month': [],
      Later: [],
    }

    // Recurring series are expanded over a bounded horizon so "Later" shows
    // at least a month past "Next Month"; one-off events beyond the horizon
    // still appear (expandEvent emits non-recurring events unconditionally).
    const horizon = addMonths(startOfDay(today), 3)
    const occurrences = events
      .flatMap((e) => expandEvent(e, startOfDay(today), horizon))
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    for (const occ of occurrences) {
      const bucket = getEventBucket(occ.start, today)
      if (!bucket) continue
      bucketed[bucket].push(occ)
    }

    return BUCKET_ORDER.filter((b) => bucketed[b].length > 0).map((b) => ({
      label: b,
      events: bucketed[b],
    }))
  }, [events])

  // ── UI state ─────────────────────────────────────────────────────────────

  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [eventForm, setEventForm] = useState<EventForm | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [isNarrow, setIsNarrow] = useState(false)
  const [activeTab, setActiveTab] = useState<'Tasks' | 'Events'>('Tasks')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
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

  const formToEvent = (f: EventForm): Omit<CalEvent, 'href'> => ({
    uid: f.uid,
    summary: f.summary,
    start: f.start || new Date().toISOString(),
    end: f.end || undefined,
    description: f.description || undefined,
    location: f.location || undefined,
  })

  const eventSave = useMutation({
    mutationFn: (event: Omit<CalEvent, 'href'>) => caldav.createEvent(colName!, event),
    ...withOptimism<Omit<CalEvent, 'href'>>(qc, {
      patches: (event) => [
        patchList<CalEvent>(['events', colName], (events) => [...events, { ...event, href: '' }]),
      ],
      sideEffects: () => setEventForm(null),
      onSuccess: () => toast.success('Event created'),
    }),
  })

  const saveName = useMutation({
    mutationFn: (name: string) =>
      caldav.updateCollectionProps(colName!, { displayName: name }),
    ...withOptimism<string>(qc, {
      patches: (name) => [
        patchList<Collection>(['collections'], (cols) =>
          cols.map((c) => (c.ref === colName ? { ...c, display_name: name } : c))),
      ],
      sideEffects: () => setEditingName(false),
    }),
  })

  const saveSettings = useMutation({
    mutationFn: () =>
      caldav.updateCollectionProps(colName!, {
        color: settingColor || undefined,
        group: settingGroup.trim() || null,
      }),
    ...withOptimism<void>(qc, {
      patches: () => [
        patchList<Collection>(['collections'], (cols) =>
          cols.map((c) =>
            c.ref === colName
              ? { ...c, color: settingColor || undefined, group: settingGroup.trim() || undefined }
              : c
          )),
      ],
      sideEffects: () => setSettingsOpen(false),
      onSuccess: () => toast.success('Settings saved'),
    }),
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
      <div style={{ flex: 1, overflowY: view === 'board' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TasksView collection={colName} accentColor={color.bg} readOnly={readOnly} view={view} />
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
              {bucketEvents.map((occ) => {
                const { start, end, allDay } = occ
                const location = occ.fields.location
                const timeStr = allDay ? 'All day' : `${fmtTime(start)} – ${fmtTime(end)}`
                const dayNum = format(start, 'd')
                const monthStr = format(start, 'MMM').toUpperCase()
                return (
                  <div
                    key={`${occ.master.uid}-${occ.key}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background 100ms',
                    }}
                    onClick={() => { void navigate(calendarLinkFor(start)) }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
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
                        {occ.fields.summary}
                      </p>
                      {timeStr && (
                        <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
                          {timeStr}
                        </p>
                      )}
                      {location && (
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
                          {location}
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
              onClick={isOwner ? () => { setNameInput(displayName); setEditingName(true) } : undefined}
              style={{ cursor: isOwner ? 'text' : 'default', color: 'inherit' }}
            >
              {displayName}
            </span>
          )
        }
        detail={
          <>
            {`${activeCount} active · ${completedCount} completed`}
            {col?.shared && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {readOnly && <Eye style={{ width: 13, height: 13 }} />}
                {readOnly ? 'Read-only · ' : ''}shared by {col.owner}
              </span>
            )}
          </>
        }
        controls={
          <>
            <TaskBulkBar collection={colName} readOnly={readOnly} colored />
            <button
              onClick={() => setTaskView(colName, view === 'list' ? 'board' : 'list')}
              title={view === 'list' ? 'Board view' : 'List view'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'transparent', color: 'rgba(255,255,255,0.85)',
                cursor: 'pointer',
              }}
            >
              {view === 'list'
                ? <Columns3 style={{ width: 18, height: 18 }} />
                : <LayoutList style={{ width: 18, height: 18 }} />}
            </button>
            {isOwner && col && (
              <button
                onClick={() => setShareOpen(true)}
                title={col.sharedWith?.length ? `Shared with ${col.sharedWith.length}` : 'Share'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'transparent', color: 'rgba(255,255,255,0.85)',
                  fontSize: 16, fontWeight: 600, cursor: 'pointer',
                  height: 36,
                }}
              >
                <Share2 style={{ width: 16, height: 16 }} />
                {col.sharedWith && col.sharedWith.length > 0 ? col.sharedWith.length : null}
              </button>
            )}
            {isOwner && (
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
            )}
            {!readOnly && (
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
            )}
            {!readOnly && (
            <button
              onClick={() => setNewTaskOpen(true)}
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
            )}
          </>
        }
      />

      {/* Narrow mode tab bar (list view only — the board owns the full width, no events pane) */}
      {view !== 'board' && isNarrow && (
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
        {view === 'board' ? (
          TasksPane
        ) : isNarrow ? (
          activeTab === 'Tasks' ? TasksPane : EventsPane
        ) : (
          <>
            {TasksPane}
            {EventsPane}
          </>
        )}
      </div>

      <NewTaskDialog collection={colName} accentColor={color.bg} open={newTaskOpen} onOpenChange={setNewTaskOpen} />

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
              onClick={() => eventSave.mutate(formToEvent(eventForm!))}
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

      {/* Share modal — owner only */}
      {isOwner && col && (
        <ShareDialog
          collectionRef={col.ref}
          collectionDisplayName={displayName}
          accentColor={color.bg}
          me={me}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  )
}
