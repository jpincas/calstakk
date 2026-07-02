import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { caldav } from '@/api'
import type { CalEvent, EventFields } from '@/types'
import {
  applySeriesEdits, applyOccurrenceEdits, removeOccurrence, cutSeriesBefore,
  type Occurrence, type SeriesEdits,
} from '@/lib/recur'

/**
 * All event write operations, shared by the dialog and calendar drag/drop so
 * the recurrence edit semantics (see lib/recur.ts) exist in exactly one place.
 * Every operation is a full-resource PUT/DELETE followed by a query invalidation.
 */
export function useEventMutations() {
  const qc = useQueryClient()
  const done = (col: string, msg: string) => {
    void qc.invalidateQueries({ queryKey: ['events', col] })
    toast.success(msg)
  }
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e))

  const create = useMutation({
    mutationFn: ({ col, event }: { col: string; event: Omit<CalEvent, 'href'> }) =>
      caldav.createEvent(col, event),
    onSuccess: (_, { col }) => done(col, 'Event created'),
    onError: fail,
  })

  /** Edit the whole series (or a plain event). Schedule changes reset overrides. */
  const saveSeries = useMutation({
    mutationFn: ({ col, master, edits }: { col: string; master: CalEvent; edits: SeriesEdits }) =>
      caldav.updateEvent(col, applySeriesEdits(master, edits)),
    onSuccess: (_, { col }) => done(col, 'Event saved'),
    onError: fail,
  })

  /** Edit one occurrence: creates/replaces its RECURRENCE-ID override. */
  const saveOccurrence = useMutation({
    mutationFn: ({ col, occ, edits }: { col: string; occ: Occurrence; edits: Partial<EventFields> }) =>
      caldav.updateEvent(col, applyOccurrenceEdits(occ, edits)),
    onSuccess: (_, { col }) => done(col, 'This event saved'),
    onError: fail,
  })

  /** Delete one occurrence: EXDATEs its slot and drops any override there. */
  const deleteOccurrence = useMutation({
    mutationFn: ({ col, occ }: { col: string; occ: Occurrence }) =>
      caldav.updateEvent(col, removeOccurrence(occ)),
    onSuccess: (_, { col }) => done(col, 'This event deleted'),
    onError: fail,
  })

  /** Delete this and all future occurrences (UNTIL cut; whole series if cut lands first). */
  const deleteFuture = useMutation({
    mutationFn: async ({ col, occ }: { col: string; occ: Occurrence }) => {
      const cut = cutSeriesBefore(occ)
      if (cut) await caldav.updateEvent(col, cut)
      else await caldav.deleteEvent(col, occ.master.uid)
    },
    onSuccess: (_, { col }) => done(col, 'This and future events deleted'),
    onError: fail,
  })

  const deleteSeries = useMutation({
    mutationFn: ({ col, master }: { col: string; master: CalEvent }) =>
      caldav.deleteEvent(col, master.uid),
    onSuccess: (_, { col }) => done(col, 'Event deleted'),
    onError: fail,
  })

  return { create, saveSeries, saveOccurrence, deleteOccurrence, deleteFuture, deleteSeries }
}
