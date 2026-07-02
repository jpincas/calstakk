import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CalEvent } from '@/types/index.ts'
import {
  applyOccurrenceEdits,
  applySeriesEdits,
  cutSeriesBefore,
  expandEvent,
  removeOccurrence,
  scheduleChanged,
  splitSeries,
  type SeriesEdits,
} from '@/lib/recur.ts'
import { run } from '../errors.ts'
import { assertWritable, parseRange, toCompact, toCompactUtc, type Ctx } from '../common.ts'
import { cleanEvent, occurrenceView } from '../clean.ts'
import { findOccurrence } from '../recurrence.ts'
import { refArg } from './collections.ts'

const DT_DESC =
  'iCal compact form: 20260101T090000Z (UTC datetime) or 20260706 (all-day date). ISO 8601 also accepted.'

const scopeArg = z
  .enum(['series', 'occurrence', 'this_and_future'])
  .optional()
  .describe(
    "For recurring events: 'series' (default) affects every occurrence; 'occurrence' only the one named by " +
      "recurrence_id; 'this_and_future' that occurrence and all later ones. Non-series scopes require recurrence_id.",
  )

const recurrenceIdArg = z
  .string()
  .optional()
  .describe(
    'Identifies one occurrence of a recurring event — the recurrence_id value returned by list_events with expand: true.',
  )

const ListEventsArgs = z.object({
  collection: refArg,
  from: z.string().optional().describe(`Range start. ${DT_DESC}`),
  to: z.string().optional().describe(`Range end. ${DT_DESC}`),
  expand: z.boolean().optional().describe('Expand recurring events into individual occurrences'),
})

const GetEventArgs = z.object({ collection: refArg, uid: z.string() })

const CreateEventArgs = z.object({
  collection: refArg,
  summary: z.string(),
  start: z.string().describe(DT_DESC),
  end: z.string().optional().describe(`Exclusive end; omit with duration or for default length. ${DT_DESC}`),
  duration: z.string().optional().describe('RFC 5545 duration, e.g. PT1H — alternative to end'),
  all_day: z.boolean().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(['TENTATIVE', 'CONFIRMED', 'CANCELLED']).optional(),
  transp: z.enum(['OPAQUE', 'TRANSPARENT']).optional().describe('OPAQUE = shows as busy, TRANSPARENT = free'),
  categories: z.array(z.string()).optional(),
  url: z.string().optional(),
  reminder: z.string().optional().describe('Display-alarm trigger relative to start, e.g. -PT15M = 15 minutes before'),
  rrule: z.string().optional().describe('RFC 5545 recurrence rule, e.g. FREQ=WEEKLY;BYDAY=MO;COUNT=10'),
  uid: z.string().optional().describe('Auto-generated when omitted'),
})

// Fields an update may change; JSON null clears a field (summary/start cannot be cleared).
const UpdateEventArgs = z.object({
  collection: refArg,
  uid: z.string(),
  scope: scopeArg,
  recurrence_id: recurrenceIdArg,
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  start: z.string().optional().describe(DT_DESC),
  end: z.string().nullable().optional().describe(`Exclusive end. ${DT_DESC}`),
  duration: z.string().nullable().optional().describe('RFC 5545 duration, e.g. PT1H — alternative to end'),
  all_day: z.boolean().optional(),
  location: z.string().nullable().optional(),
  status: z.enum(['TENTATIVE', 'CONFIRMED', 'CANCELLED']).nullable().optional(),
  transp: z.enum(['OPAQUE', 'TRANSPARENT']).nullable().optional(),
  categories: z.array(z.string()).nullable().optional(),
  url: z.string().nullable().optional(),
  reminder: z.string().nullable().optional().describe('e.g. -PT15M; null removes the reminder'),
  rrule: z.string().nullable().optional().describe('New recurrence rule; null removes recurrence entirely'),
})

const DeleteEventArgs = z.object({
  collection: refArg,
  uid: z.string(),
  scope: scopeArg,
  recurrence_id: recurrenceIdArg,
})

type UpdateEventArgsT = z.infer<typeof UpdateEventArgs>

/**
 * Turn tool arguments into SeriesEdits: omitted args leave a field unchanged;
 * JSON null clears it (a present key with value undefined, which the spread in
 * applySeriesEdits/applyOccurrenceEdits overwrites onto the master).
 */
