import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useLocation } from 'react-router-dom'
import { caldav } from '@/api'
import { collectionColor } from '@/lib/colors'
import { useCollectionStore } from '@/state/collection'
import { Plus, Inbox, Columns3, LayoutList } from 'lucide-react'
import { PageBar } from '@/components/layout/PageBar'
import { TasksView } from '@/components/todos/TasksView'
import { NewTaskDialog } from '@/components/NewTaskDialog'
import type { Collection } from '@/types'

export function TodosPage() {
  const { collection: collectionParam } = useParams<{ collection?: string }>()
  const location = useLocation()
  const collection = collectionParam ?? (location.pathname === '/inbox' ? 'capture' : undefined)

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  const names = collections.map((c: Collection) => c.ref)
  const color = collection
    ? collectionColor(names, collection)
    : { bg: '#6366F1', text: '#fff', light: '#eef2ff', border: '#a5b4fc', muted: '#c7d2fe' }

  // 'capture' (the /inbox route) is always own/writable; guard the param path anyway.
  const readOnly = collections.find((c: Collection) => c.ref === collection)?.myAccess === 'read'

  const { taskView, setTaskView } = useCollectionStore()
  const view = (collection ? taskView[collection] : undefined) ?? 'list'

  const [newTaskOpen, setNewTaskOpen] = useState(false)

  if (!collection) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: 17, color: 'var(--ui-text-muted)' }}>Select a project from the sidebar.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageBar
        icon={<Inbox size={14} color="#3B82F6" strokeWidth={2.2} />}
        title="Inbox"
        controls={
          <>
            <button
              onClick={() => setTaskView(collection, view === 'list' ? 'board' : 'list')}
              title={view === 'list' ? 'Board view' : 'List view'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--muted-foreground)',
                cursor: 'pointer',
              }}
            >
              {view === 'list'
                ? <Columns3 style={{ width: 18, height: 18 }} />
                : <LayoutList style={{ width: 18, height: 18 }} />}
            </button>
            {!readOnly && (
              <button
                onClick={() => setNewTaskOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
              >
                <Plus style={{ width: 13, height: 13 }} />
                New task
              </button>
            )}
          </>
        }
      />

      <div style={{ flex: 1, overflowY: view === 'board' ? 'hidden' : 'auto', padding: view === 'board' ? 0 : '0 12px 12px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TasksView collection={collection} accentColor={color.bg} readOnly={readOnly} view={view} />
      </div>

      <NewTaskDialog collection={collection} accentColor={color.bg} open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    </div>
  )
}
