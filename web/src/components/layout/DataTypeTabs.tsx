import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCollectionStore } from '@/state/collection'
import { collectionColor } from '@/lib/colors'
import { listCollections } from '@/api/collections'
import type { DataType } from '@/types'
import { cn } from '@/lib/utils'
import {
  CalendarDays,
  CheckSquare,
} from 'lucide-react'

const TABS: { id: DataType; label: string; icon: React.FC<{ className?: string; strokeWidth?: number }> }[] = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'todos',    label: 'To-dos',   icon: CheckSquare },
]

export function DataTypeTabs() {
  const { activeCollection, activeDataType, setDataType } = useCollectionStore()
  const navigate = useNavigate()
  const { data: collections = [] } = useQuery({ queryKey: ['collections'], queryFn: listCollections })
  const names = collections.map(c => c.name)
  const color = activeCollection ? collectionColor(names, activeCollection) : null

  const select = (dt: DataType) => {
    setDataType(dt)
    if (activeCollection) {
      navigate(`/${activeCollection}/${dt}`)
    }
  }

  return (
    <header
      className="flex items-stretch w-full"
      style={{
        height: 'var(--app-nav-height)',
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        flexShrink: 0,
      }}
    >
      {activeCollection && (
        <div
          className="flex items-center px-5 mr-2 flex-shrink-0"
          style={{ borderRight: '1px solid #e5e7eb' }}
        >
          {color && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full mr-2.5 flex-shrink-0"
              style={{ background: color.bg }}
            />
          )}
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[120px]">
            {activeCollection}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-stretch flex-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeDataType === id
          const isDisabled = !activeCollection
          return (
            <button
              key={id}
              onClick={() => !isDisabled && select(id)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 px-6 min-w-[80px] flex-1 transition-colors duration-100 group',
                isActive ? 'text-gray-900' : isDisabled ? 'text-gray-200 cursor-default' : 'text-gray-400 hover:text-gray-700'
              )}
              style={{ background: 'transparent' }}
            >
              <Icon
                className={cn('w-[18px] h-[18px] transition-colors duration-100')}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span className="text-[11px] font-medium leading-none tracking-tight">
                {label}
              </span>
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-3 right-3 h-[2.5px] rounded-t-full"
                  style={{ background: color?.bg ?? '#374151' }}
                />
              )}
            </button>
          )
        })}
      </div>
    </header>
  )
}
