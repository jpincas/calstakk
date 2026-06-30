import { useState } from 'react'
import { isBefore, isToday, startOfDay } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useLocation } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, CheckCircle2, Circle, ChevronDown, Inbox } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import type { Collection, Todo } from '@/types'

interface TodoForm { uid: string; summary: string; description: string; due: string; status: string }
const empty = (uid = ''): TodoForm => ({ uid, summary: '', description: '', due: '', status: 'NEEDS-ACTION' })


export function TodosPage() {
  const { collection: collectionParam } = useParams<{ collection?: string }>()
  const location = useLocation()
  // Inbox route has no :collection param — infer from path
  const collection = collectionParam ?? (location.pathname === '/inbox' ? 'capture' : undefined)

  const qc = useQueryClient()
  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const names = collections.map((c: Collection) => c.name)
  const color = collection
    ? collectionColor(names, collection)
    : { bg: '#6366F1', text: '#fff', light: '#eef2ff', border: '#a5b4fc', muted: '#c7d2fe' }

  const [form, setForm] = useState<TodoForm | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  const { data: todos = [], isLoading } = useQuery({
    queryKey: ['todos', collection],
    queryFn: () => caldav.listTodos(collection!),
    enabled: !!collection,
  })

  const save = useMutation({
    mutationFn: (f: TodoForm) => {
      const payload = {
        uid: f.uid || crypto.randomUUID(),
        summary: f.summary,
        description: f.description || undefined,
        due: f.due || undefined,
        status: f.status,
      }
      return isNew
        ? caldav.createTodo(collection!, payload)
        : caldav.updateTodo(collection!, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', collection] })
      setForm(null)
      toast.success('Task saved')
    },
    onError: (e) => toast.error(String(e)),
  })

  const del = useMutation({
    mutationFn: (uid: string) => caldav.deleteTodo(collection!, uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', collection] })
      setForm(null)
      toast.success('Deleted')
    },
    onError: (e) => toast.error(String(e)),
  })

  const toggle = useMutation({
    mutationFn: (todo: Todo) =>
      caldav.updateTodo(collection!, {
        ...todo,
        status: todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', collection] }),
    onError: (e) => toast.error(String(e)),
  })

  const active = todos
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
    .sort((a, b) => {
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due.localeCompare(b.due)
    })
  const completed = todos.filter((t) => t.status === 'COMPLETED')


  const TodoRow = ({ todo }: { todo: Todo }) => {
    const done = todo.status === 'COMPLETED'
    const due = todo.due ? parseCalDate(todo.due) : null
    const now = new Date()
    const overdue = !done && !!due && isBefore(due, startOfDay(now)) && !isToday(due)
    const dueToday = !!due && isToday(due)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '9px 10px',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 100ms',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => {
          setForm({ uid: todo.uid, summary: todo.summary, description: todo.description ?? '', due: todo.due ?? '', status: todo.status ?? 'NEEDS-ACTION' })
          setIsNew(false)
        }}
      >
        <button
          style={{ flexShrink: 0, marginTop: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: toggle.isPending ? 0.5 : 1 }}
          onClick={(e) => { e.stopPropagation(); toggle.mutate(todo) }}
        >
          {done ? (
            <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
          ) : (
            <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : color.bg }} />
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 13,
            fontWeight: 400,
            color: done ? 'var(--ui-text-muted)' : 'var(--foreground)',
            margin: 0,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {todo.summary}
          </p>
          {todo.description && (
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {todo.description}
            </p>
          )}
        </div>
        {due && (
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            flexShrink: 0,
            color: overdue ? 'var(--destructive)' : dueToday ? '#F59E0B' : 'var(--muted-foreground)',
          }}>
            {fmtDateShort(due)}
          </span>
        )}
      </div>
    )
  }

  if (!collection) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Select a project from the sidebar.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageBar
        icon={<Inbox size={14} color="#3B82F6" strokeWidth={2.2} />}
        title="Inbox"
        detail={`${active.length} active · ${completed.length} completed`}
        controls={
          <button
            onClick={() => { setForm(empty(crypto.randomUUID())); setIsNew(true) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7, border: 'none',
              background: '#3B82F6', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus style={{ width: 13, height: 13 }} />
            New task
          </button>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 13 }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Active tasks */}
          {active.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <CheckCircle2 style={{ width: 24, height: 24, color: 'var(--border)', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: 'var(--ui-text-muted)', margin: 0 }}>All caught up.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {active.map((todo) => <TodoRow key={todo.uid} todo={todo} />)}
            </div>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted-foreground)',
                  fontSize: 12,
                  fontWeight: 500,
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 style={{ width: 14, height: 14, color: 'var(--ui-text-muted)' }} />
                  Completed ({completed.length})
                </span>
                <ChevronDown
                  style={{
                    width: 14,
                    height: 14,
                    transform: showCompleted ? 'rotate(180deg)' : 'none',
                    transition: 'transform 150ms',
                  }}
                />
              </button>
              {showCompleted && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
                  {completed.map((todo) => <TodoRow key={todo.uid} todo={todo} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isNew ? 'New task' : 'Edit task'}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div><Label>Title</Label><Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} autoFocus /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Due date</Label><Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
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
            {!isNew && <Button variant="destructive" onClick={() => del.mutate(form!.uid)}>Delete</Button>}
            <Button
              onClick={() => save.mutate(form!)}
              disabled={save.isPending}
              style={{ background: color.bg, color: '#fff', border: 'none' }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}
