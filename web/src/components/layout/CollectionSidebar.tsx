import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Crosshair, User, Moon, Sun, Inbox, CalendarDays, ListTodo } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import type { Collection, ViewMode } from '@/types'
import { useCollectionStore } from '@/state/collection'
import { collectionColor } from '@/lib/colors'

interface Props {
  collections: Collection[]
}

type NavItem = {
  mode: ViewMode
  icon: React.FC<{ style?: React.CSSProperties; strokeWidth?: number }>
  label: string
  path: string
  color: string
}

const NAV_ITEMS: NavItem[] = [
  { mode: 'inbox',    icon: Inbox,        label: 'Inbox',    path: '/inbox',    color: '#3B82F6' },
  { mode: 'today',    icon: Sun,          label: 'Today',    path: '/today',    color: '#F59E0B' },
  { mode: 'tasks',    icon: ListTodo,     label: 'Tasks',    path: '/tasks',    color: '#10B981' },
  { mode: 'calendar', icon: CalendarDays, label: 'Calendar', path: '/calendar', color: '#6366F1' },
]

interface CollectionRowProps {
  col: Collection
  dotColor: string
  isActive: boolean
  isHidden: boolean
  isFocused: boolean
  isCalendarMode: boolean
  onRowClick: () => void
  onFocus: () => void
  onToggleHidden: () => void
}

function CollectionRow({
  col, dotColor, isActive, isHidden, isFocused, isCalendarMode, onRowClick, onFocus, onToggleHidden,
}: CollectionRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `collection:${col.name}`,
    data: { type: 'collection', name: col.name },
  })

  return (
    <div
      ref={setNodeRef}
      className="sidebar-row"
      data-active={isActive}
      onClick={onRowClick}
      style={{
        opacity: isCalendarMode && isHidden && !isFocused ? 0.4 : 1,
        outline: isOver ? '2px solid var(--sidebar-primary)' : 'none',
        outlineOffset: -2,
        background: isOver ? 'var(--sidebar-accent)' : undefined,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          boxShadow: isFocused ? `0 0 0 2px ${dotColor}44` : 'none',
          transition: 'box-shadow 150ms',
        }}
      />

      <span
        style={{
          fontSize: 17,
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isActive ? 'var(--sidebar-primary)' : 'inherit',
        }}
      >
        {col.display_name}
      </span>

      {isCalendarMode && (
        <div
          className="sidebar-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="sidebar-row-icon-btn"
            data-active={isFocused}
            title={isFocused ? 'Unfocus' : 'Focus only this'}
            onClick={onFocus}
          >
            <Crosshair style={{ width: 12, height: 12 }} />
          </button>
          <button
            className="sidebar-row-icon-btn"
            data-active={isHidden}
            title={isHidden ? 'Show in calendar' : 'Hide from calendar'}
            onClick={onToggleHidden}
          >
            {isHidden
              ? <EyeOff style={{ width: 12, height: 12 }} />
              : <Eye style={{ width: 12, height: 12 }} />}
          </button>
        </div>
      )}
    </div>
  )
}

export function CollectionSidebar({ collections }: Props) {
  const {
    activeCollection, viewMode, hiddenCollections, focusedCollection, theme,
    setCollection, setViewMode, toggleCollectionHidden, setFocusedCollection, toggleTheme,
  } = useCollectionStore()
  const navigate = useNavigate()
  const location = useLocation()
  const names = collections.map((c) => c.name)

  const isCalendarMode = viewMode === 'calendar' || location.pathname.startsWith('/calendar')
  const visible = collections.filter((c) => c.name !== 'capture')

  const activeMode = NAV_ITEMS.find((item) =>
    location.pathname.startsWith(item.path)
  )?.mode ?? null

  const goNav = (item: NavItem) => {
    setViewMode(item.mode)
    void navigate(item.path)
  }

  const handleRowClick = (col: Collection) => {
    setCollection(col.name)
    void navigate(`/${col.name}`)
  }

  // Build grouped structure: ungrouped first, then each group alphabetically
  const ungrouped = visible.filter((c) => !c.group)
  const groupMap = new Map<string, Collection[]>()
  for (const col of visible.filter((c) => c.group)) {
    const g = col.group!
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g)!.push(col)
  }
  const sortedGroups = [...groupMap.keys()].sort()

  const renderRow = (col: Collection) => {
    const color = collectionColor(names, col.name)
    return (
      <CollectionRow
        key={col.name}
        col={col}
        dotColor={col.color ?? color.bg}
        isActive={activeCollection === col.name}
        isHidden={hiddenCollections.includes(col.name)}
        isFocused={focusedCollection === col.name}
        isCalendarMode={isCalendarMode}
        onRowClick={() => handleRowClick(col)}
        onFocus={() => setFocusedCollection(col.name)}
        onToggleHidden={() => toggleCollectionHidden(col.name)}
      />
    )
  }

  return (
    <aside
      className="flex flex-col h-full select-none"
      style={{
        width: 'var(--app-sidebar-width)',
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--sidebar-border)',
        flexShrink: 0,
      }}
    >
      {/* Top-level nav items */}
      <nav style={{ padding: '12px 8px 8px' }}>
        <div className="flex flex-col" style={{ gap: 1 }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activeMode === item.mode
            return (
              <div
                key={item.mode}
                className="sidebar-row"
                data-active={isActive}
                onClick={() => goNav(item)}
              >
                <Icon
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    color: isActive ? item.color : 'var(--sidebar-foreground)',
                  }}
                  strokeWidth={isActive ? 2.3 : 2}
                />
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 500,
                    color: isActive ? 'var(--sidebar-primary)' : 'inherit',
                  }}
                >
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
      </nav>

      {/* Divider */}
      <div style={{ margin: '4px 12px', borderTop: '1px solid var(--sidebar-border)' }} />

      {/* Collection list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 8px 0' }}>
        <div className="flex flex-col" style={{ gap: 1 }}>
          {ungrouped.map(renderRow)}

          {sortedGroups.map((groupName) => (
            <div key={groupName}>
              <div style={{ padding: '10px 10px 4px' }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                }}>
                  {groupName}
                </span>
              </div>
              {groupMap.get(groupName)!.map(renderRow)}
            </div>
          ))}

          {visible.length === 0 && (
            <p style={{ padding: '8px 10px', fontSize: 16, color: 'var(--ui-text-muted)' }}>
              No projects yet.
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: '1px solid var(--sidebar-border)',
          padding: '10px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--sidebar-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <User style={{ width: 14, height: 14, color: 'var(--sidebar-foreground)' }} />
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--sidebar-foreground)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Account
        </span>
        <button
          onClick={toggleTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--ui-text-muted)',
            cursor: 'pointer',
            transition: 'color 100ms, background 100ms',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.color = 'var(--sidebar-primary)'
            ;(e.currentTarget as HTMLElement).style.background = 'var(--sidebar-accent)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.color = 'var(--ui-text-muted)'
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark'
            ? <Sun style={{ width: 14, height: 14 }} />
            : <Moon style={{ width: 14, height: 14 }} />}
        </button>
      </div>
    </aside>
  )
}
