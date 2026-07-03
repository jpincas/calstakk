import type { Section, Todo } from '@/types'

/**
 * The canonical comparator behind every task list: explicit x_sort_order
 * first, then (optionally) local creation order for just-created tasks,
 * then due date, with undated tasks last.
 */
export function compareTodos(a: Todo, b: Todo, inlineCreatedUids: string[] = []): number {
  if (a.x_sort_order !== undefined && b.x_sort_order !== undefined) return a.x_sort_order - b.x_sort_order
  if (a.x_sort_order !== undefined) return -1
  if (b.x_sort_order !== undefined) return 1
  const ai = inlineCreatedUids.indexOf(a.uid)
  const bi = inlineCreatedUids.indexOf(b.uid)
  if (ai !== -1 && bi !== -1) return ai - bi
  if (ai !== -1) return 1
  if (bi !== -1) return -1
  if (!a.due && !b.due) return 0
  if (!a.due) return 1
  if (!b.due) return -1
  return a.due.localeCompare(b.due)
}

/**
 * Active todos in the exact order the project task list displays them:
 * ungrouped tasks first, then each section in registry order, compareTodos
 * within each bucket. x_sort_order values are per-bucket, so the bucket
 * pass (not the sort alone) is what makes this order canonical.
 */
export function canonicalTaskOrder(todos: Todo[], sections: Section[]): Todo[] {
  const active = todos
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
    .sort((a, b) => compareTodos(a, b))
  const valid = new Set(sections.map((s) => s.id))
  const ungrouped = active.filter((t) => !t.section_id || !valid.has(t.section_id))
  return [
    ...ungrouped,
    ...sections.flatMap((s) => active.filter((t) => t.section_id === s.id)),
  ]
}
