/**
 * useTaskListCore — the shared data/mutation/DnD engine behind both task
 * views (list and kanban board). One source of truth for how reordering,
 * section membership, and section order persist, so the views are pure
 * render layers over the same state and always agree with each other.
 *
 * Must be instantiated ONCE in a component that stays mounted across the
 * list/board toggle (TasksView): drag reindexing has no optimistic cache
 * patch — correct ordering between drop and refetch lives in local state
 * here (optimisticActive, pendingDrag, inlineCreatedUids) and would be
 * lost on remount.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDndMonitor, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import type { Todo, Section, Collection } from '@/types'

export interface TaskListCore {
  collection: string
  readOnly: boolean
  isLoading: boolean
  collections: Collection[]
  sections: Section[]
  /** Active (not completed/cancelled) todos in canonical flat order. */
  activeTodos: Todo[]
  completed: Todo[]
  ungroupedTasks: Todo[]
  sectionedTasks: Record<string, Todo[]>
  /** The todo being dragged, for view-specific DragOverlay ghosts (null for section drags). */
  activeDragTodo: Todo | null
  /** The still-open todo `todo` waits on (via depends_on), if any — undefined once it completes. */
  blockerFor: (todo: Todo) => Todo | undefined
  /** The bucket a todo renders in: 'ungrouped' or a valid section id. */
  bucketOf: (todo: Todo) => string
  // Task operations
  toggle: (todo: Todo) => void
  /**
   * Create a task inline; the hook owns the uid (returned) so new tasks keep
   * their creation order. With afterUid the task is inserted directly below
   * that task (same bucket, whole bucket reindexed).
   */
  createInlineTodo: (summary: string, sectionId?: string, afterUid?: string) => string
  updateTitle: (todo: Todo, newSummary: string) => void
  /** Move one or more tasks to another collection (single optimistic patch + toast). */
  moveToCollection: (todos: Todo[], to: string) => void
  /** Set the due date on one or more tasks. */
  setDue: (todos: Todo[], due: string) => void
  // Section operations
  addSection: (name: string) => void
  renameSection: (id: string, name: string) => void
  deleteSection: (id: string) => void
  moveSectionUp: (id: string) => void
  moveSectionDown: (id: string) => void
}

