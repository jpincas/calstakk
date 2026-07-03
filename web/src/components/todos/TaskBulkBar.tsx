/**
 * TaskBulkBar — bulk-operation controls for the current task selection,
 * rendered inside the page's PageBar. Invisible until one or more tasks are
 * selected in this collection; then shows the count plus toggle-complete,
 * move-to (destination picker), and delete (two-click confirm).
 */

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FolderInput, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import { useTaskSelectionStore } from '@/state/selection'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageBarIconButton } from '@/components/layout/PageBar'
import type { Todo, Collection } from '@/types'

export interface TaskBulkBarProps {
  collection: string
  readOnly?: boolean
  /** True when the PageBar has an accent background (white-on-colour styling). */
  colored?: boolean
}

export function TaskBulkBar({ collection, readOnly = false, colored = false }: TaskBulkBarProps) {
  const qc = useQueryClient()
  const selCollection = useTaskSelectionStore((s) => s.collection)
  const uids = useTaskSelectionStore((s) => s.uids)
  const clear = useTaskSelectionStore((s) => s.clear)

  const [moveOpen, setMoveOpen] = useState(false)
  // Armed delete is keyed to the exact selection it was armed for, so any
  // selection change implicitly disarms it — no state syncing needed.
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const selectionKey = uids.join('\n')
  const deleteArmed = armedKey === selectionKey

  // Shared caches — same keys the task views use, so these never double-fetch.
  const { data: todos = [] } = useQuery<Todo[]>({
    queryKey: ['todos', collection],
    queryFn: () => caldav.listTodos(collection),
    enabled: !!collection,
  })
  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  // Armed delete disarms itself if not confirmed promptly.
  useEffect(() => {
    if (!deleteArmed) return
    const t = setTimeout(() => setArmedKey(null), 2500)
    return () => clearTimeout(t)
  }, [deleteArmed])

  const toggleMut = useMutation({
    mutationFn: ({ items, status }: { items: Todo[]; status: string }) =>
      Promise.all(items.map((t) => caldav.updateTodo(collection, { ...t, status }))),
    ...withOptimism<{ items: Todo[]; status: string }>(qc, {
      patches: ({ items, status }) => {
        const ids = new Set(items.map((t) => t.uid))
        return [
          patchList<Todo>(['todos', collection], (ts) =>
            ts.map((t) => (ids.has(t.uid) ? { ...t, status } : t))),
        ]
      },
      sideEffects: () => clear(),
    }),
  })

  const deleteMut = useMutation({
    mutationFn: (items: Todo[]) =>
      Promise.all(items.map((t) => caldav.deleteTodo(collection, t.uid))),
    ...withOptimism<Todo[]>(qc, {
      patches: (items) => {
        const ids = new Set(items.map((t) => t.uid))
        return [
          patchList<Todo>(['todos', collection], (ts) => ts.filter((t) => !ids.has(t.uid))),
        ]
      },
      sideEffects: () => clear(),
      onSuccess: (_d, items) => toast.success(items.length === 1 ? 'Task deleted' : `${items.length} tasks deleted`),
    }),
  })

  const moveMut = useMutation({
    mutationFn: ({ items, to }: { items: Todo[]; to: string }) =>
      Promise.all(items.map((t) => caldav.moveTodo(collection, to, t))),
    ...withOptimism<{ items: Todo[]; to: string }>(qc, {
      patches: ({ items, to }) => {
        const ids = new Set(items.map((t) => t.uid))
        return [
          patchList<Todo>(['todos', collection], (ts) => ts.filter((t) => !ids.has(t.uid))),
          patchList<Todo>(['todos', to], (ts) => [
            ...ts,
            ...items.map((t) => ({ ...t, section_id: undefined, x_sort_order: undefined })),
          ]),
        ]
      },
      sideEffects: () => { clear(); setMoveOpen(false) },
      onSuccess: (_d, { items }) => toast.success(items.length === 1 ? 'Task moved' : `${items.length} tasks moved`),
    }),
  })

  if (readOnly || selCollection !== collection || uids.length === 0) return null

  const uidSet = new Set(uids)
  const selected = todos.filter((t) => uidSet.has(t.uid))
  if (selected.length === 0) return null

  const allComplete = selected.every((t) => t.status === 'COMPLETED')
  // Move targets must be writable — moving into a read-only shared collection would 403.
  const targets = collections.filter((c) => c.ref !== collection && c.ref !== 'inbox' && c.myAccess !== 'read')

  const fg = colored ? 'rgba(255,255,255,0.85)' : 'var(--muted-foreground)'

  const iconBtn = (onClick: () => void, title: string, icon: React.ReactNode, danger = false) => (
    <PageBarIconButton key={title} onClick={onClick} title={title} colored={colored} danger={danger}>
      {icon}
    </PageBarIconButton>
  )

  return (
    <>
      <span style={{ fontSize: 16, fontWeight: 600, color: fg, whiteSpace: 'nowrap' }}>
        {selected.length} selected
      </span>
      {iconBtn(
        () => toggleMut.mutate({ items: selected, status: allComplete ? 'NEEDS-ACTION' : 'COMPLETED' }),
        allComplete ? 'Mark incomplete' : 'Mark complete',
        <CheckCircle2 style={{ width: 18, height: 18 }} />,
      )}
      {iconBtn(
        () => setMoveOpen(true),
        'Move to…',
        <FolderInput style={{ width: 18, height: 18 }} />,
      )}
      {iconBtn(
        () => {
          if (deleteArmed) deleteMut.mutate(selected)
          else setArmedKey(selectionKey)
        },
        deleteArmed ? `Click again to delete ${selected.length} task${selected.length === 1 ? '' : 's'}` : 'Delete',
        <Trash2 style={{ width: 18, height: 18 }} />,
        deleteArmed,
      )}
      {iconBtn(
        clear,
        'Clear selection',
        <X style={{ width: 18, height: 18 }} />,
      )}
      {/* Divider between bulk actions and the page's regular controls */}
      <div style={{ width: 1, alignSelf: 'stretch', margin: '10px 2px', background: colored ? 'rgba(255,255,255,0.35)' : 'var(--border)' }} />

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        {/* This dialog mounts inside the PageBar, which may set white text on a
            colored bar — the inherited color must be reset for the content. */}
        <DialogContent style={{ color: 'var(--foreground)' }}>
          <DialogHeader>
            <DialogTitle>
              Move {selected.length} task{selected.length === 1 ? '' : 's'} to…
            </DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
            {targets.length === 0 ? (
              <p style={{ fontSize: 16, color: 'var(--muted-foreground)', margin: 0, padding: '8px 4px' }}>
                No other lists to move to.
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
