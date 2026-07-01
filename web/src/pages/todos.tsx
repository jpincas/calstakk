import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useLocation } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Inbox } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { TaskList } from '@/components/TaskList'
import type { Collection } from '@/types'

interface TodoForm { uid: string; summary: string; description: string; due: string; status: string }
const emptyForm = (uid = ''): TodoForm => ({ uid, summary: '', description: '', due: '', status: 'NEEDS-ACTION' })

export function TodosPage() {
  const { collection: collectionParam } = useParams<{ collection?: string }>()
  const location = useLocation()
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

  const [newForm, setNewForm] = useState<TodoForm | null>(null)

  const createTodo = useMutation({
    mutationFn: (f: TodoForm) =>
      caldav.createTodo(collection!, {
        uid: f.uid || crypto.randomUUID(),
        summary: f.summary,
        description: f.description || undefined,
        due: f.due || undefined,
        status: f.status,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['todos', collection] })
      setNewForm(null)
      toast.success('Task created')
    },
    onError: (e) => toast.error(String(e)),
  })

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
        controls={
          <button
            onClick={() => setNewForm(emptyForm(crypto.randomUUID()))}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus style={{ width: 13, height: 13 }} />
            New task
          </button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column' }}>
        <TaskList collection={collection} accentColor={color.bg} />
      </div>

      {/* New task modal — full-featured creation */}
      <Dialog open={!!newForm} onOpenChange={(o) => !o && setNewForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          {newForm && (
            <div className="grid gap-3">
              <div><Label>Title</Label><Input value={newForm.summary} onChange={(e) => setNewForm({ ...newForm, summary: e.target.value })} autoFocus /></div>
              <div><Label>Description</Label><Input value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} /></div>
              <div><Label>Due date</Label><Input type="date" value={newForm.due} onChange={(e) => setNewForm({ ...newForm, due: e.target.value })} /></div>
              <div>
                <Label>Status</Label>
                <select value={newForm.status} onChange={(e) => setNewForm({ ...newForm, status: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="NEEDS-ACTION">To do</option>
                  <option value="IN-PROCESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => createTodo.mutate(newForm!)} disabled={createTodo.isPending || !newForm?.summary} style={{ background: color.bg, color: '#fff', border: 'none' }}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
