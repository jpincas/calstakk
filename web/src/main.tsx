import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AppShell } from '@/components/layout/AppShell'
import { CalendarPage } from '@/pages/calendar'
import { DashboardPage } from '@/pages/dashboard'
import { TodosPage } from '@/pages/todos'
import { TodayPage } from '@/pages/today'
import { ProjectPage } from '@/pages/project'
import { TasksPage } from '@/pages/tasks'
import { WaitingPage } from '@/pages/waiting'
import { TagPage } from '@/pages/tag'
import { LoginPage } from '@/pages/login'
import { UsersPage } from '@/pages/users'
import { CalDAVError } from '@/api'
import { clearSession, restoreSession } from '@/state/auth'
import { useCollectionStore } from '@/state/collection'
import './index.css'

// Apply stored credentials to the shared client before anything renders
restoreSession()
// Apply the persisted theme immediately so pre-auth pages (login) match too
document.documentElement.classList.toggle('dark', useCollectionStore.getState().theme === 'dark')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      // Stale or revoked credentials anywhere → back to the login screen
      if (error instanceof CalDAVError && error.status === 401) {
        clearSession()
        if (!window.location.pathname.endsWith('/login')) {
          window.location.href = '/app/login'
        }
      }
    },
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={null} />
            <Route path="home"        element={<DashboardPage />} />
            <Route path="today"       element={<TodayPage />} />
            <Route path="inbox"       element={<TodosPage />} />
            <Route path="tasks"       element={<TasksPage />} />
            <Route path="waiting"     element={<WaitingPage />} />
            <Route path="tag/:tag"    element={<TagPage />} />
            <Route path="calendar"    element={<CalendarPage />} />
            <Route path="users"       element={<UsersPage />} />
            <Route path=":collection" element={<ProjectPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
