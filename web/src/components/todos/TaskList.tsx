/**
 * TaskList — the vertical list presentation of a collection's tasks:
 * sections as stacked groups, DnD, inline-add, and completed group.
 * Pure render layer over the shared TaskListCore (see useTaskListCore).
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Plus, Trash2, Check, X } from 'lucide-react'
import { DragOverlay } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TodoEditPanel } from '@/components/TodoEditPanel'
import { TodoRow, SortableTodoRow, InlineNewRow } from './rows'
import { TaskContextMenu } from './TaskContextMenu'
import { useRowEditing } from './useRowEditing'
import { useTaskSelection } from './useTaskSelection'
import type { TaskListCore } from './useTaskListCore'
import type { Todo, Section } from '@/types'

export interface TaskListProps {
  core: TaskListCore
  accentColor: string
}

// ── SortableSection ───────────────────────────────────────────────────────────
// Wraps an entire section (header + tasks) as a single sortable block: the
// header acts as the drag handle for reordering whole sections, and the
// block's droppable registration doubles as the drop zone for task drags
// (so the overlay doesn't snap back when the pointer crosses the header,
// and empty sections stay valid targets).

interface SortableSectionProps {
  sectionId: string
  readOnly: boolean
  /** Drag listeners come off the header while its name is being edited — text selection in the input must not start a drag. */
  headerDragDisabled: boolean
  header: React.ReactNode
  children: React.ReactNode
}

function SortableSection({ sectionId, readOnly, headerDragDisabled, header, children }: SortableSectionProps) {
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
        position: 'relative',
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <div {...handleProps} style={{ cursor: readOnly ? undefined : 'grab' }}>{header}</div>
      {children}
    </div>
  )
}

// ── SectionBucket ─────────────────────────────────────────────────────────────

