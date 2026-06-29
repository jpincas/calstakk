import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DataType } from '@/types'

interface CollectionState {
  activeCollection: string | null
  activeDataType: DataType
  setCollection: (name: string) => void
  setDataType: (t: DataType) => void
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set) => ({
      activeCollection: null,
      activeDataType: 'calendar',
      setCollection: (name) => set({ activeCollection: name }),
      setDataType: (t) => set({ activeDataType: t }),
    }),
    { name: 'calstakk-collection' }
  )
)
