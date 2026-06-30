import { useNavigate, useLocation } from 'react-router-dom'
import { Inbox, Sun, CheckSquare, CalendarDays, Columns2, Search } from 'lucide-react'
import { useCollectionStore } from '@/state/collection'
import type { ViewMode } from '@/types'

type NavItem = {
  mode: ViewMode
  icon: React.FC<{ className?: string; strokeWidth?: number }>
  label: string
  path: string
  color: string
}

const NAV_ITEMS: NavItem[] = [
  { mode: 'inbox',    icon: Inbox,        label: 'Inbox',    path: '/inbox',    color: '#3B82F6' },
  { mode: 'today',    icon: Sun,          label: 'Today',    path: '/today',    color: '#F59E0B' },
  { mode: 'todos',    icon: CheckSquare,  label: 'Todos',    path: '/todos',    color: '#10B981' },
  { mode: 'calendar', icon: CalendarDays, label: 'Calendar', path: '/calendar', color: '#6366F1' },
  { mode: 'split',    icon: Columns2,     label: 'Split',    path: '/split',    color: '#8B5CF6' },
]

export function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeCollection, setViewMode } = useCollectionStore()

  const activeMode = NAV_ITEMS.find((item) => {
    if (item.mode === 'todos') {
      return location.pathname.includes('/todos') && !location.pathname.startsWith('/inbox')
    }
    return location.pathname.startsWith(item.path)
  })?.mode ?? null

  const go = (item: NavItem) => {
    setViewMode(item.mode)
    if (item.mode === 'todos') {
      navigate(activeCollection ? `/${activeCollection}/todos` : '/today')
    } else {
      navigate(item.path)
    }
  }

  return (
    <header
      className="flex items-center flex-shrink-0"
      style={{
        height: 'var(--app-nav-height)',
        background: 'var(--nav)',
        borderBottom: '1px solid var(--nav-border)',
        paddingLeft: 8,
        paddingRight: 12,
        gap: 2,
      }}
    >
      {/* Nav items */}
      <nav className="flex items-center" style={{ gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeMode === item.mode
          return (
            <button
              key={item.mode}
              onClick={() => go(item)}
              className="nav-btn"
              style={{ '--btn-color': item.color } as React.CSSProperties}
              data-active={isActive}
            >
              <Icon className="w-[14px] h-[14px]" strokeWidth={isActive ? 2.3 : 1.8} />
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.01em', lineHeight: 1 }}>
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <button
        className="flex items-center gap-2 rounded-lg"
        style={{
          padding: '5px 10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.07)',
          cursor: 'pointer',
          minWidth: 160,
        }}
      >
        <Search style={{ width: 13, height: 13, color: '#3A3A46', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: '#3A3A46', flex: 1, textAlign: 'left' }}>Search</span>
        <span
          style={{
            fontSize: 10,
            color: '#3A3A46',
            background: 'rgba(255,255,255,0.05)',
            padding: '1px 5px',
            borderRadius: 4,
            fontFamily: 'monospace',
          }}
        >
          ⌘K
        </span>
      </button>
    </header>
  )
}
