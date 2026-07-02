/**
 * TaskList — self-contained task list with sections, DnD, inline-add, and completed group.
 * Used by both TodosPage (Inbox) and ProjectPage; both share the ['todos', collection] cache.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { isBefore, isToday, startOfDay } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { caldav } from '@/api'
import { parseCalDate, fmtDateShort } from '@/lib/dates'
import { toast } from 'sonner'
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, Plus, Trash2, Check, X, Sun,
} from 'lucide-react'
import { TodoEditPanel } from '@/components/TodoEditPanel'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu'
import {
  DragOverlay, useDndMonitor,
  type DragEndEvent, type DragStartEvent,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Todo, Section, Collection } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaskListProps {
  collection: string
  accentColor: string
}

// ── TodoRow (module-level to prevent remount on parent re-render) ─────────────

interface TodoRowProps {
  todo: Todo
  accentColor: string
  onToggle: () => void
  togglePending: boolean
  isEditingTitle: boolean
  editingValue: string
  isExpanded: boolean
  onFirstClick: () => void
  onEditValueChange: (v: string) => void
  onEditBlur: () => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function TodoRow({
  todo, accentColor, onToggle, togglePending,
  isEditingTitle, editingValue, isExpanded,
  onFirstClick, onEditValueChange, onEditBlur, onEditKeyDown,
}: TodoRowProps) {
  const [hovered, setHovered] = useState(false)
  const done = todo.status === 'COMPLETED'
  const due = todo.due ? parseCalDate(todo.due) : null
  const overdue = !done && !!due && isBefore(due, startOfDay(new Date())) && !isToday(due)
  const dueToday = !!due && isToday(due)
  const showControls = hovered || isEditingTitle

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
        borderRadius: isExpanded ? '8px 8px 0 0' : 8,
        cursor: 'pointer', transition: 'background 100ms',
        background: showControls ? 'var(--hover-bg)' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={!isEditingTitle ? onFirstClick : undefined}
    >
      <button
        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: togglePending ? 0.5 : 1 }}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
      >
        {done
          ? <CheckCircle2 style={{ width: 16, height: 16, color: '#10B981' }} />
          : <Circle style={{ width: 16, height: 16, color: overdue ? 'var(--destructive)' : accentColor }} />
        }
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditingTitle ? (
          <input
            autoFocus
            value={editingValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', fontSize: 17, lineHeight: '18px', height: '18px', color: 'var(--foreground)', background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', display: 'block' }}
          />
        ) : (
          <>
            <p style={{ fontSize: 17, lineHeight: '18px', color: done ? 'var(--ui-text-muted)' : 'var(--foreground)', margin: 0, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {todo.summary}
            </p>
            {todo.description && (
              <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {todo.description}
              </p>
            )}
          </>
        )}
      </div>
      {!isEditingTitle && due && (
        dueToday ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 500, flexShrink: 0, color: '#F59E0B' }}>
            <Sun style={{ width: 13, height: 13 }} />
            Today
          </span>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 500, flexShrink: 0, color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
            {fmtDateShort(due)}
          </span>
        )
      )}
    </div>
  )
}

// ── SortableTodoRow (module-level) ────────────────────────────────────────────

function SortableTodoRow({ containerId, ...rowProps }: TodoRowProps & { containerId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowProps.todo.uid,
    data: { type: 'task', containerId },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TodoRow {...rowProps} />
    </div>
  )
}

// ── InlineNewRow (module-level) ───────────────────────────────────────────────

interface InlineNewRowProps {
  value: string
  accentColor: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}

function InlineNewRow({ value, accentColor, inputRef, onChange, onKeyDown, onBlur }: InlineNewRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, background: 'var(--hover-bg)' }}>
      <Circle style={{ width: 16, height: 16, color: accentColor, flexShrink: 0 }} />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder="Task name…"
        style={{ flex: 1, fontSize: 17, lineHeight: '18px', height: '18px', color: 'var(--foreground)', background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', display: 'block' }}
      />
    </div>
  )
}

// ── TaskContextMenu (module-level) ────────────────────────────────────────────

interface TaskContextMenuProps {
  children: React.ReactNode
  collections: Collection[]
  currentCollection: string
  onMove: (targetCollection: string) => void
}

function TaskContextMenu({ children, collections, currentCollection, onMove }: TaskContextMenuProps) {
  const targets = collections.filter((c) => c.name !== currentCollection && c.name !== 'inbox')
  return (
    <ContextMenu>
      <ContextMenuTrigger style={{ display: 'block' }}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {targets.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 16, color: 'var(--muted-foreground)' }}>No other lists</div>
            ) : (
              targets.map((c) => (
                <ContextMenuItem key={c.name} onSelect={() => onMove(c.name)}>
                  {c.display_name}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── DroppableSection ──────────────────────────────────────────────────────────
// Wraps an entire section (header + tasks) as a single droppable zone.
// This prevents the drag overlay from snapping back when the pointer crosses
// the section header, which has no droppable registration of its own.

interface DroppableSectionProps {
  containerId: string
  children: React.ReactNode
}

function DroppableSection({ containerId, children }: DroppableSectionProps) {
  const { setNodeRef } = useDroppable({
    id: containerId,
    data: { type: 'container', containerId },
  })
  return <div ref={setNodeRef}>{children}</div>
}

// ── SectionBucket ─────────────────────────────────────────────────────────────

interface SectionBucketProps {
  containerId: string
  tasks: Todo[]
  renderRow: (todo: Todo) => React.ReactNode
}

function SectionBucket({ tasks, renderRow }: SectionBucketProps) {
  return (
    // minHeight ensures empty sections remain droppable targets
    <div style={{ minHeight: tasks.length === 0 ? 8 : undefined }}>
      <SortableContext items={tasks.map(t => t.uid)} strategy={verticalListSortingStrategy}>
        {tasks.map(t => renderRow(t))}
      </SortableContext>
    </div>
  )
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  section: Section
  taskCount: number
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onAdd: () => void
  isEditing: boolean
  editValue: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
}

function SectionHeader({
  section, taskCount, isFirst, isLast,
  onMoveUp, onMoveDown, onDelete, onAdd,
  isEditing, editValue, onStartEdit, onEditChange, onEditCommit, onEditCancel,
}: SectionHeaderProps) {
  const [hovered, setHovered] = useState(false)

  const iconBtn = (onClick: () => void, title: string, icon: React.ReactNode, danger = false) => (
    <button
      onClick={onClick}
      title={title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--muted-foreground)', borderRadius: 4, display: 'flex', lineHeight: 1 }}
      onMouseEnter={(e) => (e.currentTarget.style.color = danger ? 'var(--destructive)' : 'var(--foreground)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted-foreground)')}
    >
      {icon}
    </button>
  )

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '18px 10px 4px',
        borderTop: '1px solid var(--border)',
        marginTop: 6,
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isEditing ? (
        <>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (editValue.trim()) onEditCommit() }
              else if (e.key === 'Escape') onEditCancel()
            }}
            onBlur={() => { if (editValue.trim()) onEditCommit(); else onEditCancel() }}
            style={{ flex: 1, fontSize: 16, fontWeight: 600, color: 'var(--foreground)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', padding: '0 0 2px', fontFamily: 'inherit' }}
          />
          <button
            onClick={onEditCommit}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--foreground)', display: 'flex', lineHeight: 1 }}
          >
            <Check style={{ width: 13, height: 13 }} />
          </button>
          <button
            onClick={onEditCancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--muted-foreground)', display: 'flex', lineHeight: 1 }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        </>
      ) : (
        <>
          <span
            style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', cursor: 'text', flex: 1, lineHeight: '18px' }}
            onClick={onStartEdit}
          >
            {section.name}
          </span>
          {taskCount > 0 && (
            <span style={{ fontSize: 14, color: 'var(--muted-foreground)', marginLeft: 4 }}>
              {taskCount}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, opacity: hovered ? 1 : 0, transition: 'opacity 120ms', pointerEvents: hovered ? 'auto' : 'none' }}>
            {!isFirst && iconBtn(onMoveUp, 'Move section up', <ChevronUp style={{ width: 13, height: 13 }} />)}
            {!isLast && iconBtn(onMoveDown, 'Move section down', <ChevronDown style={{ width: 13, height: 13 }} />)}
            {iconBtn(onAdd, 'Add task to section', <Plus style={{ width: 13, height: 13 }} />)}
            {iconBtn(onDelete, 'Delete section', <Trash2 style={{ width: 13, height: 13 }} />, true)}
          </div>
        </>
      )}
    </div>
  )
}

// ── TaskList ──────────────────────────────────────────────────────────────────

export function TaskList({ collection, accentColor }: TaskListProps) {
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

  // ── Edit state ────────────────────────────────────────────────────────────

  const [editingTodo, setEditingTodo] = useState<{ uid: string; value: string } | null>(null)
  const [panelOpenUid, setPanelOpenUid] = useState<string | null>(null)

  // ── Inline-add state (null | 'ungrouped' | sectionId) ─────────────────────

  const [showInlineNew, setShowInlineNew] = useState<string | null>(null)
  const [inlineNewValue, setInlineNewValue] = useState('')
  const inlineNewRef = useRef<HTMLInputElement>(null)

  // ── Completed ─────────────────────────────────────────────────────────────

  const [showCompleted, setShowCompleted] = useState(false)

  // ── Section editing ───────────────────────────────────────────────────────

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [sectionNameInput, setSectionNameInput] = useState('')
  const [showNewSection, setShowNewSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')

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

  const toggle = useMutation({
    mutationFn: (todo: Todo) =>
      caldav.updateTodo(collection, { ...todo, status: todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', collection] }),
    onError: (e) => toast.error(String(e)),
  })

  const saveInlineNew = useMutation({
    mutationFn: ({ uid, summary, section_id }: { uid: string; summary: string; section_id?: string }) =>
      caldav.createTodo(collection, { uid, summary, status: 'NEEDS-ACTION', section_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', collection] }),
    onError: (e) => toast.error(String(e)),
  })

  const updateTitle = useMutation({
    mutationFn: ({ todo, newSummary }: { todo: Todo; newSummary: string }) =>
      caldav.updateTodo(collection, { ...todo, summary: newSummary }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', collection] }),
    onError: (e) => toast.error(String(e)),
  })

  const moveTodo = useMutation({
    mutationFn: ({ todo, to }: { todo: Todo; to: string }) => caldav.moveTodo(collection, to, todo),
    onSuccess: (_, { to }) => {
      void qc.invalidateQueries({ queryKey: ['todos', collection] })
      void qc.invalidateQueries({ queryKey: ['todos', to] })
      toast.success('Task moved')
    },
    onError: (e) => toast.error(String(e)),
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
    if (!over) return
    if (dragActive.data.current?.type !== 'task') return

    if (over.data.current?.type === 'collection') {
      const targetCollection = over.data.current.name as string
      if (targetCollection === collection) return
      const curActive = optimisticActive ?? computedActive
      const draggedTodo = curActive.find((t) => t.uid === String(dragActive.id))
      if (draggedTodo) moveTodo.mutate({ todo: draggedTodo, to: targetCollection })
      return
    }
    if (dragActive.id === over.id) return

    const sourceContainerId = dragActive.data.current.containerId as string
    const overData = over.data.current
    const targetContainerId: string =
      overData?.type === 'task' ? (overData.containerId as string) :
      overData?.type === 'container' ? (overData.containerId as string) :
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
  }, [optimisticActive, computedActive, sections, getTaskBucket, dragUpdate, collection, moveTodo])

  // ── Inline-add handlers ───────────────────────────────────────────────────

  const commitInlineNew = () => {
    const trimmed = inlineNewValue.trim()
    if (!trimmed) { setShowInlineNew(null); setInlineNewValue(''); return }
    const uid = crypto.randomUUID()
    setInlineCreatedUids(prev => [...prev, uid])
    const section_id = (!showInlineNew || showInlineNew === 'ungrouped') ? undefined : showInlineNew
    saveInlineNew.mutate({ uid, summary: trimmed, section_id })
    setInlineNewValue('')
    // Keep input open for multi-add; Escape or blur-with-empty closes it
  }

  const handleInlineNewKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitInlineNew() }
    else if (e.key === 'Escape') { setShowInlineNew(null); setInlineNewValue('') }
  }

  const handleInlineNewBlur = () => {
    if (!inlineNewValue.trim()) { setShowInlineNew(null); setInlineNewValue('') }
    else commitInlineNew()
  }

  const handleBlankAreaClick = () => {
    if (showInlineNew === 'ungrouped') inlineNewRef.current?.focus()
    else { setShowInlineNew('ungrouped'); setInlineNewValue('') }
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────

  const handleFirstClick = (todo: Todo) => {
    setEditingTodo({ uid: todo.uid, value: todo.summary })
    setPanelOpenUid(todo.uid)
  }

  const handleEditBlur = (todo: Todo) => {
    setEditingTodo((current) => {
      if (!current || current.uid !== todo.uid) return current
      const trimmed = current.value.trim()
      if (trimmed && trimmed !== todo.summary) updateTitle.mutate({ todo, newSummary: trimmed })
      return null
    })
  }

  const handleEditKeyDown = (todo: Todo, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!editingTodo) return
      const trimmed = editingTodo.value.trim()
      if (trimmed && trimmed !== todo.summary) updateTitle.mutate({ todo, newSummary: trimmed })
      setEditingTodo(null)
    } else if (e.key === 'Escape') {
      setEditingTodo(null)
      setPanelOpenUid(null)
    }
  }

  // ── Row helpers ───────────────────────────────────────────────────────────

  const rowProps = (todo: Todo): TodoRowProps => ({
    todo,
    accentColor,
    onToggle: () => toggle.mutate(todo),
    togglePending: toggle.isPending,
    isEditingTitle: editingTodo?.uid === todo.uid,
    editingValue: editingTodo?.uid === todo.uid ? editingTodo.value : todo.summary,
    isExpanded: panelOpenUid === todo.uid,
    onFirstClick: () => handleFirstClick(todo),
    onEditValueChange: (v: string) => setEditingTodo({ uid: todo.uid, value: v }),
    onEditBlur: () => handleEditBlur(todo),
    onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => handleEditKeyDown(todo, e),
  })

  const renderTodoRow = (todo: Todo, containerId: string) => (
    <div
      key={todo.uid}
      tabIndex={-1}
      style={{ outline: 'none' }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPanelOpenUid(null)
      }}
    >
      <TaskContextMenu collections={collections} currentCollection={collection} onMove={(to) => moveTodo.mutate({ todo, to })}>
        <SortableTodoRow {...rowProps(todo)} containerId={containerId} />
      </TaskContextMenu>
      {panelOpenUid === todo.uid && (
        <TodoEditPanel
          todo={todo}
          collection={collection}
          accentColor={accentColor}
          onClose={() => { setEditingTodo(null); setPanelOpenUid(null) }}
        />
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  useDndMonitor({ onDragStart: handleDragStart, onDragEnd: handleDragEnd })

  if (isLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 17 }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
        <>

          {/* Ungrouped tasks (no section, or section deleted) */}
          {ungroupedTasks.length === 0 && sections.length === 0 && !showInlineNew && (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <CheckCircle2 style={{ width: 24, height: 24, color: 'var(--border)', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 17, color: 'var(--ui-text-muted)', margin: 0 }}>All caught up.</p>
            </div>
          )}
          <SectionBucket
            containerId="ungrouped"
            tasks={ungroupedTasks}
            renderRow={(t) => renderTodoRow(t, 'ungrouped')}
          />
          {showInlineNew === 'ungrouped' && (
            <InlineNewRow
              value={inlineNewValue}
              accentColor={accentColor}
              inputRef={inlineNewRef}
              onChange={setInlineNewValue}
              onKeyDown={handleInlineNewKey}
              onBlur={handleInlineNewBlur}
            />
          )}

          {/* Sections */}
          {sections.map((section, idx) => (
            <DroppableSection key={section.id} containerId={section.id}>
              <SectionHeader
                section={section}
                taskCount={(sectionedTasks[section.id] ?? []).length}
                isFirst={idx === 0}
                isLast={idx === sections.length - 1}
                onMoveUp={() => moveSectionUp(section.id)}
                onMoveDown={() => moveSectionDown(section.id)}
                onDelete={() => deleteSection(section.id)}
                onAdd={() => { setShowInlineNew(section.id); setInlineNewValue('') }}
                isEditing={editingSectionId === section.id}
                editValue={sectionNameInput}
                onStartEdit={() => { setEditingSectionId(section.id); setSectionNameInput(section.name) }}
                onEditChange={setSectionNameInput}
                onEditCommit={() => { renameSection(section.id, sectionNameInput); setEditingSectionId(null) }}
                onEditCancel={() => setEditingSectionId(null)}
              />
              <SectionBucket
                containerId={section.id}
                tasks={sectionedTasks[section.id] ?? []}
                renderRow={(t) => renderTodoRow(t, section.id)}
              />
              {showInlineNew === section.id && (
                <InlineNewRow
                  value={inlineNewValue}
                  accentColor={accentColor}
                  inputRef={inlineNewRef}
                  onChange={setInlineNewValue}
                  onKeyDown={handleInlineNewKey}
                  onBlur={handleInlineNewBlur}
                />
              )}
            </DroppableSection>
          ))}

          <DragOverlay dropAnimation={null}>
            {activeDragId ? (() => {
              const t = (optimisticActive ?? computedActive).find(x => x.uid === activeDragId)
              return t ? <TodoRow {...rowProps(t)} /> : null
            })() : null}
          </DragOverlay>

        </>

        {/* Add section */}
        <div style={{ padding: '4px 10px 2px' }}>
          {showNewSection ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 0 4px' }}>
              <input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (newSectionName.trim()) {
                      addSection(newSectionName)
                      setNewSectionName('')
                      setShowNewSection(false)
                    }
                  } else if (e.key === 'Escape') {
                    setShowNewSection(false)
                    setNewSectionName('')
                  }
                }}
                onBlur={() => {
                  if (newSectionName.trim()) addSection(newSectionName)
                  setNewSectionName('')
                  setShowNewSection(false)
                }}
                placeholder="Section name…"
                style={{ flex: 1, fontSize: 16, fontWeight: 600, color: 'var(--foreground)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', padding: '0 0 2px', fontFamily: 'inherit' }}
              />
            </div>
          ) : (
            <button
              onClick={() => { setShowNewSection(true); setNewSectionName('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', color: 'var(--muted-foreground)', fontSize: 16, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5, transition: 'opacity 150ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
            >
              <Plus style={{ width: 12, height: 12 }} />
              Add section
            </button>
          )}
        </div>
      </div>

      {/* Blank click-to-add area (clicks open ungrouped inline-add) */}
      <div style={{ flex: 1, minHeight: 60, cursor: 'text' }} onClick={handleBlankAreaClick} />

      {/* Completed group (global, not sectioned) */}
      {completed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowCompleted(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', fontSize: 16, fontWeight: 500, transition: 'background 100ms' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 style={{ width: 14, height: 14, color: 'var(--ui-text-muted)' }} />
              Completed ({completed.length})
            </span>
            <ChevronDown style={{ width: 14, height: 14, transform: showCompleted ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
          </button>
          {showCompleted && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
              {completed.map(t => (
                <div
                  key={t.uid}
                  tabIndex={-1}
                  style={{ outline: 'none' }}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setPanelOpenUid(null)
                  }}
                >
                  <TaskContextMenu collections={collections} currentCollection={collection} onMove={(to) => moveTodo.mutate({ todo: t, to })}>
                    <TodoRow {...rowProps(t)} />
                  </TaskContextMenu>
                  {panelOpenUid === t.uid && (
                    <TodoEditPanel
                      todo={t}
                      collection={collection}
                      accentColor={accentColor}
                      onClose={() => { setEditingTodo(null); setPanelOpenUid(null) }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