interface SectionBucketProps {
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
  readOnly: boolean
  isFirst: boolean
  isLast: boolean
  /** False for the very first thing in the list — no rule against empty space above. */
  showRule: boolean
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
  section, taskCount, readOnly, isFirst, isLast, showRule,
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
        padding: showRule ? '18px 10px 4px' : '8px 10px 4px',
        borderTop: showRule ? '1px solid var(--border)' : 'none',
        marginTop: showRule ? 6 : 0,
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
            style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', cursor: readOnly ? 'default' : 'text', flex: 1, lineHeight: '18px' }}
            onClick={readOnly ? undefined : onStartEdit}
          >
            {section.name}
          </span>
          {taskCount > 0 && (
            <span style={{ fontSize: 14, color: 'var(--muted-foreground)', marginLeft: 4 }}>
              {taskCount}
            </span>
          )}
          {!readOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, opacity: hovered ? 1 : 0, transition: 'opacity 120ms', pointerEvents: hovered ? 'auto' : 'none' }}>
              {!isFirst && iconBtn(onMoveUp, 'Move section up', <ChevronUp style={{ width: 13, height: 13 }} />)}
              {!isLast && iconBtn(onMoveDown, 'Move section down', <ChevronDown style={{ width: 13, height: 13 }} />)}
              {iconBtn(onAdd, 'Add task to section', <Plus style={{ width: 13, height: 13 }} />)}
              {iconBtn(onDelete, 'Delete section', <Trash2 style={{ width: 13, height: 13 }} />, true)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── TaskList ──────────────────────────────────────────────────────────────────

export function TaskList({ core, accentColor }: TaskListProps) {
  const {
    collection, readOnly, collections, sections,
    ungroupedTasks, sectionedTasks, completed, activeDragTodo,
  } = core

  // Visible row order for shift-click ranges: ungrouped, sections top-to-bottom, completed.
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

  // ── Inline-add state ──────────────────────────────────────────────────────
  // containerId is 'ungrouped' or a section id; afterUid pins the input row
  // directly below a specific task (Enter-on-selected flow).

  const [showInlineNew, setShowInlineNew] = useState<{ containerId: string; afterUid?: string } | null>(null)
  const [inlineNewValue, setInlineNewValue] = useState('')
  const inlineNewRef = useRef<HTMLInputElement>(null)

  // ── Completed ─────────────────────────────────────────────────────────────

  const [showCompleted, setShowCompleted] = useState(false)

  // ── Section editing ───────────────────────────────────────────────────────

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [sectionNameInput, setSectionNameInput] = useState('')
  const [showNewSection, setShowNewSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')

  // ── Inline-add handlers ───────────────────────────────────────────────────

  const commitInlineNew = () => {
    const trimmed = inlineNewValue.trim()
    if (!trimmed) { setShowInlineNew(null); setInlineNewValue(''); return }
    const sectionId = (!showInlineNew || showInlineNew.containerId === 'ungrouped') ? undefined : showInlineNew.containerId
    const newUid = core.createInlineTodo(trimmed, sectionId, showInlineNew?.afterUid)
    // Chain below-insertions: the next commit lands under the task just created.
    if (showInlineNew?.afterUid) setShowInlineNew({ ...showInlineNew, afterUid: newUid })
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
    if (selection.hasSelection) { selection.clear(); return }
    if (readOnly) return
    if (showInlineNew?.containerId === 'ungrouped' && !showInlineNew.afterUid) inlineNewRef.current?.focus()
    else { setShowInlineNew({ containerId: 'ungrouped' }); setInlineNewValue('') }
  }

  // Enter with exactly one task selected opens a new-task input directly
  // beneath it, just like the ordinary inline-add flow.
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (selection.selectedTodos.length !== 1) return
      const sel = selection.selectedTodos[0]
      if (sel.status === 'COMPLETED' || sel.status === 'CANCELLED') return
      e.preventDefault()
      setShowInlineNew({ containerId: core.bucketOf(sel), afterUid: sel.uid })
      setInlineNewValue('')
      selection.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, selection, core])

  // ── Row helpers ───────────────────────────────────────────────────────────

  const renderTodoRow = (todo: Todo, containerId: string) => (
    <div
      key={todo.uid}
      tabIndex={-1}
      style={{ outline: 'none' }}
      onBlur={handleContainerBlur}
    >
      {readOnly ? (
        // The only context-menu entry ("Move to") mutates — skip the menu entirely.
        <SortableTodoRow {...rowProps(todo)} containerId={containerId} />
      ) : (
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
          <SortableTodoRow {...rowProps(todo)} containerId={containerId} />
        </TaskContextMenu>
      )}
      {panelOpenUid === todo.uid && (
        <TodoEditPanel
          todo={todo}
          collection={collection}
          accentColor={accentColor}
          readOnly={readOnly}
          onClose={closePanel}
        />
      )}
      {showInlineNew?.afterUid === todo.uid && (
        <InlineNewRow
          value={inlineNewValue}
          accentColor={accentColor}
          inputRef={inlineNewRef}
          onChange={setInlineNewValue}
          onKeyDown={handleInlineNewKey}
          onBlur={handleInlineNewBlur}
        />
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

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
            tasks={ungroupedTasks}
            renderRow={(t) => renderTodoRow(t, 'ungrouped')}
          />
          {showInlineNew?.containerId === 'ungrouped' && !showInlineNew.afterUid && (
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
          <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((section, idx) => (
              <SortableSection
                key={section.id}
                sectionId={section.id}
                readOnly={readOnly}
                headerDragDisabled={editingSectionId === section.id}
                header={
                  <SectionHeader
                    section={section}
                    taskCount={(sectionedTasks[section.id] ?? []).length}
                    readOnly={readOnly}
                    isFirst={idx === 0}
                    isLast={idx === sections.length - 1}
                    showRule={idx > 0 || ungroupedTasks.length > 0 || showInlineNew?.containerId === 'ungrouped'}
                    onMoveUp={() => core.moveSectionUp(section.id)}
                    onMoveDown={() => core.moveSectionDown(section.id)}
                    onDelete={() => core.deleteSection(section.id)}
                    onAdd={() => { setShowInlineNew({ containerId: section.id }); setInlineNewValue('') }}
                    isEditing={editingSectionId === section.id}
                    editValue={sectionNameInput}
                    onStartEdit={() => { setEditingSectionId(section.id); setSectionNameInput(section.name) }}
                    onEditChange={setSectionNameInput}
                    onEditCommit={() => { core.renameSection(section.id, sectionNameInput); setEditingSectionId(null) }}
                    onEditCancel={() => setEditingSectionId(null)}
                  />
                }
              >
                <SectionBucket
                  tasks={sectionedTasks[section.id] ?? []}
                  renderRow={(t) => renderTodoRow(t, section.id)}
                />
                {showInlineNew?.containerId === section.id && !showInlineNew.afterUid && (
                  <InlineNewRow
                    value={inlineNewValue}
                    accentColor={accentColor}
                    inputRef={inlineNewRef}
                    onChange={setInlineNewValue}
                    onKeyDown={handleInlineNewKey}
                    onBlur={handleInlineNewBlur}
                  />
                )}
              </SortableSection>
            ))}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeDragTodo ? <TodoRow {...rowProps(activeDragTodo)} /> : null}
          </DragOverlay>

        </>

        {/* Add section */}
        {!readOnly && (
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
        )}
      </div>

      {/* Blank click-to-add area (clicks open ungrouped inline-add) */}
      <div style={{ flex: 1, minHeight: 60, cursor: readOnly ? 'default' : 'text' }} onClick={handleBlankAreaClick} />

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
                  onBlur={handleContainerBlur}
                >
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
