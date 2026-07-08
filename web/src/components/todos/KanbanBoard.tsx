/**
 * KanbanBoard — kanban presentation of a collection's tasks: sections as
 * columns, tasks as cards. Pure render layer over the shared TaskListCore;
 * every drag registers the same sortable data shapes as the list view, so
 * the core's drag handlers persist card order (x_sort_order), membership
 * (section_id), and column order (section registry) identically for both.
 */

import { useState, useRef, useMemo } from 'react'
import { CheckCircle2, ChevronDown, Plus, Trash2, Check, X } from 'lucide-react'
import { DragOverlay, useDroppable, useDndMonitor } from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TodoEditPanel } from '@/components/TodoEditPanel'
import { TodoRow, InlineNewRow } from './rows'
import { TaskContextMenu } from './TaskContextMenu'
import { useRowEditing } from './useRowEditing'
import { useTaskSelection } from './useTaskSelection'
import type { TaskListCore } from './useTaskListCore'
import type { Todo, Section } from '@/types'

export interface KanbanBoardProps {
  core: TaskListCore
  accentColor: string
}

const COLUMN_WIDTH = 300

const cardChromeStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  overflow: 'hidden',
}

// ── SortableBoardCard ─────────────────────────────────────────────────────────
// Same sortable registration as the list's SortableTodoRow — the shared drag
// handlers cannot tell the two views apart.

function SortableBoardCard({ containerId, uid, readOnly, editing, children }: {
  containerId: string
  uid: string
  readOnly: boolean
  /** Drag must stay off while the card's title is being edited — text selection must not start a drag. */
  editing: boolean
  children: React.ReactNode
}) {
  const dragDisabled = readOnly || editing
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: uid,
    data: { type: 'task', containerId },
    disabled: dragDisabled,
  })
  const handleProps = dragDisabled ? {} : { ...attributes, ...listeners }
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      {...handleProps}
    >
      {children}
    </div>
  )
}

// ── BoardColumnHeader ─────────────────────────────────────────────────────────

interface BoardColumnHeaderProps {
  name: React.ReactNode
  taskCount: number
  readOnly: boolean
  muted?: boolean
  onDelete?: () => void
  onAdd?: () => void
  isEditing?: boolean
  editValue?: string
  onStartEdit?: () => void
  onEditChange?: (v: string) => void
  onEditCommit?: () => void
  onEditCancel?: () => void
}

function BoardColumnHeader({
  name, taskCount, readOnly, muted = false,
  onDelete, onAdd,
  isEditing = false, editValue = '', onStartEdit, onEditChange, onEditCommit, onEditCancel,
}: BoardColumnHeaderProps) {
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
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 6px', userSelect: 'none', minHeight: 34 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isEditing ? (
        <>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (editValue.trim()) onEditCommit?.() }
              else if (e.key === 'Escape') onEditCancel?.()
            }}
            onBlur={() => { if (editValue.trim()) onEditCommit?.(); else onEditCancel?.() }}
            style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: 'var(--foreground)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', padding: '0 0 2px', fontFamily: 'inherit' }}
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
            style={{
              fontSize: 16, fontWeight: 600, flex: 1, lineHeight: '18px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: muted ? 'var(--muted-foreground)' : 'var(--foreground)',
              cursor: readOnly || !onStartEdit ? 'default' : 'text',
            }}
            onClick={readOnly ? undefined : onStartEdit}
          >
            {name}
          </span>
          {taskCount > 0 && (
            <span style={{ fontSize: 14, color: 'var(--muted-foreground)', marginLeft: 4 }}>
              {taskCount}
            </span>
          )}
          {!readOnly && (onAdd || onDelete) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, opacity: hovered ? 1 : 0, transition: 'opacity 120ms', pointerEvents: hovered ? 'auto' : 'none' }}>
              {onAdd && iconBtn(onAdd, 'Add task to section', <Plus style={{ width: 13, height: 13 }} />)}
              {onDelete && iconBtn(onDelete, 'Delete section', <Trash2 style={{ width: 13, height: 13 }} />, true)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── SortableBoardColumn ───────────────────────────────────────────────────────
// A section as a column: the whole column is the sortable block (its
// droppable registration is the drop zone for card drags, including when
// empty), the header is the drag handle for column reordering — the exact
// pattern of the list view's SortableSection, rotated horizontal.

function SortableBoardColumn({ sectionId, readOnly, headerDragDisabled, highlighted, accentColor, header, children }: {
  sectionId: string
  readOnly: boolean
  /** Drag listeners come off the header while its name is being edited — text selection in the input must not start a drag. */
  headerDragDisabled: boolean
  highlighted: boolean
  accentColor: string
  header: React.ReactNode
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionId,
    data: { type: 'section', containerId: sectionId },
    disabled: readOnly,
  })
  const handleProps = readOnly || headerDragDisabled ? {} : { ...attributes, ...listeners }
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 10 : undefined,
        width: COLUMN_WIDTH,
        flexShrink: 0,
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--hover-bg)',
        borderRadius: 10,
        boxShadow: highlighted ? `0 0 0 2px ${accentColor}` : undefined,
      }}
    >
      <div {...handleProps} style={{ cursor: readOnly ? undefined : 'grab' }}>{header}</div>
      {children}
    </div>
  )
}

