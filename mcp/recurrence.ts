// Locating a concrete occurrence of a recurring event by its RECURRENCE-ID
// value, for the occurrence / this-and-future edit scopes.
import { expandEvent, occurrenceKey, type Occurrence } from '@/lib/recur.ts'
import { parseCalDate } from '@/lib/dates.ts'
import type { CalEvent } from '@/types/index.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolve a recurrence_id to the Occurrence it names. Expansion is windowed
 * around the slot date — and around the moved start of any matching override,
 * since expandEvent only emits moved-in overrides that intersect the window.
 */
export function findOccurrence(master: CalEvent, recurrenceId: string): Occurrence {
  const key = occurrenceKey(recurrenceId)
  const anchors: Date[] = []
  const slot = parseCalDate(recurrenceId)
  if (slot) anchors.push(slot)
  for (const o of master.overrides ?? []) {
    if (occurrenceKey(o.recurrence_id) === key && o.start) {
      const moved = parseCalDate(o.start)
      if (moved) anchors.push(moved)
    }
  }
  if (anchors.length === 0) {
    throw new Error(
      `Invalid recurrence_id '${recurrenceId}' — expected an iCal date/datetime like 20260101T090000Z or 20260706.`,
    )
  }
  const times = anchors.map((d) => d.getTime())
  const rangeStart = new Date(Math.min(...times) - 2 * DAY_MS)
  const rangeEnd = new Date(Math.max(...times) + 2 * DAY_MS)
  const occ = expandEvent(master, rangeStart, rangeEnd).find((o) => o.key === key)
  if (!occ) {
    throw new Error(
      `Event '${master.uid}' has no occurrence at '${recurrenceId}'. ` +
        `Call list_events with expand: true to see valid recurrence_id values.`,
    )
  }
  return occ
}
