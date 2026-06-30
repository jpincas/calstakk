import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { caldav } from '@/api'
import { CollectionSidebar } from './CollectionSidebar'
import { TopNav } from './TopNav'

export function AppShell() {
  const qc = useQueryClient()
  const location = useLocation()

  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })

  // Ensure the inbox collection exists; create it silently if not.
  // We use 'capture' as the internal CalDAV name because /calendars/{user}/inbox
  // is reserved by the server for CalDAV scheduling (RFC 6638).
  useEffect(() => {
    if (!collections) return
    const hasInbox = collections.some((c) => c.name === 'capture')
    if (!hasInbox) {
      caldav
        .createCollection('capture', { displayName: 'Inbox' })
        .then(() => qc.invalidateQueries({ queryKey: ['collections'] }))
        .catch(() => { /* silently ignore if already exists or server rejects */ })
    }
  }, [collections, qc])

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0E0E11',
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
          <p style={{ fontSize: 12, color: '#3A3A46' }}>Loading…</p>
        </div>
      </div>
    )
  }

  const atRoot = location.pathname === '/' || location.pathname === ''
  if (atRoot) {
    return <Navigate to="/today" replace />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#18181C' }}>
      {/* Top nav bar */}
      <TopNav />

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CollectionSidebar collections={collections ?? []} />
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