function buildEdits(args: UpdateEventArgsT): SeriesEdits {
  const edits: Record<string, unknown> = {}
  const keys = [
    'summary', 'description', 'start', 'end', 'duration', 'all_day',
    'location', 'status', 'transp', 'categories', 'url', 'reminder',
  ] as const
  for (const k of keys) {
    if (args[k] !== undefined) edits[k] = args[k] ?? undefined
  }
  if (typeof edits.start === 'string') edits.start = toCompact(edits.start)
  if (typeof edits.end === 'string') edits.end = toCompact(edits.end)
  // DTEND and DURATION are mutually exclusive; setting one drops the other.
  if (edits.end !== undefined && args.duration === undefined) edits.duration = undefined
  if (typeof edits.duration === 'string' && args.end === undefined) edits.end = undefined
  if (args.rrule !== undefined) (edits as SeriesEdits).rrule = args.rrule
  return edits as SeriesEdits
}

function requireOccurrence(master: CalEvent, scope: string, recurrenceId: string | undefined) {
  if (!master.rrule) {
    throw new Error(`Event '${master.uid}' is not recurring — use scope 'series' (the default).`)
  }
  if (!recurrenceId) {
    throw new Error(
      `scope '${scope}' requires recurrence_id. Call list_events with expand: true to see each occurrence's recurrence_id.`,
    )
  }
  return findOccurrence(master, recurrenceId)
}

