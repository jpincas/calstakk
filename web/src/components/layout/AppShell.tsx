import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  DndContext, PointerSensor, useSensor, useSensors,
  closestCorners, pointerWithin, type CollisionDetection,
} from '@dnd-kit/core'
import { caldav } from '@/api'
import { useCollectionStore } from '@/state/collection'
import { CollectionSidebar } from './CollectionSidebar'

// Prefer the exact pointer position (needed to reliably hit small, distant
// targets like a sidebar row) and fall back to corner-distance for in-list
// sorting, where pointerWithin can be too strict between adjacent rows.
// Section drags only ever land on other section blocks — restrict the
// candidate set so the pointer hitting a task row inside a section doesn't
// mask the section itself.
const collisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === 'section') {
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === 'section',
      ),
    })
  }
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args)
}

export function AppShell() {
  const qc = useQueryClient()
  const location = useLocation()
  const { theme } = useCollectionStore()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Apply dark class to <html> so Tailwind dark: utilities and :root.dark CSS vars both work
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Identity gate — a 401 here (no/invalid credentials) sends us to the login page
  const { data: me, isLoading: meLoading, error: meError } = useQuery({
    queryKey: ['me'],
    queryFn: () => caldav.whoami(),
    retry: false,
  })

  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
    enabled: !!me,
  })

  // Ensure the inbox collection exists; create it silently if not.
  // We use 'capture' as the internal CalDAV name because /calendars/{user}/inbox
  // is reserved by the server for CalDAV scheduling (RFC 6638).
  useEffect(() => {
    if (!collections) return
    // Only the user's own 'capture' counts — a shared one has ref 'owner~capture'
    const hasInbox = collections.some((c) => c.ref === 'capture')
    if (!hasInbox) {
      caldav
        .createCollection('capture', { displayName: 'Inbox' })
        .then(() => qc.invalidateQueries({ queryKey: ['collections'] }))
        .catch(() => { /* silently ignore if already exists or server rejects */ })
    }
  }, [collections, qc])

  if (meError) {
    return <Navigate to="/login" replace />
  }

  if (meLoading || isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--nav)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '2px solid #6366F1',
              borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
            }}
          />
          <p style={{ fontSize: 16, color: 'var(--ui-text-muted)' }}>Loading…</p>
        </div>
      </div>
    )
  }

  const atRoot = location.pathname === '/' || location.pathname === ''
  if (atRoot) {
    return <Navigate to="/today" replace />
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--background)' }}>
        <CollectionSidebar collections={collections ?? []} me={me ?? null} />
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </DndContext>
  )
}
