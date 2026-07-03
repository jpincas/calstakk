/**
 * useRowEditing — per-view row interaction state: inline title editing and
 * the expanded TodoEditPanel, both entered by double-click (single click is
 * selection — see useTaskSelection). Both views instantiate their own copy
 * (the state is presentation-local; toggling views closes any open panel).
 */

import { useState } from 'react'
import type { Todo } from '@/types'
import type { TodoRowProps } from './rows'
import type { TaskListCore } from './useTaskListCore'
import type { TaskSelection } from './useTaskSelection'

export interface RowEditing {
  /** Build the props for a TodoRow, wired to this view's edit + selection state. */
  rowProps: (todo: Todo) => TodoRowProps
  panelOpenUid: string | null
  /** Close the edit panel and abandon any in-progress title edit. */
  closePanel: () => void
  /** onBlur handler for the row+panel wrapper — closes the panel when focus leaves it. */
  handleContainerBlur: (e: React.FocusEvent<HTMLDivElement>) => void
}

export function useRowEditing(core: TaskListCore, accentColor: string, selection: TaskSelection): RowEditing {
  const [editingTodo, setEditingTodo] = useState<{ uid: string; value: string } | null>(null)
  const [panelOpenUid, setPanelOpenUid] = useState<string | null>(null)

  const openEditor = (todo: Todo) => {
    // Edit mode supersedes selection — the double-click's first click selected this row.
    selection.clear()
    // Read-only: opening the detail panel is fine, inline title editing is not.
    if (!core.readOnly) setEditingTodo({ uid: todo.uid, value: todo.summary })
    setPanelOpenUid(todo.uid)
  }

  const handleEditBlur = (todo: Todo) => {
    setEditingTodo((current) => {
      if (!current || current.uid !== todo.uid) return current
      const trimmed = current.value.trim()
      if (trimmed && trimmed !== todo.summary) core.updateTitle(todo, trimmed)
      return null
    })
  }

  const handleEditKeyDown = (todo: Todo, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!editingTodo) return
      const trimmed = editingTodo.value.trim()
      if (trimmed && trimmed !== todo.summary) core.updateTitle(todo, trimmed)
      setEditingTodo(null)
    } else if (e.key === 'Escape') {
      setEditingTodo(null)
      setPanelOpenUid(null)
    }
  }

  const rowProps = (todo: Todo): TodoRowProps => ({
    todo,
    accentColor,
    readOnly: core.readOnly,
    onToggle: () => core.toggle(todo),
    isEditingTitle: editingTodo?.uid === todo.uid,
    editingValue: editingTodo?.uid === todo.uid ? editingTodo.value : todo.summary,
    isExpanded: panelOpenUid === todo.uid,
    selected: selection.isSelected(todo.uid),
    onSelect: (e: React.MouseEvent) => selection.handleRowClick(todo, e),
    onOpenEditor: () => openEditor(todo),
    onEditValueChange: (v: string) => setEditingTodo({ uid: todo.uid, value: v }),
    onEditBlur: () => handleEditBlur(todo),
    onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => handleEditKeyDown(todo, e),
  })

  return {
    rowProps,
    panelOpenUid,
    closePanel: () => { setEditingTodo(null); setPanelOpenUid(null) },
    handleContainerBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setPanelOpenUid(null)
    },
  }
}
