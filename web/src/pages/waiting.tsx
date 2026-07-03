import { useNavigate } from 'react-router-dom'
import { Hourglass } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { useGlobalTodos, useGlobalToggle } from '@/components/todos/useGlobalTodos'
import { GlobalTodoRow } from '@/components/todos/GlobalTodoRow'

/**
 * Waiting — every task across all collections that is blocked on another
 * task (depends_on → RELATED-TO;RELTYPE=DEPENDS-ON). Rows are greyed and
 * non-tickable; they become active the moment their blocker completes and
 * drop off this view.
 */
export function WaitingPage() {
  const navigate = useNavigate()
  const { waiting, isLoading } = useGlobalTodos()
  const toggle = useGlobalToggle()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--background)' }}>
      <PageBar
        icon={<Hourglass size={14} color="#8B5CF6" strokeWidth={2.2} />}
        title="Waiting"
        detail={waiting.length > 0 ? `${waiting.length} task${waiting.length !== 1 ? 's' : ''} blocked` : undefined}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}>
        {waiting.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 48 }}>
            <Hourglass style={{ width: 20, height: 20, color: 'var(--ui-text-muted)' }} />
            <p style={{ fontSize: 16, color: 'var(--ui-text-muted)', margin: 0 }}>
              {isLoading ? 'Loading…' : 'Nothing is waiting on another task.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {waiting.map(({ todo, blocker }) => (
              <GlobalTodoRow
                key={`${todo._colRef}-${todo.uid}`}
                todo={todo}
                waitingOn={blocker.summary}
                onToggle={(t) => toggle.mutate(t)}
                onOpenCollection={(ref) => { void navigate(`/${ref}`) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
