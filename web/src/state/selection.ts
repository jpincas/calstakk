/**
 * Task selection state — which task rows are currently selected, for bulk
 * operations. One selection app-wide, namespaced by collection: any action
 * against a different collection replaces the selection wholesale, so stale
 * uids can never leak across lists. Not persisted — selection is ephemeral.
 */

import { create } from 'zustand'

interface TaskSelectionState {
  /** Collection ref the selection belongs to; null = nothing selected. */
  collection: string | null
  uids: string[]
  /** Last plainly-clicked uid — the fixed end of a shift-click range. */
  anchor: string | null
  /** Plain click: selection becomes just this task. */
  selectOnly: (collection: string, uid: string) => void
  /** Ctrl/Cmd click: add or remove this task. */
  toggle: (collection: string, uid: string) => void
  /** Shift click: selection becomes the range anchor→uid in visible order. */
  rangeTo: (collection: string, uid: string, orderedUids: string[]) => void
  clear: () => void
}

export const useTaskSelectionStore = create<TaskSelectionState>()((set, get) => ({
  collection: null,
  uids: [],
  anchor: null,
  selectOnly: (collection, uid) => set({ collection, uids: [uid], anchor: uid }),
  toggle: (collection, uid) => {
    const s = get()
    if (s.collection !== collection) {
      set({ collection, uids: [uid], anchor: uid })
      return
    }
    const has = s.uids.includes(uid)
    const uids = has ? s.uids.filter((u) => u !== uid) : [...s.uids, uid]
    set(uids.length === 0
      ? { collection: null, uids: [], anchor: null }
      : { uids, anchor: uid })
  },
  rangeTo: (collection, uid, orderedUids) => {
    const s = get()
    const a = s.collection === collection && s.anchor ? orderedUids.indexOf(s.anchor) : -1
    const b = orderedUids.indexOf(uid)
    if (a === -1 || b === -1) {
      set({ collection, uids: [uid], anchor: uid })
      return
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    set({ collection, uids: orderedUids.slice(lo, hi + 1) })
  },
  clear: () => set({ collection: null, uids: [], anchor: null }),
}))
