/**
 * useGlobalTodos — cross-collection todo aggregation for the global views
 * (Waiting, per-tag lists) and the sidebar links that lead to them. Each todo
 * is annotated with its collection's ref/name/color/access; the queries share
 * the per-collection ['todos', ref] cache with the rest of the app.
 */

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { withOptimism, patchList } from '@/lib/optimistic'
import type { Collection, Todo } from '@/types'

export interface GlobalTodo extends Todo {
  _colRef: string
  _colDisplayName: string
  _colColor: string
  _colReadOnly: boolean
}

export interface GlobalTodos {
  isLoading: boolean
  /** Every todo in every collection (completed included), annotated. */
  all: GlobalTodo[]
  /** Active (not completed/cancelled) todos. */
  active: GlobalTodo[]
  /** Distinct tags across active todos, sorted. */
  tags: string[]
  /** Active todos blocked by a still-open dependency, paired with their blocker. */
  waiting: { todo: GlobalTodo; blocker: GlobalTodo }[]
}

export function useGlobalTodos(): GlobalTodos {
  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const todoQueries = useQueries({
    queries: collections.map((c) => ({
      queryKey: ['todos', c.ref],
      queryFn: () => caldav.listTodos(c.ref),
    })),
  })

  const isLoading = todoQueries.some((q) => q.isLoading)
  const names = collections.map((c) => c.ref)

  const all: GlobalTodo[] = collections.flatMap((col, i) => {
    const color = col.color ?? collectionColor(names, col.ref).bg
    return (todoQueries[i]?.data ?? []).map((t) => ({
      ...t,
      _colRef: col.ref,
      _colDisplayName: col.display_name,
      _colColor: color,
      _colReadOnly: col.myAccess === 'read',
    }))
  })

  const active = all.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
  const tags = [...new Set(active.flatMap((t) => t.categories ?? []))].sort((a, b) => a.localeCompare(b))

  // Dependencies resolve within the todo's own collection.
  const byKey = new Map(all.map((t) => [`${t._colRef}/${t.uid}`, t]))
  const waiting = active.flatMap((t) => {
    if (!t.depends_on) return []
    const blocker = byKey.get(`${t._colRef}/${t.depends_on}`)
    if (!blocker || blocker.status === 'COMPLETED' || blocker.status === 'CANCELLED') return []
    return [{ todo: t, blocker }]
  })

  return { isLoading, all, active, tags, waiting }
}

/** Complete/uncomplete a todo from a global view, patching its collection's cache. */
export function useGlobalToggle() {
  const qc = useQueryClient()
  const flip = (s?: string) => (s === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED')
  return useMutation({
    mutationFn: (todo: GlobalTodo) => {
      const { _colRef, ...clean } = todo
      return caldav.updateTodo(_colRef, { ...clean, status: flip(clean.status) })
    },
    ...withOptimism<GlobalTodo>(qc, {
      patches: (todo) => [
        patchList<Todo>(['todos', todo._colRef], (todos) =>
          todos.map((t) => (t.uid === todo.uid ? { ...t, status: flip(t.status) } : t))),
      ],
    }),
  })
}
