import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { listCollections } from '@/api/collections'
import { CollectionSidebar } from './CollectionSidebar'
import { DataTypeTabs } from './DataTypeTabs'

export function AppShell() {
  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
  })
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0e0f14' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-500">Loading CalStakk…</p>
        </div>
      </div>
    )
  }

  const atRoot = location.pathname === '/' || location.pathname === ''
  if (atRoot && collections && collections.length > 0) {
    return <Navigate to={`/${collections[0].name}/calendar`} replace />
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f2f3f5' }}>
      <CollectionSidebar collections={collections ?? []} />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <DataTypeTabs />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
