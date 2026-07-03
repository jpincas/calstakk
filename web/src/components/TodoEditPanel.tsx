import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import { Trash2, Link } from 'lucide-react'
import { toast } from 'sonner'
import { DateInput } from '@/components/DateInput'
import type { Todo } from '@/types'

function icalToInput(s?: string): string {
  if (!s) return ''
  const d = s.replace(/T.*$/, '').slice(0, 8)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''
}

const PRIORITY_OPTS = [
  { label: 'None', value: 0 },
  { label: 'Low', value: 7 },
  { label: 'Medium', value: 5 },
  { label: 'High', value: 2 },
] as const

interface Props {
  todo: Todo
  collection: string
  accentColor: string
  /** True for read-only shared collections: fields disabled, no save/delete. */
  readOnly?: boolean
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 16,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
  marginBottom: 4,
}

export function TodoEditPanel({ todo, collection, accentColor, readOnly = false, onClose }: Props) {
  const qc = useQueryClient()
  const [description, setDescription] = useState(todo.description ?? '')
  const [due, setDue] = useState(icalToInput(todo.due))
  const [status, setStatus] = useState(todo.status ?? 'NEEDS-ACTION')
  const [priority, setPriority] = useState(todo.priority ?? 0)
  const [url, setUrl] = useState(todo.url ?? '')
  const [categories, setCategories] = useState<string[]>(todo.categories ?? [])
  const [catInput, setCatInput] = useState('')
  const [dependsOn, setDependsOn] = useState(todo.depends_on ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Candidates for "Waiting on": open tasks in this collection, minus self
  // and anything whose dependency chain already leads back here (no cycles).
  const { data: colTodos = [] } = useQuery<Todo[]>({
    queryKey: ['todos', collection],
    queryFn: () => caldav.listTodos(collection),
  })
  const byUid = new Map(colTodos.map((t) => [t.uid, t]))
  const leadsBackHere = (startUid: string): boolean => {
    const seen = new Set<string>()
    let cur: string | undefined = startUid
    while (cur && !seen.has(cur)) {
      if (cur === todo.uid) return true
      seen.add(cur)
      cur = byUid.get(cur)?.depends_on
    }
    return false
  }
  const dependencyCandidates = colTodos.filter((t) =>
    t.uid !== todo.uid &&
    t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
    !leadsBackHere(t.uid),
  )
  // A stale value (blocker since completed/deleted) still needs a visible option.
  const staleDependency = dependsOn && !dependencyCandidates.some((t) => t.uid === dependsOn)
    ? byUid.get(dependsOn)
    : undefined

  const editedTodo = (): Todo => ({
    ...todo,
    description: description.trim() || undefined,
    due: due ? due.replace(/-/g, '') : undefined,
    status,
    priority: priority || undefined,
    url: url.trim() || undefined,
    categories: categories.length ? categories : undefined,
    depends_on: dependsOn || undefined,
  })

  const save = useMutation({
    mutationFn: (updated: Todo) => caldav.updateTodo(collection, updated),
    ...withOptimism<Todo>(qc, {
      patches: (updated) => [
        patchList<Todo>(['todos', collection], (todos) =>
          todos.map((t) => (t.uid === updated.uid ? updated : t))),
      ],
      sideEffects: () => onClose(),
      onSuccess: () => toast.success('Saved'),
    }),
  })

  const del = useMutation({
    mutationFn: () => caldav.deleteTodo(collection, todo.uid),
    ...withOptimism<void>(qc, {
      patches: () => [
        patchList<Todo>(['todos', collection], (todos) => todos.filter((t) => t.uid !== todo.uid)),
      ],
      sideEffects: () => onClose(),
      onSuccess: () => toast.success('Deleted'),
    }),
  })

  const addCat = (v: string) => {
    const t = v.trim()
    if (t && !categories.includes(t)) setCategories([...categories, t])
    setCatInput('')
  }

  return (
    <div
      tabIndex={-1}
      style={{
        outline: 'none',
        padding: '12px 16px 14px 14px',
        borderLeft: `3px solid ${accentColor}`,
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Notes */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={readOnly ? undefined : 'Add notes…'}
        rows={2}
        disabled={readOnly}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
      />

      {/* Due + Status — 2-column */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Due</span>
          <DateInput value={due} onChange={setDue} disabled={readOnly} style={inputStyle} wrapperStyle={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={readOnly} style={inputStyle}>
            <option value="NEEDS-ACTION">To do</option>
            <option value="IN-PROCESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Priority pills */}
      <div>
        <span style={labelStyle}>Priority</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRIORITY_OPTS.map(({ label, value }) => (
            <button
              key={label}
              type="button"
              disabled={readOnly}
              onClick={() => setPriority(value)}
              style={{
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 14,
                fontWeight: 500,
                cursor: readOnly ? 'default' : 'pointer',
                transition: 'all 80ms',
                border: `1px solid ${priority === value ? accentColor : 'var(--border)'}`,
                background: priority === value ? accentColor : 'var(--background)',
                color: priority === value ? '#fff' : 'var(--muted-foreground)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Waiting on — RELATED-TO;RELTYPE=DEPENDS-ON */}
      <div>
        <span style={labelStyle}>Waiting on</span>
        <select
          value={dependsOn}
          onChange={(e) => setDependsOn(e.target.value)}
          disabled={readOnly}
          style={inputStyle}
        >
          <option value="">Nothing — task is active</option>
          {staleDependency && (
            <option value={staleDependency.uid}>{staleDependency.summary} (completed)</option>
          )}
          {dependencyCandidates.map((t) => (
            <option key={t.uid} value={t.uid}>{t.summary}</option>
          ))}
        </select>
      </div>

      {/* URL */}
      <div>
        <span style={labelStyle}>URL</span>
        <div style={{ position: 'relative' }}>
          <Link
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              width: 12, height: 12, color: 'var(--muted-foreground)', pointerEvents: 'none',
            }}
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={readOnly ? undefined : 'https://…'}
            disabled={readOnly}
            style={{ ...inputStyle, paddingLeft: 26 }}
          />
        </div>
      </div>

      {/* Tags chip input */}
      <div>
        <span style={labelStyle}>Tags</span>
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 5,
            padding: '4px 6px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--background)',
            minHeight: 32, alignItems: 'center',
          }}
        >
          {categories.map((cat) => (
            <span
              key={cat}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 7px', borderRadius: 20,
                background: `${accentColor}22`, color: accentColor,
                fontSize: 14, fontWeight: 500,
              }}
            >
              {cat}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setCategories(categories.filter((c) => c !== cat))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1, fontSize: 17 }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <input
            value={catInput}
            onChange={(e) => setCatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCat(catInput) }
              if (e.key === 'Backspace' && !catInput && categories.length) setCategories(categories.slice(0, -1))
            }}
            onBlur={() => catInput.trim() && addCat(catInput)}
            disabled={readOnly}
            placeholder={readOnly || categories.length > 0 ? '' : 'Add tags…'}
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 16, color: 'var(--foreground)', fontFamily: 'inherit',
              minWidth: 80, flex: 1,
            }}
          />
        </div>
      </div>

      {/* Footer: delete left, cancel+save right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2 }}>
        {readOnly ? (
          <span />
        ) : confirmDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, color: 'var(--destructive)', fontWeight: 500 }}>Delete?</span>
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--destructive)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--foreground)' }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title="Delete task"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center' }}
          >
            <Trash2 style={{ width: 14, height: 14 }} />
          </button>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--foreground)' }}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => save.mutate(editedTodo())}
              disabled={save.isPending}
              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: accentColor, color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.7 : 1 }}
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
