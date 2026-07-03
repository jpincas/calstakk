import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ViewMode } from '@/types'

/** How a collection's tasks are displayed: vertical list or kanban board. */
export type TaskViewMode = 'list' | 'board'

interface CollectionState {
  activeCollection: string | null
  viewMode: ViewMode
  hiddenCollections: string[]
  focusedCollection: string | null
  theme: 'light' | 'dark'
  showTasksOnCalendar: boolean
  /** Per-collection list/board preference, keyed by collection ref. Absent = 'list'. */
  taskView: Record<string, TaskViewMode>
  setCollection: (name: string) => void
  setViewMode: (mode: ViewMode) => void
  toggleCollectionHidden: (name: string) => void
  setFocusedCollection: (name: string | null) => void
  toggleTheme: () => void
  toggleShowTasksOnCalendar: () => void
  setTaskView: (ref: string, view: TaskViewMode) => void
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set) => ({
      activeCollection: null,
      viewMode: 'today',
      hiddenCollections: [],
      focusedCollection: null,
      theme: 'light',
      showTasksOnCalendar: true,
      setCollection: (name) => set({ activeCollection: name }),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleCollectionHidden: (name) =>
        set((s) => ({
          hiddenCollections: s.hiddenCollections.includes(name)
            ? s.hiddenCollections.filter((n) => n !== name)
            : [...s.hiddenCollections, name],
          focusedCollection: s.focusedCollection === name ? null : s.focusedCollection,
        })),
      setFocusedCollection: (name) =>
        set((s) => ({ focusedCollection: s.focusedCollection === name ? null : name })),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      toggleShowTasksOnCalendar: () => set((s) => ({ showTasksOnCalendar: !s.showTasksOnCalendar })),
      taskView: {},
      setTaskView: (ref, view) => set((s) => ({ taskView: { ...s.taskView, [ref]: view } })),
    }),
    { name: 'calstakk-collection' }
  )
)