export function useTaskListCore(collection: string, readOnly: boolean): TaskListCore {
  const qc = useQueryClient()

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: todos = [], isLoading } = useQuery<Todo[]>({
    queryKey: ['todos', collection],
    queryFn: () => caldav.listTodos(collection),
    enabled: !!collection,
  })

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ['sections', collection],
    queryFn: () => caldav.getSections(collection),
    enabled: !!collection,
    staleTime: 60_000, // section registry rarely changes; avoid flicker
  })

  // ── DnD/optimistic state ──────────────────────────────────────────────────

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [optimisticActive, setOptimisticActive] = useState<Todo[] | null>(null)
  const pendingDrag = useRef(0)
  const prevTodosRef = useRef<Todo[]>([])
  const [inlineCreatedUids, setInlineCreatedUids] = useState<string[]>([])

  // Clear optimistic override once fresh server data arrives
  useEffect(() => {
    if (optimisticActive !== null && todos !== prevTodosRef.current) setOptimisticActive(null)
    prevTodosRef.current = todos
  }, [todos, optimisticActive])

  // ── Computed ──────────────────────────────────────────────────────────────

  const computedActive = useMemo(() =>
    todos
      .filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .sort((a, b) => {
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
      }),
    [todos, inlineCreatedUids],
  )

  const activeTodos = optimisticActive ?? computedActive
  const completed = useMemo(() => todos.filter(t => t.status === 'COMPLETED'), [todos])

  const byUid = useMemo(() => new Map(todos.map(t => [t.uid, t])), [todos])
  const blockerFor = useCallback((todo: Todo): Todo | undefined => {
    if (!todo.depends_on) return undefined
    const blocker = byUid.get(todo.depends_on)
    if (!blocker || blocker.status === 'COMPLETED' || blocker.status === 'CANCELLED') return undefined
    return blocker
  }, [byUid])

  const validSectionIds = useMemo(() => new Set(sections.map(s => s.id)), [sections])

  const getTaskBucket = useCallback((todo: Todo): string =>
    (!todo.section_id || !validSectionIds.has(todo.section_id)) ? 'ungrouped' : todo.section_id,
    [validSectionIds],
  )

  const { ungroupedTasks, sectionedTasks } = useMemo(() => {
    const ungrouped: Todo[] = []
    const bySection: Record<string, Todo[]> = {}
    for (const s of sections) bySection[s.id] = []
    for (const t of activeTodos) {
      const bid = getTaskBucket(t)
      if (bid === 'ungrouped') ungrouped.push(t)
      else (bySection[bid] = bySection[bid] ?? []).push(t)
    }
    return { ungroupedTasks: ungrouped, sectionedTasks: bySection }
  }, [activeTodos, sections, getTaskBucket])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const flipStatus = (s?: string) => (s === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED')

  const toggleMut = useMutation({
    mutationFn: (todo: Todo) =>
      caldav.updateTodo(collection, { ...todo, status: flipStatus(todo.status) }),
    ...withOptimism<Todo>(qc, {
      patches: (todo) => [
        patchList<Todo>(['todos', collection], (todos) =>
          todos.map((t) => (t.uid === todo.uid ? { ...t, status: flipStatus(t.status) } : t))),
      ],
    }),
  })

  const saveInlineNew = useMutation({
    mutationFn: ({ uid, summary, section_id }: { uid: string; summary: string; section_id?: string }) =>
      caldav.createTodo(collection, { uid, summary, status: 'NEEDS-ACTION', section_id }),
    ...withOptimism<{ uid: string; summary: string; section_id?: string }>(qc, {
      patches: ({ uid, summary, section_id }) => [
        patchList<Todo>(['todos', collection], (todos) => [
          ...todos,
          { uid, summary, status: 'NEEDS-ACTION', section_id, href: '' },
        ]),
      ],
    }),
  })

  /** Insert-below create: the new task plus the bucket reindex land in one optimistic patch. */
  const insertAfterMut = useMutation({
    mutationFn: ({ create, reorder }: { create: Omit<Todo, 'href'> & { uid: string; summary: string }; reorder: Todo[] }) =>
      Promise.all([
        caldav.createTodo(collection, create),
        ...reorder.map((t) => caldav.updateTodo(collection, t)),
      ]),
    ...withOptimism<{ create: Omit<Todo, 'href'> & { uid: string; summary: string }; reorder: Todo[] }>(qc, {
      patches: ({ create, reorder }) => {
        const orders = new Map(reorder.map((t) => [t.uid, t.x_sort_order]))
        return [
          patchList<Todo>(['todos', collection], (todos) => [
            ...todos.map((t) => (orders.has(t.uid) ? { ...t, x_sort_order: orders.get(t.uid) } : t)),
            { ...create, href: '' },
          ]),
        ]
      },
    }),
  })

  const updateTitleMut = useMutation({
    mutationFn: ({ todo, newSummary }: { todo: Todo; newSummary: string }) =>
      caldav.updateTodo(collection, { ...todo, summary: newSummary }),
    ...withOptimism<{ todo: Todo; newSummary: string }>(qc, {
      patches: ({ todo, newSummary }) => [
        patchList<Todo>(['todos', collection], (todos) =>
          todos.map((t) => (t.uid === todo.uid ? { ...t, summary: newSummary } : t))),
      ],
    }),
  })

  const moveTodosMut = useMutation({
    mutationFn: ({ todos: items, to }: { todos: Todo[]; to: string }) =>
      Promise.all(items.map((t) => caldav.moveTodo(collection, to, t))),
    ...withOptimism<{ todos: Todo[]; to: string }>(qc, {
      patches: ({ todos: items, to }) => {
        const ids = new Set(items.map((t) => t.uid))
        return [
          patchList<Todo>(['todos', collection], (ts) => ts.filter((t) => !ids.has(t.uid))),
          patchList<Todo>(['todos', to], (ts) => [
            ...ts,
            ...items.map((t) => ({ ...t, section_id: undefined, x_sort_order: undefined })),
          ]),
        ]
      },
      onSuccess: (_d, { todos: items }) =>
        toast.success(items.length === 1 ? 'Task moved' : `${items.length} tasks moved`),
    }),
  })

  const setDueMut = useMutation({
    mutationFn: ({ todos: items, due }: { todos: Todo[]; due: string }) =>
      Promise.all(items.map((t) => caldav.updateTodo(collection, { ...t, due }))),
    ...withOptimism<{ todos: Todo[]; due: string }>(qc, {
      patches: ({ todos: items, due }) => {
        const ids = new Set(items.map((t) => t.uid))
        return [
          patchList<Todo>(['todos', collection], (ts) =>
            ts.map((t) => (ids.has(t.uid) ? { ...t, due } : t))),
        ]
      },
      onSuccess: (_d, { todos: items }) => {
        // Single-task due changes stay silent (as before); bulk gets confirmation.
        if (items.length > 1) toast.success(`${items.length} tasks updated`)
      },
    }),
  })

  /** Used for all drag-related writes (x_sort_order and/or section_id). */
  const dragUpdate = useMutation({
    mutationFn: (todo: Todo) => caldav.updateTodo(collection, todo),
    onSettled: () => {
      pendingDrag.current--
      if (pendingDrag.current === 0) void qc.invalidateQueries({ queryKey: ['todos', collection] })
    },
    onError: (e) => toast.error(String(e)),
  })

  const updateSectionsMut = useMutation({
    mutationFn: (newSections: Section[]) => caldav.setSections(collection, newSections),
    onError: (e) => toast.error(String(e)),
  })

  // ── Section operations ────────────────────────────────────────────────────

  const addSection = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const newSec: Section = { id: crypto.randomUUID(), name: trimmed }
    const updated = [...sections, newSec]
    qc.setQueryData(['sections', collection], updated)
    updateSectionsMut.mutate(updated)
  }

  const renameSection = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const updated = sections.map(s => s.id === id ? { ...s, name: trimmed } : s)
    qc.setQueryData(['sections', collection], updated)
    updateSectionsMut.mutate(updated)
  }

  const deleteSection = (id: string) => {
    // Unassign all tasks from this section (move them to ungrouped)
    const affected = activeTodos.filter(t => t.section_id === id)
    for (const t of affected) {
      pendingDrag.current++
      dragUpdate.mutate({ ...t, section_id: undefined })
    }
    const updated = sections.filter(s => s.id !== id)
    qc.setQueryData(['sections', collection], updated)
    updateSectionsMut.mutate(updated)
  }

  const moveSectionUp = (id: string) => {
    const idx = sections.findIndex(s => s.id === id)
    if (idx <= 0) return
    const updated = arrayMove([...sections], idx, idx - 1)
    qc.setQueryData(['sections', collection], updated)
    updateSectionsMut.mutate(updated)
  }

  const moveSectionDown = (id: string) => {
    const idx = sections.findIndex(s => s.id === id)
    if (idx === -1 || idx >= sections.length - 1) return
    const updated = arrayMove([...sections], idx, idx + 1)
    qc.setQueryData(['sections', collection], updated)
    updateSectionsMut.mutate(updated)
  }

  // ── DnD ──────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveDragId(String(active.id))
  }, [])

  const handleDragEnd = useCallback(({ active: dragActive, over }: DragEndEvent) => {
    setActiveDragId(null)
    if (readOnly) return // sortables are disabled too; belt and braces
    if (!over) return

    // Section reorder: collision detection restricts section drags to section
    // blocks, so over.id is always another section's id.
    if (dragActive.data.current?.type === 'section') {
      const oldIndex = sections.findIndex(s => s.id === String(dragActive.id))
      const newIndex = sections.findIndex(s => s.id === String(over.id))
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      const updated = arrayMove([...sections], oldIndex, newIndex)
      qc.setQueryData(['sections', collection], updated)
      updateSectionsMut.mutate(updated)
      return
    }

    if (dragActive.data.current?.type !== 'task') return

    if (over.data.current?.type === 'collection') {
      if (over.data.current.readOnly) return // target collection would 403 the move
      const targetCollection = over.data.current.name as string
      if (targetCollection === collection) return
      const curActive = optimisticActive ?? computedActive
      const draggedTodo = curActive.find((t) => t.uid === String(dragActive.id))
      if (draggedTodo) moveTodosMut.mutate({ todos: [draggedTodo], to: targetCollection })
      return
    }
    if (dragActive.id === over.id) return

    const sourceContainerId = dragActive.data.current.containerId as string
    const overData = over.data.current
    // 'section' = a section block/column; 'container' = a plain bucket zone
    // (the board's "No section" column — kept off type 'section' so section
    // drags never target it via the collision filter).
    const targetContainerId: string =
      overData?.type === 'task' ? (overData.containerId as string) :
      overData?.type === 'section' || overData?.type === 'container' ? (overData.containerId as string) :
      sourceContainerId

    const curActive = optimisticActive ?? computedActive

    // Current bucket contents
    const sourceTasks = curActive.filter(t => getTaskBucket(t) === sourceContainerId)
    const targetTasks = curActive.filter(t => getTaskBucket(t) === targetContainerId)

    const draggedTodo = sourceTasks.find(t => t.uid === String(dragActive.id))
    if (!draggedTodo) return

    const targetSectionId = targetContainerId === 'ungrouped' ? undefined : targetContainerId

    let newSourceTasks: Todo[]
    let newTargetTasks: Todo[]

    if (sourceContainerId === targetContainerId) {
      const oldIndex = sourceTasks.findIndex(t => t.uid === draggedTodo.uid)
      const newIndex = sourceTasks.findIndex(t => t.uid === String(over.id))
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      newTargetTasks = arrayMove(sourceTasks, oldIndex, newIndex)
      newSourceTasks = newTargetTasks
    } else {
      const updatedDragged: Todo = { ...draggedTodo, section_id: targetSectionId }
      newSourceTasks = sourceTasks.filter(t => t.uid !== draggedTodo.uid)
      const insertAt = targetTasks.findIndex(t => t.uid === String(over.id))
      newTargetTasks = insertAt >= 0
        ? [...targetTasks.slice(0, insertAt), updatedDragged, ...targetTasks.slice(insertAt)]
        : [...targetTasks, updatedDragged]
    }

    // Rebuild optimistic flat list: ungrouped first, then sections in order
    const newBuckets: Record<string, Todo[]> = { ungrouped: [] }
    for (const s of sections) newBuckets[s.id] = []
    for (const t of curActive) {
      if (t.uid === draggedTodo.uid) continue
      const bid = getTaskBucket(t)
      if (bid in newBuckets) newBuckets[bid].push(t)
    }
    if (sourceContainerId === targetContainerId) {
      newBuckets[sourceContainerId] = newTargetTasks
    } else {
      newBuckets[sourceContainerId] = newSourceTasks
      newBuckets[targetContainerId] = newTargetTasks
    }
    setOptimisticActive([
      ...newBuckets['ungrouped'],
      ...sections.flatMap(s => newBuckets[s.id] ?? []),
    ])

    // Fire mutations for changed todos
    if (sourceContainerId === targetContainerId) {
      newTargetTasks.forEach((todo, i) => {
        const newOrder = (i + 1) * 1000
        if (todo.x_sort_order !== newOrder) {
          pendingDrag.current++
          dragUpdate.mutate({ ...todo, x_sort_order: newOrder })
        }
      })
    } else {
      // Reindex target bucket (dragged item gets new section_id here)
      newTargetTasks.forEach((todo, i) => {
        const newOrder = (i + 1) * 1000
        const isTheDragged = todo.uid === draggedTodo.uid
        if (isTheDragged || todo.x_sort_order !== newOrder) {
          pendingDrag.current++
          dragUpdate.mutate({
            ...todo,
            x_sort_order: newOrder,
            section_id: isTheDragged ? targetSectionId : todo.section_id,
          })
        }
      })
      // Reindex source bucket (gap left by removed task)
      newSourceTasks.forEach((todo, i) => {
        const newOrder = (i + 1) * 1000
        if (todo.x_sort_order !== newOrder) {
          pendingDrag.current++
          dragUpdate.mutate({ ...todo, x_sort_order: newOrder })
        }
      })
    }
  }, [optimisticActive, computedActive, sections, getTaskBucket, dragUpdate, collection, moveTodosMut, readOnly, qc, updateSectionsMut])

  useDndMonitor({ onDragStart: handleDragStart, onDragEnd: handleDragEnd })

  // ── Public surface ────────────────────────────────────────────────────────

  const createInlineTodo = (summary: string, sectionId?: string, afterUid?: string): string => {
    const uid = crypto.randomUUID()
    setInlineCreatedUids(prev => [...prev, uid])
    const curActive = optimisticActive ?? computedActive
    const after = afterUid ? curActive.find(t => t.uid === afterUid) : undefined
    if (!after) {
      saveInlineNew.mutate({ uid, summary, section_id: sectionId })
      return uid
    }
    // Insert directly below `after`: reindex its whole bucket so every member
    // carries an explicit x_sort_order and the position is unambiguous.
    const bucketId = getTaskBucket(after)
    const targetSectionId = bucketId === 'ungrouped' ? undefined : bucketId
    const bucket = curActive.filter(t => getTaskBucket(t) === bucketId)
    const idx = bucket.findIndex(t => t.uid === after.uid)
    const created: Omit<Todo, 'href'> & { uid: string; summary: string } = {
      uid, summary, status: 'NEEDS-ACTION', section_id: targetSectionId,
    }
    const newBucket: (Todo | typeof created)[] = [...bucket.slice(0, idx + 1), created, ...bucket.slice(idx + 1)]
    const reorder: Todo[] = []
    newBucket.forEach((t, i) => {
      const order = (i + 1) * 1000
      if (t.uid === uid) created.x_sort_order = order
      else if (t.x_sort_order !== order) reorder.push({ ...(t as Todo), x_sort_order: order })
    })
    insertAfterMut.mutate({ create: created, reorder })
    return uid
  }

  const activeDragTodo = activeDragId
    ? activeTodos.find(t => t.uid === activeDragId) ?? null
    : null

  return {
    collection,
    readOnly,
    isLoading,
    collections,
    sections,
    activeTodos,
    completed,
    ungroupedTasks,
    sectionedTasks,
    activeDragTodo,
    blockerFor,
    bucketOf: getTaskBucket,
    // Waiting tasks can't be completed from the row (the checkbox is inert too).
    toggle: (todo) => { if (!blockerFor(todo)) toggleMut.mutate(todo) },
    createInlineTodo,
    updateTitle: (todo, newSummary) => updateTitleMut.mutate({ todo, newSummary }),
    moveToCollection: (todos, to) => moveTodosMut.mutate({ todos, to }),
    setDue: (todos, due) => setDueMut.mutate({ todos, due }),
    addSection,
    renameSection,
    deleteSection,
    moveSectionUp,
    moveSectionDown,
  }
}
