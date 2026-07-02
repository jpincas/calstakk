import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList, type CachePatch } from '@/lib/optimistic'
import type { CalEvent, EventFields } from '@/types'
import {
  applySeriesEdits, applyOccurrenceEdits, removeOccurrence, cutSeriesBefore, splitSeries,
  type Occurrence, type SeriesEdits,
} from '@/lib/recur'

/**
 * All event write operations, shared by the dialog and calendar drag/drop so
 * the recurrence edit semantics (see lib/recur.ts) exist in exactly one place.
 * Every operation is a full-resource PUT/DELETE; the events cache is patched
 * optimistically (rolled back with a toast on failure) so the calendar
 * reflects the change instantly, then re-synced once the write settles.
 */
export function useEventMutations() {
  const qc = useQueryClient()

  const replaceIn = (col: string, next: CalEvent): CachePatch =>
    patchList<CalEvent>(['events', col], (events) =>
      events.map((e) => (e.uid === next.uid ? next : e)))
  const removeIn = (col: string, uid: string): CachePatch =>
    patchList<CalEvent>(['events', col], (events) => events.filter((e) => e.uid !== uid))
  const appendIn = (col: string, event: Omit<CalEvent, 'href'>): CachePatch =>
    patchList<CalEvent>(['events', col], (events) => [...events, { ...event, href: '' }])

  const create = useMutation({
    mutationFn: ({ col, event }: { col: string; event: Omit<CalEvent, 'href'> }) =>
      caldav.createEvent(col, event),
    ...withOptimism<{ col: string; event: Omit<CalEvent, 'href'> }>(qc, {
      patches: ({ col, event }) => [appendIn(col, event)],
      onSuccess: () => toast.success('Event created'),
    }),
  })

  /** Edit the whole series (or a plain event). Schedule changes reset overrides. */
  const saveSeries = useMutation({
    mutationFn: ({ col, master, edits }: { col: string; master: CalEvent; edits: SeriesEdits }) =>
      caldav.updateEvent(col, applySeriesEdits(master, edits)),
    ...withOptimism<{ col: string; master: CalEvent; edits: SeriesEdits }>(qc, {
      patches: ({ col, master, edits }) => [replaceIn(col, applySeriesEdits(master, edits))],
      onSuccess: () => toast.success('Event saved'),
    }),
  })

  /** Edit one occurrence: creates/replaces its RECURRENCE-ID override. */
  const saveOccurrence = useMutation({
    mutationFn: ({ col, occ, edits }: { col: string; occ: Occurrence; edits: Partial<EventFields> }) =>
      caldav.updateEvent(col, applyOccurrenceEdits(occ, edits)),
    ...withOptimism<{ col: string; occ: Occurrence; edits: Partial<EventFields> }>(qc, {
      patches: ({ col, occ, edits }) => [replaceIn(col, applyOccurrenceEdits(occ, edits))],
      onSuccess: () => toast.success('This event saved'),
    }),
  })

  /**
   * Edit this and all future occurrences: split the series into a new resource
   * carrying the future portion plus the edits, then truncate the old master
   * with UNTIL. The create runs first so a failure between the two PUTs can't
   * lose the series (at worst the future portion briefly exists twice).
   * At the first occurrence the split degenerates to a whole-series edit.
   * The optimistic patch mirrors the same split (under a temporary uid for the
   * detached part — the post-settle refetch reconciles it).
   */
  const saveFuture = useMutation({
    mutationFn: async ({ col, occ, edits }: { col: string; occ: Occurrence; edits: SeriesEdits }) => {
      const split = splitSeries(occ, edits, crypto.randomUUID())
      if (!split) {
        await caldav.updateEvent(col, applySeriesEdits(occ.master, edits))
        return
      }
      await caldav.createEvent(col, split.detached)
      await caldav.updateEvent(col, split.truncated)
    },
    ...withOptimism<{ col: string; occ: Occurrence; edits: SeriesEdits }>(qc, {
      patches: ({ col, occ, edits }) => {
        const split = splitSeries(occ, edits, crypto.randomUUID())
        if (!split) return [replaceIn(col, applySeriesEdits(occ.master, edits))]
        return [
          patchList<CalEvent>(['events', col], (events) => [
            ...events.map((e) => (e.uid === split.truncated.uid ? split.truncated : e)),
            { ...split.detached, href: '' },
          ]),
        ]
      },
      onSuccess: () => toast.success('This and future events saved'),
    }),
  })

  /** Delete one occurrence: EXDATEs its slot and drops any override there. */
  const deleteOccurrence = useMutation({
    mutationFn: ({ col, occ }: { col: string; occ: Occurrence }) =>
      caldav.updateEvent(col, removeOccurrence(occ)),
    ...withOptimism<{ col: string; occ: Occurrence }>(qc, {
      patches: ({ col, occ }) => [replaceIn(col, removeOccurrence(occ))],
      onSuccess: () => toast.success('This event deleted'),
    }),
  })

  /** Delete this and all future occurrences (UNTIL cut; whole series if cut lands first). */
  const deleteFuture = useMutation({
    mutationFn: async ({ col, occ }: { col: string; occ: Occurrence }) => {
      const cut = cutSeriesBefore(occ)
      if (cut) await caldav.updateEvent(col, cut)
      else await caldav.deleteEvent(col, occ.master.uid)
    },
    ...withOptimism<{ col: string; occ: Occurrence }>(qc, {
      patches: ({ col, occ }) => {
        const cut = cutSeriesBefore(occ)
        return [cut ? replaceIn(col, cut) : removeIn(col, occ.master.uid)]
      },
      onSuccess: () => toast.success('This and future events deleted'),
    }),
  })

  const deleteSeries = useMutation({
    mutationFn: ({ col, master }: { col: string; master: CalEvent }) =>
      caldav.deleteEvent(col, master.uid),
    ...withOptimism<{ col: string; master: CalEvent }>(qc, {
      patches: ({ col, master }) => [removeIn(col, master.uid)],
      onSuccess: () => toast.success('Event deleted'),
    }),
  })

  return { create, saveSeries, saveOccurrence, saveFuture, deleteOccurrence, deleteFuture, deleteSeries }
}