// ── UngroupedColumn ───────────────────────────────────────────────────────────
// Pinned first, not draggable. Registered as type 'container' (not
// 'section') so column drags never target it via the collision filter,
// while card drags can still drop into it — including when empty.

function UngroupedColumn({ highlighted, accentColor, header, children }: {
  highlighted: boolean
  accentColor: string
  header: React.ReactNode
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({
    id: 'ungrouped',
    data: { type: 'container', containerId: 'ungrouped' },
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        width: COLUMN_WIDTH,
        flexShrink: 0,
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--hover-bg)',
        borderRadius: 10,
        boxShadow: highlighted ? `0 0 0 2px ${accentColor}` : undefined,
        transition: 'box-shadow 120ms',
      }}
    >
      {header}
      {children}
    </div>
  )
}

// ── KanbanBoard ───────────────────────────────────────────────────────────────

export function KanbanBoard({ core, accentColor }: KanbanBoardProps) {
  const {
    collection, readOnly, collections, sections,
    ungroupedTasks, sectionedTasks, completed, activeDragTodo,
  } = core

  // Visible card order for shift-click ranges: columns left-to-right, completed last.
  const orderedTodos = useMemo(
    () => [
      ...ungroupedTasks,
      ...sections.flatMap(s => sectionedTasks[s.id] ?? []),
      ...completed,
    ],
    [ungroupedTasks, sections, sectionedTasks, completed],
  )
  const selection = useTaskSelection(collection, orderedTodos)
  const { rowProps, panelOpenUid, closePanel, handleContainerBlur } = useRowEditing(core, accentColor, selection)

  // ── View-local state ──────────────────────────────────────────────────────

  const [showInlineNew, setShowInlineNew] = useState<string | null>(null) // 'ungrouped' | sectionId | null
  const [inlineNewValue, setInlineNewValue] = useState('')
  const inlineNewRef = useRef<HTMLTextAreaElement>(null)

  const [showCompleted, setShowCompleted] = useState(false)

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [sectionNameInput, setSectionNameInput] = useState('')
  const [showNewSection, setShowNewSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')

  // Cross-column drops commit on release (same as the list view); highlight
  // the hovered column meanwhile so the target is unambiguous.
  const [hoverColumnId, setHoverColumnId] = useState<string | null>(null)
  useDndMonitor({
    onDragOver({ active, over }) {
      if (active.data.current?.type !== 'task') return
      const od = over?.data.current
      setHoverColumnId(
        od?.type === 'task' || od?.type === 'section' || od?.type === 'container'
          ? (od.containerId as string)
          : null,
      )
    },
    onDragEnd() { setHoverColumnId(null) },
    onDragCancel() { setHoverColumnId(null) },
  })

  // ── Inline-add handlers ───────────────────────────────────────────────────

  const commitInlineNew = () => {
    const trimmed = inlineNewValue.trim()
    if (!trimmed) { setShowInlineNew(null); setInlineNewValue(''); return }
    const sectionId = (!showInlineNew || showInlineNew === 'ungrouped') ? undefined : showInlineNew
    core.createInlineTodo(trimmed, sectionId)
    setInlineNewValue('')
    // Keep input open for multi-add; Escape or blur-with-empty closes it
  }

  const handleInlineNewKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitInlineNew() }
    else if (e.key === 'Escape') { setShowInlineNew(null); setInlineNewValue('') }
  }

  const handleInlineNewBlur = () => {
    if (!inlineNewValue.trim()) { setShowInlineNew(null); setInlineNewValue('') }
    else commitInlineNew()
  }

  // ── Card rendering ────────────────────────────────────────────────────────

  const renderCard = (todo: Todo, containerId: string) => {
    const rp = rowProps(todo)
    const card = (
      <div style={cardChromeStyle}>
        <TodoRow {...rp} />
        {panelOpenUid === todo.uid && (
          <TodoEditPanel
            todo={todo}
            collection={collection}
            accentColor={accentColor}
            readOnly={readOnly}
            onClose={closePanel}
          />
        )}
      </div>
    )
    return (
      <div key={todo.uid} tabIndex={-1} style={{ outline: 'none' }} onBlur={handleContainerBlur}>
        <SortableBoardCard containerId={containerId} uid={todo.uid} readOnly={readOnly} editing={rp.isEditingTitle}>
          {readOnly ? card : (
            <TaskContextMenu
              collections={collections}
              currentCollection={collection}
              targetCount={selection.targetsFor(todo).length}
              onMove={(to) => {
                core.moveToCollection(selection.targetsFor(todo), to)
                if (selection.isSelected(todo.uid)) selection.clear()
              }}
              onSetDue={(due) => core.setDue(selection.targetsFor(todo), due)}
            >
              {card}
            </TaskContextMenu>
          )}
        </SortableBoardCard>
      </div>
    )
  }

  const columnBody = (containerId: string, tasks: Todo[]) => (
    <div style={{ overflowY: 'auto', minHeight: 40, padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SortableContext items={tasks.map(t => t.uid)} strategy={verticalListSortingStrategy}>
        {tasks.map(t => renderCard(t, containerId))}
      </SortableContext>
      {showInlineNew === containerId && (
        <div style={cardChromeStyle}>
          <InlineNewRow
            value={inlineNewValue}
            accentColor={accentColor}
            inputRef={inlineNewRef}
            onChange={setInlineNewValue}
            onKeyDown={handleInlineNewKey}
            onBlur={handleInlineNewBlur}
          />
        </div>
      )}
      {!readOnly && showInlineNew !== containerId && (
        <button
          onClick={() => { setShowInlineNew(containerId); setInlineNewValue('') }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: 'var(--muted-foreground)', fontSize: 15, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.55, transition: 'opacity 150ms', borderRadius: 6 }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
        >
          <Plus style={{ width: 12, height: 12 }} />
          Add task
        </button>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Column strip */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start', gap: 12, overflowX: 'auto', overflowY: 'hidden', padding: '10px 12px 14px' }}>

        {/* No-section column (pinned, not draggable) */}
        <UngroupedColumn
          highlighted={hoverColumnId === 'ungrouped'}
          accentColor={accentColor}
          header={
            <BoardColumnHeader
              name="No section"
              taskCount={ungroupedTasks.length}
              readOnly={readOnly}
              muted
              onAdd={readOnly ? undefined : () => { setShowInlineNew('ungrouped'); setInlineNewValue('') }}
            />
          }
        >
          {columnBody('ungrouped', ungroupedTasks)}
        </UngroupedColumn>

        {/* Section columns */}
        <SortableContext items={sections.map(s => s.id)} strategy={horizontalListSortingStrategy}>
          {sections.map((section: Section) => (
            <SortableBoardColumn
              key={section.id}
              sectionId={section.id}
              readOnly={readOnly}
              headerDragDisabled={editingSectionId === section.id}
              highlighted={hoverColumnId === section.id}
              accentColor={accentColor}
              header={
                <BoardColumnHeader
                  name={section.name}
                  taskCount={(sectionedTasks[section.id] ?? []).length}
                  readOnly={readOnly}
                  onAdd={() => { setShowInlineNew(section.id); setInlineNewValue('') }}
                  onDelete={() => core.deleteSection(section.id)}
                  isEditing={editingSectionId === section.id}
                  editValue={sectionNameInput}
                  onStartEdit={() => { setEditingSectionId(section.id); setSectionNameInput(section.name) }}
                  onEditChange={setSectionNameInput}
                  onEditCommit={() => { core.renameSection(section.id, sectionNameInput); setEditingSectionId(null) }}
                  onEditCancel={() => setEditingSectionId(null)}
                />
              }
            >
              {columnBody(section.id, sectionedTasks[section.id] ?? [])}
            </SortableBoardColumn>
          ))}
        </SortableContext>

        {/* Add-section stub column */}
        {!readOnly && (
          <div style={{ width: COLUMN_WIDTH, flexShrink: 0, padding: '4px 2px' }}>
            {showNewSection ? (
              <input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (newSectionName.trim()) {
                      core.addSection(newSectionName)
                      setNewSectionName('')
                      setShowNewSection(false)
                    }
                  } else if (e.key === 'Escape') {
                    setShowNewSection(false)
                    setNewSectionName('')
                  }
                }}
                onBlur={() => {
                  if (newSectionName.trim()) core.addSection(newSectionName)
                  setNewSectionName('')
                  setShowNewSection(false)
                }}
                placeholder="Section name…"
                style={{ width: '100%', fontSize: 16, fontWeight: 600, color: 'var(--foreground)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', padding: '4px 0 2px', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            ) : (
              <button
                onClick={() => { setShowNewSection(true); setNewSectionName('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', color: 'var(--muted-foreground)', fontSize: 16, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5, transition: 'opacity 150ms' }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
              >
                <Plus style={{ width: 12, height: 12 }} />
                Add section
              </button>
            )}
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDragTodo ? (
          <div style={{ ...cardChromeStyle, width: COLUMN_WIDTH - 16 }}>
            <TodoRow {...rowProps(activeDragTodo)} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Completed group (global, not sectioned) */}
      {completed.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0 12px', maxHeight: '40%', overflowY: 'auto', flexShrink: 0 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0 8px' }}>
              {completed.map(t => (
                <div key={t.uid} tabIndex={-1} style={{ outline: 'none' }} onBlur={handleContainerBlur}>
                  {readOnly ? (
                    <TodoRow {...rowProps(t)} />
                  ) : (
                    <TaskContextMenu
                      collections={collections}
                      currentCollection={collection}
                      targetCount={selection.targetsFor(t).length}
                      onMove={(to) => {
                        core.moveToCollection(selection.targetsFor(t), to)
                        if (selection.isSelected(t.uid)) selection.clear()
                      }}
                      onSetDue={(due) => core.setDue(selection.targetsFor(t), due)}
                    >
                      <TodoRow {...rowProps(t)} />
                    </TaskContextMenu>
                  )}
                  {panelOpenUid === t.uid && (
                    <TodoEditPanel
                      todo={t}
                      collection={collection}
                      accentColor={accentColor}
                      readOnly={readOnly}
                      onClose={closePanel}
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
