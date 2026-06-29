import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { listTodos, putTodo, deleteCalObject } from '@/api/caldav'
import { collectionColor } from '@/lib/colors'
import { fmtDate, isOverdue } from '@/lib/dates'
import { useQuery as useCollectionsQuery } from '@tanstack/react-query'
import { listCollections } from '@/api/collections'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, CheckCircle2, Circle, AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Todo } from '@/types'

interface TodoForm { uid: string; summary: string; description: string; due: string; status: string }
const empty = (uid = ''): TodoForm => ({ uid, summary: '', description: '', due: '', status: 'NEEDS-ACTION' })

const STATUS_CONFIG = {
  'NEEDS-ACTION': { label: 'To do',       color: '#6b7280', bg: '#f3f4f6' },
  'IN-PROCESS':   { label: 'In progress', color: '#d97706', bg: '#fffbeb' },
  'COMPLETED':    { label: 'Done',        color: '#059669', bg: '#ecfdf5' },
  'CANCELLED':    { label: 'Cancelled',   color: '#9ca3af', bg: '#f9fafb' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG['NEEDS-ACTION']
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

export function TodosPage() {
  const { collection } = useParams<{ collection: string }>()
  const qc = useQueryClient()
  const { data: collections = [] } = useCollectionsQuery({ queryKey: ['collections'], queryFn: listCollections })
  const color = collection ? collectionColor(collections.map(c => c.name), collection) : { bg: '#2563eb', light: '#eff6ff', muted: '#dbeafe', border: '#93c5fd', text: '#fff' }

  const [form, setForm] = useState<TodoForm | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  const { data: todos = [], isLoading } = useQuery({
    queryKey: ['todos', collection],
    queryFn: () => listTodos(collection!),
    enabled: !!collection,
  })

  const save = useMutation({
    mutationFn: (f: TodoForm) => putTodo(collection!, f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['todos', collection] }); setForm(null); toast.success('Task saved') },
    onError: (e) => toast.error(String(e)),
  })
  const del = useMutation({
    mutationFn: (uid: string) => deleteCalObject(collection!, uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['todos', collection] }); setForm(null); toast.success('Deleted') },
    onError: (e) => toast.error(String(e)),
  })
  const toggle = useMutation({
    mutationFn: (todo: Todo) => putTodo(collection!, { ...todo, status: todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', collection] }),
    onError: (e) => toast.error(String(e)),
  })

  const active = todos.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
    .sort((a, b) => { if (!a.due && !b.due) return 0; if (!a.due) return 1; if (!b.due) return -1; return a.due.localeCompare(b.due) })
  const completed = todos.filter(t => t.status === 'COMPLETED')

  const TodoRow = ({ todo }: { todo: Todo }) => {
    const done = todo.status === 'COMPLETED'
    const overdue = !done && isOverdue(todo.due)
    return (
      <div className={cn('group flex items-start gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors cursor-pointer')}
        onClick={() => { setForm({ uid: todo.uid, summary: todo.summary, description: todo.description ?? '', due: todo.due ?? '', status: todo.status ?? 'NEEDS-ACTION' }); setIsNew(false) }}>
        <button
          className="flex-shrink-0 mt-0.5 transition-transform hover:scale-110"
          onClick={e => { e.stopPropagation(); toggle.mutate(todo) }}
        >
          {done
            ? <CheckCircle2 className="w-5 h-5" style={{ color: '#059669' }} />
            : overdue
              ? <AlertCircle className="w-5 h-5" style={{ color: '#ef4444' }} />
              : <Circle className="w-5 h-5 text-gray-300 group-hover:text-gray-400" />
          }
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium text-gray-800 leading-tight', done && 'line-through text-gray-400')}>{todo.summary}</p>
          {todo.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{todo.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {todo.due && (
            <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full')}
              style={{ background: overdue ? '#fef2f2' : '#f3f4f6', color: overdue ? '#ef4444' : '#6b7280' }}>
              {fmtDate(todo.due)}
            </span>
          )}
          {todo.status && <StatusBadge status={todo.status} />}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">To-dos</h1>
          <p className="text-sm text-gray-400 mt-0.5">{active.length} active · {completed.length} completed</p>
        </div>
        <button onClick={() => { setForm(empty(crypto.randomUUID())); setIsNew(true) }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ background: color.bg }}>
          <Plus className="w-4 h-4" /> New task
        </button>
      </div>

      {isLoading ? (
        <div className="cs-card rounded-xl p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Active tasks */}
          <div className="cs-card rounded-xl overflow-hidden">
            {active.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                <CheckCircle2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                All done! No active tasks.
              </div>
            ) : active.map(todo => <TodoRow key={todo.uid} todo={todo} />)}
          </div>

          {/* Completed section */}
          {completed.length > 0 && (
            <div className="cs-card rounded-xl overflow-hidden">
              <button
                onClick={() => setShowCompleted(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-gray-300" />
                  Completed ({completed.length})
                </span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', showCompleted && 'rotate-180')} />
              </button>
              {showCompleted && completed.map(todo => <TodoRow key={todo.uid} todo={todo} />)}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o: boolean) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isNew ? 'New task' : 'Edit task'}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div><Label>Title</Label><Input value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} autoFocus /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Due date</Label><Input type="date" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} /></div>
              <div>
                <Label>Status</Label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
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
            <Button onClick={() => save.mutate(form!)} disabled={save.isPending} style={{ background: color.bg, color: 'white' }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
