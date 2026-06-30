import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Crosshair, User, Moon, Sun } from 'lucide-react'
import type { Collection } from '@/types'
import { useCollectionStore } from '@/state/collection'
import { collectionColor } from '@/lib/colors'

interface Props {
  collections: Collection[]
}

export function CollectionSidebar({ collections }: Props) {
  const {
    activeCollection, viewMode, hiddenCollections, focusedCollection, theme,
    setCollection, toggleCollectionHidden, setFocusedCollection, toggleTheme,
  } = useCollectionStore()
  const navigate = useNavigate()
  const location = useLocation()
  const names = collections.map((c) => c.name)

  const isCalendarMode = viewMode === 'calendar' || location.pathname.startsWith('/calendar')
  const visible = collections.filter((c) => c.name !== 'capture')

  const handleRowClick = (col: Collection) => {
    setCollection(col.name)
    navigate(`/${col.name}/todos`)
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
      {/* Section label */}
      <div style={{ padding: '20px 12px 8px' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ui-text-muted)',
            paddingLeft: 10,
          }}
        >
          Projects
        </span>
      </div>

      {/* Collection list */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: '0 8px' }}>
        <div className="flex flex-col" style={{ gap: 1 }}>
          {visible.map((col) => {
            const color = collectionColor(names, col.name)
            const isActive = activeCollection === col.name
            const isHidden = hiddenCollections.includes(col.name)
            const isFocused = focusedCollection === col.name

            return (
              <div
                key={col.name}
                className="sidebar-row"
                data-active={isActive}
                onClick={() => handleRowClick(col)}
                style={{ opacity: isCalendarMode && isHidden && !isFocused ? 0.4 : 1 }}
              >
                {/* Color dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: color.bg,
                    flexShrink: 0,
                    boxShadow: isFocused ? `0 0 0 2px ${color.bg}44` : 'none',
                    transition: 'box-shadow 150ms',
                  }}
                />

                {/* Name */}
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
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

                {/* Calendar-mode controls (show on hover via CSS) */}
                {isCalendarMode && (
                  <div
                    className="sidebar-row-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="sidebar-row-icon-btn"
                      data-active={isFocused}
                      title={isFocused ? 'Unfocus' : 'Focus only this'}
                      onClick={() => setFocusedCollection(col.name)}
                    >
                      <Crosshair style={{ width: 12, height: 12 }} />
                    </button>
                    <button
                      className="sidebar-row-icon-btn"
                      data-active={isHidden}
                      title={isHidden ? 'Show in calendar' : 'Hide from calendar'}
                      onClick={() => toggleCollectionHidden(col.name)}
                    >
                      {isHidden
                        ? <EyeOff style={{ width: 12, height: 12 }} />
                        : <Eye style={{ width: 12, height: 12 }} />}
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {visible.length === 0 && (
            <p style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ui-text-muted)' }}>
              No projects yet.
            </p>
          )}
        </div>
      </nav>

      {/* Profile / settings footer */}
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
            fontSize: 12,
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
