import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { caldav } from '@/api'
import { parseCalDate, fmtTime, fmtDate, isOverdue } from '@/lib/dates'
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
import { Settings, Plus, CheckCircle2, Circle, AlertCircle, ChevronDown } from 'lucide-react'
import {
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

const STATUS_CONFIG = {
  'NEEDS-ACTION': { label: 'To do',       color: 'var(--muted-foreground)', bg: 'var(--accent)' },
  'IN-PROCESS':   { label: 'In progress', color: '#F59E0B',                  bg: 'rgba(245,158,11,0.12)' },
  'COMPLETED':    { label: 'Done',        color: '#10B981',                  bg: 'rgba(16,185,129,0.12)' },
  'CANCELLED':    { label: 'Cancelled',   color: 'var(--ui-text-muted)',     bg: 'var(--muted)' },
}

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

/** Convert iCal date (20260630) to HTML date input value (2026-06-30) */
function icalToInputDate(due?: string): string {
  if (!due) return ''
  const s = due.slice(0, 8) // YYYYMMDD
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  return due
}

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

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG['NEEDS-ACTION']
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.color,
      }}
    >
      {cfg.label}
    </span>
  )
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

  const active = useMemo(
    () =>
      todos
        .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
        .sort((a, b) => {
          if (!a.due && !b.due) return 0
          if (!a.due) return 1
          if (!b.due) return -1
          return a.due.localeCompare(b.due)
        }),
    [todos],
  )

  const completed = useMemo(
    () => todos.filter((t) => t.status === 'COMPLETED'),
    [todos],
  )

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
  const [showCompleted, setShowCompleted] = useState(false)
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

  // Initialise settings state when modal opens
  useEffect(() => {
    if (settingsOpen) {
      setSettingColor(col?.color ?? '')
      setSettingGroup(col?.group ?? '')
    }
  }, [settingsOpen, col])

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
      qc.invalidateQueries({ queryKey: ['todos', colName] })
      setForm(null)
      toast.success('Task saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  const todoDel = useMutation({
    mutationFn: (uid: string) => caldav.deleteTodo(colName!, uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', colName] })
      setForm(null)
      toast.success('Deleted')
    },
    onError: (e) => toast.error(String(e)),
  })

  const todoToggle = useMutation({
    mutationFn: (todo: Todo) =>
      caldav.updateTodo(colName!, {
        ...todo,
        status: todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', colName] }),
    onError: (e) => toast.error(String(e)),
  })

  const saveName = useMutation({
    mutationFn: (name: string) =>
      caldav.updateCollectionProps(colName!, { displayName: name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
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
      qc.invalidateQueries({ queryKey: ['collections'] })
      setSettingsOpen(false)
      toast.success('Settings saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  // ── Inline name edit handlers ─────────────────────────────────────────────

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
        <p style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Select a project from the sidebar.</p>
      </div>
    )
  }

  // ── Pane renderers ────────────────────────────────────────────────────────

  const TasksPane = (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      {/* Pane header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
          }}
        >
          Tasks
        </span>
        <button
          onClick={() => { setForm(emptyTodo()); setIsNew(true) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background: color.bg,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus style={{ width: 11, height: 11 }} />
          New task
        </button>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Active todos */}
        {active.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <CheckCircle2 style={{ width: 22, height: 22, color: 'var(--border)', margin: '0 auto 8px' }} />
            <p style={{ fontSize: 13, color: 'var(--ui-text-muted)', margin: 0 }}>All caught up.</p>
          </div>
        ) : (
          active.map((todo) => <TodoRow key={todo.uid} todo={todo} />)
        )}

        {/* Completed section */}
        {completed.length > 0 && (
          <div>
            <button
              onClick={() => setShowCompleted((v) => !v)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                background: 'none',
                border: 'none',
                borderTop: '1px solid var(--border)',
                cursor: 'pointer',
                color: 'var(--muted-foreground)',
                fontSize: 12,
                fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 style={{ width: 13, height: 13, color: 'var(--ui-text-muted)' }} />
                Completed ({completed.length})
              </span>
              <ChevronDown
                style={{
                  width: 13,
                  height: 13,
                  transform: showCompleted ? 'rotate(180deg)' : 'none',
                  transition: 'transform 150ms',
                }}
              />
            </button>
            {showCompleted && completed.map((todo) => <TodoRow key={todo.uid} todo={todo} />)}
          </div>
        )}
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
      {/* Pane header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
          }}
        >
          Events
        </span>
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {eventBuckets.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--ui-text-muted)', margin: 0 }}>No upcoming events.</p>
          </div>
        ) : (
          eventBuckets.map(({ label, events: bucketEvents }) => (
            <div key={label}>
              <div
                style={{
                  padding: '8px 16px 4px',
                  fontSize: 10,
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
                  ? null
                  : `${fmtTime(start)}${end ? ` – ${fmtTime(end)}` : ''}`
                return (
                  <div
                    key={event.uid}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '9px 16px',
                      borderBottom: '1px solid var(--border)',
                      borderLeft: `3px solid ${color.bg}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 13,
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
                        <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
                          {timeStr}
                        </p>
                      )}
                      {event.location && (
                        <p
                          style={{
                            fontSize: 11,
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

  // ── Todo row sub-component ────────────────────────────────────────────────

  function TodoRow({ todo }: { todo: Todo }) {
    const done = todo.status === 'COMPLETED'
    const overdue = !done && isOverdue(todo.due)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          transition: 'background 100ms',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => {
          setForm({
            uid: todo.uid,
            summary: todo.summary,
            description: todo.description ?? '',
            due: icalToInputDate(todo.due),
            status: todo.status ?? 'NEEDS-ACTION',
          })
          setIsNew(false)
        }}
      >
        <button
          style={{
            flexShrink: 0,
            marginTop: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            transition: 'opacity 100ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          onClick={(e) => { e.stopPropagation(); todoToggle.mutate(todo) }}
        >
          {done ? (
            <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
          ) : overdue ? (
            <AlertCircle style={{ width: 16, height: 16, color: 'var(--destructive)' }} />
          ) : (
            <Circle style={{ width: 16, height: 16, color: color.bg }} />
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: done ? 'var(--ui-text-muted)' : 'var(--foreground)',
              margin: 0,
              textDecoration: done ? 'line-through' : 'none',
            }}
          >
            {todo.summary}
          </p>
          {todo.description && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--muted-foreground)',
                margin: '2px 0 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {todo.description}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {todo.due && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 7px',
                borderRadius: 20,
                background: overdue ? 'rgba(227,94,94,0.12)' : 'var(--accent)',
                color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)',
              }}
            >
              {fmtDate(todo.due)}
            </span>
          )}
          {todo.status && <StatusBadge status={todo.status} />}
        </div>
      </div>
    )
  }

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
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 52,
          flexShrink: 0,
          padding: '0 20px',
          background: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          gap: 12,
        }}
      >
        {/* Left: dot + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: color.bg,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          {editingName ? (
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
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--foreground)',
                background: 'var(--accent)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
                minWidth: 120,
              }}
            />
          ) : (
            <span
              onClick={() => { setNameInput(displayName); setEditingName(true) }}
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--foreground)',
                cursor: 'text',
              }}
            >
              {displayName}
            </span>
          )}
        </div>

        {/* Centre: counts */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {active.length} active · {completed.length} completed
          </span>
        </div>

        {/* Right: settings */}
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 100ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Settings style={{ width: 14, height: 14 }} />
        </button>
      </div>

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
                fontSize: 13,
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

      {/* Task dialog */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? 'New task' : 'Edit task'}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.due}
                  onChange={(e) => setForm({ ...form, due: e.target.value })}
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="NEEDS-ACTION">To do</option>
                  <option value="IN-PROCESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {!isNew && (
              <Button variant="destructive" onClick={() => todoDel.mutate(form!.uid)}>
                Delete
              </Button>
            )}
            <Button
              onClick={() => todoSave.mutate(form!)}
              disabled={todoSave.isPending}
              style={{ background: color.bg, color: '#fff', border: 'none' }}
            >
              Save
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
                  fontSize: 11,
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
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '8px 0 0' }}>
                  Using palette colour. Select a swatch to override.
                </p>
              )}
            </div>

            {/* Group section */}
            <div>
              <p
                style={{
                  fontSize: 11,
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
                          fontSize: 12,
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
