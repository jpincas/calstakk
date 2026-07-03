import { useNavigate, useParams } from 'react-router-dom'
import { Tag } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { useGlobalTodos, useGlobalToggle, type GlobalTodo } from '@/components/todos/useGlobalTodos'
import { usePendingCompletion } from '@/components/todos/usePendingCompletion'
import { GlobalTodoRow } from '@/components/todos/GlobalTodoRow'

/**
 * Tag view — the logical list of every active task carrying a given tag
 * (iCal CATEGORIES), across all collections.
 */
export function TagPage() {
  const { tag = '' } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const { all, waiting, isLoading } = useGlobalTodos()
  const toggle = useGlobalToggle()
  const pendingCompletion = usePendingCompletion()
  const key = (t: GlobalTodo) => `${t._colRef}/${t.uid}`

  // Just-completed tasks stay for their fade-out grace period.
  const matches = all.filter((t) => {
    if (!(t.categories ?? []).includes(tag)) return false
    const isActive = t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
    return isActive || pendingCompletion.has(key(t))
  })
  const blockerOf = new Map(waiting.map(({ todo, blocker }) => [key(todo), blocker]))

  const handleToggle = (t: GlobalTodo) => {
    toggle.mutate(t)
    if (t.status !== 'COMPLETED') pendingCompletion.add(key(t))
    else pendingCompletion.remove(key(t))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}>
      <PageBar
        icon={<Tag size={14} color="#EC4899" strokeWidth={2.2} />}
        title={tag}
        detail={matches.length > 0 ? `${matches.length} task${matches.length !== 1 ? 's' : ''}` : undefined}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}>
        {matches.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 48 }}>
            <Tag style={{ width: 20, height: 20, color: 'var(--ui-text-muted)' }} />
            <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', margin: 0 }}>
              {isLoading ? 'Loading…' : `No active tasks tagged “${tag}”.`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {matches.map((todo) => (
              <GlobalTodoRow
                key={key(todo)}
                todo={todo}
                waitingOn={blockerOf.get(key(todo))?.summary}
                fadingOut={pendingCompletion.has(key(todo))}
                onToggle={handleToggle}
                onOpenCollection={(ref) => { void navigate(`/${ref}`) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
