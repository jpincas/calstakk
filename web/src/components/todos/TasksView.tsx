/**
 * TasksView — the component pages embed for a collection's tasks. Owns the
 * shared task-list core (queries, mutations, DnD) and renders the chosen
 * presentation: vertical list or kanban board.
 *
 * The core hook MUST live here, not in the views: it holds drag/optimistic
 * state that has to survive the list/board toggle so mid-flight reorders
 * keep their ordering until the server refetch lands.
 */

import { useTaskListCore } from './useTaskListCore'
import { TaskList } from './TaskList'
import { KanbanBoard } from './KanbanBoard'
import type { TaskViewMode } from '@/state/collection'

export interface TasksViewProps {
  collection: string
  accentColor: string
  /** True when the collection is shared with read access only — hide/disable every mutation affordance. */
  readOnly?: boolean
  view?: TaskViewMode
}

export function TasksView({ collection, accentColor, readOnly = false, view = 'list' }: TasksViewProps) {
  const core = useTaskListCore(collection, readOnly)

  if (core.isLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 17 }}>
        Loading…
      </div>
    )
  }

  return view === 'board'
    ? <KanbanBoard core={core} accentColor={accentColor} />
    : <TaskList core={core} accentColor={accentColor} />
}