export function registerEventTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'list_events',
    {
      description:
        'List events in a collection, optionally within a time range. By default returns raw event resources ' +
        '(recurring events appear once, with their rrule/exdates/overrides). With expand: true (requires from ' +
        'and to) recurrences are expanded into concrete occurrences, each carrying the recurrence_id needed for ' +
        "per-occurrence edits. A date-only 'to' is inclusive.",
      inputSchema: ListEventsArgs.shape,
    },
    ({ collection, from, to, expand }: z.infer<typeof ListEventsArgs>) =>
      run(ctx.baseUrl, async () => {
        if (expand && (!from || !to)) {
          throw new Error("expand: true requires both 'from' and 'to'.")
        }
        const opts = from && to ? { from: toCompactUtc(from), to: toCompactUtc(to) } : undefined
        const events = await ctx.client.listEvents(collection, opts)
        if (!expand) return events.map(cleanEvent)
        const { rangeStart, rangeEnd } = parseRange(from!, to!)
        return events
          .flatMap((e) => expandEvent(e, rangeStart, rangeEnd))
          .filter((o) => o.start < rangeEnd && o.end > rangeStart)
          .sort((a, b) => a.start.getTime() - b.start.getTime())
          .map(occurrenceView)
      }),
  )

  server.registerTool(
    'get_event',
    {
      description:
        'Fetch one event resource by uid: the master fields plus, for recurring events, its rrule, exdates ' +
        '(skipped slots) and overrides (customised occurrences).',
      inputSchema: GetEventArgs.shape,
    },
    ({ collection, uid }: z.infer<typeof GetEventArgs>) =>
      run(ctx.baseUrl, async () => cleanEvent(await ctx.client.getEvent(collection, uid))),
  )

  server.registerTool(
    'create_event',
    {
      description:
        'Create an event. Only summary and start are required; a date-only start makes it all-day. ' +
        'Give rrule (e.g. FREQ=WEEKLY;BYDAY=MO,WE) for a recurring event. Returns the uid.',
      inputSchema: CreateEventArgs.shape,
    },
    (args: z.infer<typeof CreateEventArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, args.collection)
        if (args.end && args.duration) throw new Error('Give either end or duration, not both.')
        const start = toCompact(args.start)
        const allDay = !start.includes('T')
        if (args.all_day && !allDay) {
          throw new Error('all_day events need a date-only start (e.g. 20260706), not a datetime.')
        }
        const uid = args.uid ?? crypto.randomUUID()
        await ctx.client.createEvent(args.collection, {
          uid,
          summary: args.summary,
          start,
          end: args.end ? toCompact(args.end) : undefined,
          duration: args.duration,
          all_day: allDay || undefined,
          description: args.description,
          location: args.location,
          status: args.status,
          transp: args.transp,
          categories: args.categories,
          url: args.url,
          reminder: args.reminder,
          rrule: args.rrule,
        })
        return { uid, created: true }
      }),
  )

  server.registerTool(
    'update_event',
    {
      description:
        'Update an event. Omitted fields stay unchanged; JSON null clears a field; rrule: null makes the event ' +
        "non-recurring. For recurring events pick a scope: 'series' (default, every occurrence — changing the " +
        "schedule resets per-occurrence customisations), 'occurrence' (just the one named by recurrence_id), or " +
        "'this_and_future' (splits the series at that occurrence; returns the new series' uid as new_uid).",
      inputSchema: UpdateEventArgs.shape,
    },
    (args: UpdateEventArgsT) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, args.collection)
        const edits = buildEdits(args)
        if (Object.keys(edits).length === 0) {
          throw new Error('No fields to update — provide at least one field.')
        }
        const scope = args.scope ?? 'series'
        const master = await ctx.client.getEvent(args.collection, args.uid)

        if (scope === 'series') {
          const reset = scheduleChanged(master, edits) &&
            !!(master.overrides?.length || master.exdates?.length)
          await ctx.client.updateEvent(args.collection, applySeriesEdits(master, edits))
          return { uid: args.uid, scope, updated: true, overrides_reset: reset || undefined }
        }

        const occ = requireOccurrence(master, scope, args.recurrence_id)

        if (scope === 'occurrence') {
          if (args.rrule !== undefined) {
            throw new Error(
              "rrule can only be changed with scope 'series' or 'this_and_future', not on a single occurrence.",
            )
          }
          const { rrule: _rrule, ...fieldEdits } = edits
          await ctx.client.updateEvent(args.collection, applyOccurrenceEdits(occ, fieldEdits))
          return { uid: args.uid, scope, recurrence_id: occ.recurrenceId, updated: true }
        }

        // this_and_future: create the detached future series first so a failure
        // between the two writes can't lose it (matches the UI's ordering).
        const split = splitSeries(occ, edits, crypto.randomUUID())
        if (!split) {
          const reset = scheduleChanged(master, edits) &&
            !!(master.overrides?.length || master.exdates?.length)
          await ctx.client.updateEvent(args.collection, applySeriesEdits(master, edits))
          return {
            uid: args.uid,
            scope,
            updated: true,
            overrides_reset: reset || undefined,
            note: 'Cut lands at the first occurrence — the edit was applied to the whole series instead.',
          }
        }
        await ctx.client.createEvent(args.collection, split.detached)
        await ctx.client.updateEvent(args.collection, split.truncated)
        return {
          uid: args.uid,
          scope,
          updated: true,
          new_uid: split.detached.uid,
          note: `Series split: '${args.uid}' now ends before ${occ.recurrenceId}; ` +
            `'${split.detached.uid}' carries this and future occurrences.`,
        }
      }),
  )

  server.registerTool(
    'delete_event',
    {
      description:
        "Delete an event. For recurring events pick a scope: 'series' (default) removes the whole event; " +
        "'occurrence' skips just the one named by recurrence_id; 'this_and_future' ends the series before it.",
      inputSchema: DeleteEventArgs.shape,
    },
    ({ collection, uid, scope: scopeIn, recurrence_id }: z.infer<typeof DeleteEventArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, collection)
        const scope = scopeIn ?? 'series'
        if (scope === 'series') {
          await ctx.client.deleteEvent(collection, uid)
          return { uid, scope, deleted: true }
        }
        const master = await ctx.client.getEvent(collection, uid)
        const occ = requireOccurrence(master, scope, recurrence_id)
        if (scope === 'occurrence') {
          await ctx.client.updateEvent(collection, removeOccurrence(occ))
          return { uid, scope, recurrence_id: occ.recurrenceId, deleted: true }
        }
        const cut = cutSeriesBefore(occ)
        if (cut) {
          await ctx.client.updateEvent(collection, cut)
          return { uid, scope, deleted: true, note: `Series now ends before ${occ.recurrenceId}.` }
        }
        await ctx.client.deleteEvent(collection, uid)
        return {
          uid,
          scope,
          deleted: true,
          note: 'Cut lands at the first occurrence — the whole event was deleted.',
        }
      }),
  )
}
