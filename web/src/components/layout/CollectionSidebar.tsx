import { useNavigate } from 'react-router-dom'
import type { Collection } from '@/types'
import { useCollectionStore } from '@/state/collection'
import { collectionColor } from '@/lib/colors'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  collections: Collection[]
}

export function CollectionSidebar({ collections }: Props) {
  const { activeCollection, setCollection } = useCollectionStore()
  const navigate = useNavigate()
  const names = collections.map(c => c.name)

  const select = (name: string) => {
    setCollection(name)
    navigate(`/${name}/calendar`)
  }

  return (
    <aside
      className="flex flex-col h-full select-none"
      style={{ width: 'var(--app-sidebar-width)', background: 'var(--sidebar)', borderRight: '1px solid var(--sidebar-border)', flexShrink: 0 }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: '#2563eb' }}>
          <CalendarDays className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'oklch(0.92 0 0)' }}>
          CalStakk
        </span>
      </div>

      {/* Collections */}
      <div className="px-3 mb-1">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'oklch(0.4 0 0)' }}>
          Collections
        </p>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-0.5 overflow-y-auto">
        {collections.map((col) => {
          const color = collectionColor(names, col.name)
          const isActive = activeCollection === col.name
          return (
            <button
              key={col.name}
              onClick={() => select(col.name)}
              className={cn(
                'group flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-left transition-all duration-100',
                isActive
                  ? 'text-white'
                  : 'hover:text-white'
              )}
              style={{
                background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: isActive ? 'oklch(0.92 0 0)' : 'oklch(0.5 0 0)',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              {/* Color dot */}
              <span
                className="flex-shrink-0 w-2.5 h-2.5 rounded-full transition-transform duration-100"
                style={{
                  background: color.bg,
                  transform: isActive ? 'scale(1.2)' : 'scale(1)',
                  boxShadow: isActive ? `0 0 0 3px ${color.bg}22` : 'none',
                }}
              />
              <span
                className="flex-1 text-sm font-medium truncate"
                style={{ color: isActive ? 'oklch(0.93 0 0)' : 'inherit' }}
              >
                {col.display_name}
              </span>
              {isActive && (
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ background: color.bg }}
                />
              )}
            </button>
          )
        })}

        {collections.length === 0 && (
          <p className="px-2 py-3 text-xs" style={{ color: 'oklch(0.4 0 0)' }}>
            No collections yet.
          </p>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 mt-auto" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <p className="px-2 text-[10px]" style={{ color: 'oklch(0.35 0 0)' }}>
          CalStakk · v2
        </p>
      </div>
    </aside>
  )
}
