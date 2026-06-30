import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AppShell } from '@/components/layout/AppShell'
import { CalendarPage } from '@/pages/calendar'
import { TodosPage } from '@/pages/todos'
import { TodayPage } from '@/pages/today'
import { SplitPage } from '@/pages/split'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={null} />
            <Route path="today"    element={<TodayPage />} />
            <Route path="inbox"    element={<TodosPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="split"    element={<SplitPage />} />
            <Route path=":collection/todos"    element={<TodosPage />} />
            <Route path=":collection/calendar" element={<CalendarPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
