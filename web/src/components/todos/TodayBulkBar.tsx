/**
 * TodayBulkBar — bulk-operation controls for the Today view's selection,
 * rendered inside the PageBar. Same affordances as TaskBulkBar (complete,
 * move, delete, clear) but the selection spans collections: every action
 * groups the tasks by their home collection and patches each affected cache.
 */

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FolderInput, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList, type CachePatch } from '@/lib/optimistic'
import { PageBarIconButton } from '@/components/layout/PageBar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Todo, Collection } from '@/types'
import type { GlobalTodo } from './useGlobalTodos'

export interface TodayBulkBarProps {
  selected: GlobalTodo[]
  onClear: () => void
  /** Called with the tasks just completed, so the view can start their fade-out grace. */
  onCompleted: (todos: GlobalTodo[]) => void
}

function groupByCollection(items: GlobalTodo[]): Map<string, GlobalTodo[]> {
  const m = new Map<string, GlobalTodo[]>()
  for (const t of items) {
    const group = m.get(t._colRef)
    if (group) group.push(t)
    else m.set(t._colRef, [t])
  }
  return m
}

function toPlainTodo(t: GlobalTodo): Todo {
  const todo: Todo & Partial<GlobalTodo> = { ...t }
  delete todo._colRef
  delete todo._colDisplayName
  delete todo._colColor
  delete todo._colReadOnly
  return todo
}

export function TodayBulkBar({ selected, onClear, onCompleted }: TodayBulkBarProps) {
  const qc = useQueryClient()
  const [moveOpen, setMoveOpen] = useState(false)
  // Armed delete keyed to the exact selection, so any change disarms it.
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const selectionKey = selected.map((t) => `${t._colRef}/${t.uid}`).join('\n')
  const deleteArmed = armedKey === selectionKey

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  useEffect(() => {
    if (!deleteArmed) return
    const t = setTimeout(() => setArmedKey(null), 2500)
    return () => clearTimeout(t)
  }, [deleteArmed])

  const completeMut = useMutation({
    mutationFn: (items: GlobalTodo[]) =>
      Promise.all(items.map((t) => caldav.updateTodo(t._colRef, { ...toPlainTodo(t), status: 'COMPLETED' }))),
    ...withOptimism<GlobalTodo[]>(qc, {
      patches: (items) =>
        [...groupByCollection(items)].map(([col, group]): CachePatch => {
          const ids = new Set(group.map((t) => t.uid))
          return patchList<Todo>(['todos', col], (ts) =>
            ts.map((t) => (ids.has(t.uid) ? { ...t, status: 'COMPLETED' } : t)))
        }),
      sideEffects: (items) => { onCompleted(items); onClear() },
    }),
  })

  const deleteMut = useMutation({
    mutationFn: (items: GlobalTodo[]) =>
      Promise.all(items.map((t) => caldav.deleteTodo(t._colRef, t.uid))),
    ...withOptimism<GlobalTodo[]>(qc, {
      patches: (items) =>
        [...groupByCollection(items)].map(([col, group]): CachePatch => {
          const ids = new Set(group.map((t) => t.uid))
          return patchList<Todo>(['todos', col], (ts) => ts.filter((t) => !ids.has(t.uid)))
        }),
      sideEffects: () => onClear(),
      onSuccess: (_d, items) => toast.success(items.length === 1 ? 'Task deleted' : `${items.length} tasks deleted`),
    }),
  })

  const moveMut = useMutation({
    // Tasks already in the target collection stay put (a same-collection
    // "move" would create-then-delete the same resource).
    mutationFn: ({ items, to }: { items: GlobalTodo[]; to: string }) =>
      Promise.all(items.filter((t) => t._colRef !== to).map((t) => caldav.moveTodo(t._colRef, to, toPlainTodo(t)))),
    ...withOptimism<{ items: GlobalTodo[]; to: string }>(qc, {
      patches: ({ items, to }) => {
        const moving = items.filter((t) => t._colRef !== to)
        const sourcePatches = [...groupByCollection(moving)].map(([col, group]): CachePatch => {
          const ids = new Set(group.map((t) => t.uid))
          return patchList<Todo>(['todos', col], (ts) => ts.filter((t) => !ids.has(t.uid)))
        })
        return [
          ...sourcePatches,
          patchList<Todo>(['todos', to], (ts) => [
            ...ts,
            ...moving.map((t) => ({ ...toPlainTodo(t), section_id: undefined, x_sort_order: undefined })),
          ]),
        ]
      },
      sideEffects: () => { onClear(); setMoveOpen(false) },
      onSuccess: (_d, { items }) => toast.success(items.length === 1 ? 'Task moved' : `${items.length} tasks moved`),
    }),
  })

  if (selected.length === 0) return null

  // Move targets must be writable — moving into a read-only shared collection would 403.
  const targets = collections.filter((c) => c.ref !== 'inbox' && c.myAccess !== 'read')

  return (
    <>
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
        {selected.length} selected
      </span>
      <PageBarIconButton onClick={() => completeMut.mutate(selected)} title="Mark complete">
        <CheckCircle2 style={{ width: 18, height: 18 }} />
      </PageBarIconButton>
      <PageBarIconButton onClick={() => setMoveOpen(true)} title="Move to…">
        <FolderInput style={{ width: 18, height: 18 }} />
      </PageBarIconButton>
      <PageBarIconButton
        onClick={() => {
          if (deleteArmed) deleteMut.mutate(selected)
          else setArmedKey(selectionKey)
        }}
        title={deleteArmed ? `Click again to delete ${selected.length} task${selected.length === 1 ? '' : 's'}` : 'Delete'}
        danger={deleteArmed}
      >
        <Trash2 style={{ width: 18, height: 18 }} />
      </PageBarIconButton>
      <PageBarIconButton onClick={onClear} title="Clear selection">
        <X style={{ width: 18, height: 18 }} />
      </PageBarIconButton>
      <div style={{ width: 1, alignSelf: 'stretch', margin: '10px 2px', background: 'var(--border)' }} />

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent style={{ color: 'var(--foreground)' }}>
          <DialogHeader>
            <DialogTitle>
              Move {selected.length} task{selected.length === 1 ? '' : 's'} to…
            </DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
            {targets.length === 0 ? (
              <p style={{ fontSize: 16, color: 'var(--muted-foreground)', margin: 0, padding: '8px 4px' }}>
                No lists to move to.
              </p>
            ) : (
              targets.map((c) => (
                <button
                  key={c.ref}
                  onClick={() => moveMut.mutate({ items: selected, to: c.ref })}
                  disabled={moveMut.isPending}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 10px', borderRadius: 8,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 17, color: 'var(--foreground)', textAlign: 'left',
                    transition: 'background 100ms',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color ?? 'var(--muted-foreground)', flexShrink: 0 }} />
                  {c.display_name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
