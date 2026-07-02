// Shared context and helpers for the MCP tool implementations.
import type { CalDAVClient } from '@/api/client.ts'
import { parseCalDate } from '@/lib/dates.ts'

export interface Ctx {
  client: CalDAVClient
  baseUrl: string
}

/**
 * Reject content mutations on collections shared to us read-only, with a
 * clearer message than the server's bare 403. Own collections ('~'-less refs)
 * are always writable by their owner, so only shared refs cost a PROPFIND.
 */
export async function assertWritable(ctx: Ctx, ref: string): Promise<void> {
  if (!ref.includes('~')) return
  const col = await ctx.client.getCollectionProps(ref)
  if (col.myAccess === 'read') {
    throw new Error(
      `Collection '${ref}' is shared with you read-only — you cannot modify its contents.`,
    )
  }
}

/**
 * Normalize a date/datetime argument to the iCal compact form the server and
 * client use (20260101T090000Z / 20260706). Accepts compact and ISO 8601.
 */
export function toCompact(s: string): string {
  const v = s.trim()
  if (/^\d{8}(T\d{6}Z?)?$/.test(v)) return v
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z)?)?$/.exec(v)
  if (m) {
    const [, y, mo, d, h, mi, se, z] = m
    return h ? `${y}${mo}${d}T${h}${mi}${se ?? '00'}${z ?? ''}` : `${y}${mo}${d}`
  }
  throw new Error(
    `Invalid date/datetime '${s}' — use iCal compact form (20260101T090000Z, or 20260706 for a date) or ISO 8601.`,
  )
}

/** Normalize to a full compact UTC datetime (date-only becomes midnight UTC). */
export function toCompactUtc(s: string): string {
  let v = toCompact(s)
  if (!v.includes('T')) v = `${v}T000000Z`
  else if (!v.endsWith('Z')) v = `${v}Z`
  return v
}

/**
 * Parse a from/to pair into a concrete Date range for occurrence expansion.
 * A date-only `to` is inclusive: the range extends to the end of that day.
 */
export function parseRange(from: string, to: string): { rangeStart: Date; rangeEnd: Date } {
  const fromC = toCompact(from)
  const toC = toCompact(to)
  const rangeStart = parseCalDate(fromC)
  let rangeEnd = parseCalDate(toC)
  if (!rangeStart || !rangeEnd) throw new Error(`Invalid date range '${from}' – '${to}'.`)
  if (!toC.includes('T')) rangeEnd = new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000)
  if (rangeEnd <= rangeStart) throw new Error(`'to' (${to}) must be after 'from' (${from}).`)
  return { rangeStart, rangeEnd }
}
