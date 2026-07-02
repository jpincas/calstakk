// Output shaping: agents get the modeled fields, not the round-trip carriers.
// Raw fields (`*_raw`, extra_lines, etag, href) still round-trip on writes —
// every update fetches the full resource and merges edits onto it — but they
// are pure noise in tool output, so they're stripped here. undefined values
// disappear at JSON.stringify time, keeping results compact.
import type { CalEvent, Collection, EventOverride, Todo } from '@/types/index.ts'
import { toICalString, type Occurrence } from '@/lib/recur.ts'

export function cleanCollection(c: Collection): Omit<Collection, 'href'> {
  const { href: _href, ...rest } = c
  return rest
}

function cleanOverride(o: EventOverride) {
  const {
    start_raw: _1,
    end_raw: _2,
    alarms_raw: _3,
    reminder_alarm_index: _4,
    extra_lines: _5,
    recurrence_id_raw: _6,
    ...rest
  } = o
  return rest
}

export function cleanEvent(e: CalEvent) {
  const {
    start_raw: _1,
    end_raw: _2,
    alarms_raw: _3,
    reminder_alarm_index: _4,
    extra_lines: _5,
    exdates_raw: _6,
    vtimezones_raw: _7,
    etag: _8,
    href: _9,
    overrides,
    ...rest
  } = e
  return { ...rest, overrides: overrides?.map(cleanOverride) }
}

export function cleanTodo(t: Todo): Omit<Todo, 'href'> {
  const { href: _href, ...rest } = t
  return rest
}

/** One expanded occurrence, shaped for agents. */
export function occurrenceView(o: Occurrence) {
  const f = o.fields
  return {
    uid: o.master.uid,
    recurrence_id: o.recurrenceId,
    start: toICalString(o.start, o.allDay),
    end: toICalString(o.end, o.allDay),
    all_day: o.allDay || undefined,
    summary: f.summary,
    description: f.description,
    location: f.location,
    status: f.status,
    transp: f.transp,
    categories: f.categories,
    url: f.url,
    reminder: f.reminder,
    is_recurring: o.isRecurring,
    is_override: o.override ? true : undefined,
  }
}
