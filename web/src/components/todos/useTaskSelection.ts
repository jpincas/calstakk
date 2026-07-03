/**
 * useTaskSelection — view-side adapter over the task selection store.
 * Maps row clicks to selection semantics (plain = select only, ctrl/cmd =
 * toggle, shift = range in the view's visible order) and clears the
 * selection on Escape. Both views (list + board) instantiate it with their
 * own visible ordering so shift-ranges follow what's on screen.
 */

import { useEffect, useMemo } from 'react'
import { useTaskSelectionStore } from '@/state/selection'
import type { Todo } from '@/types'

export interface TaskSelection {
  isSelected: (uid: string) => boolean
  hasSelection: boolean
  /** The selected todos, in visible order. */
  selectedTodos: Todo[]
  /**
   * The todos a row-level action (context menu) should apply to: the whole
   * selection when the row is part of it, otherwise just that row.
   */
  targetsFor: (todo: Todo) => Todo[]
  handleRowClick: (todo: Todo, e: React.MouseEvent) => void
  clear: () => void
}

export function useTaskSelection(collection: string, orderedTodos: Todo[]): TaskSelection {
  const selCollection = useTaskSelectionStore((s) => s.collection)
  const uids = useTaskSelectionStore((s) => s.uids)
  const selectOnly = useTaskSelectionStore((s) => s.selectOnly)
  const toggle = useTaskSelectionStore((s) => s.toggle)
  const rangeTo = useTaskSelectionStore((s) => s.rangeTo)
  const clear = useTaskSelectionStore((s) => s.clear)

  const active = selCollection === collection
  const selectedSet = useMemo(() => new Set(active ? uids : []), [active, uids])
  const selectedTodos = useMemo(
    () => orderedTodos.filter((t) => selectedSet.has(t.uid)),
    [orderedTodos, selectedSet],
  )

  useEffect(() => {
    if (selectedSet.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      // An open layer (context menu, dialog) consumes Escape to close itself
      // and preventDefaults it — only a free Escape clears the selection.
      if (e.key === 'Escape' && !e.defaultPrevented) clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSet.size, clear])

  return {
    isSelected: (uid) => selectedSet.has(uid),
    hasSelection: selectedSet.size > 0,
    selectedTodos,
    targetsFor: (todo) => (selectedSet.has(todo.uid) ? selectedTodos : [todo]),
    handleRowClick: (todo, e) => {
      if (e.ctrlKey || e.metaKey) toggle(collection, todo.uid)
      else if (e.shiftKey) rangeTo(collection, todo.uid, orderedTodos.map((t) => t.uid))
      else selectOnly(collection, todo.uid)
    },
    clear,
  }
}
