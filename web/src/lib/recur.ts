// Client-side recurrence engine: the server never expands recurrences, so the
// UI expands RRULE + EXDATE + RECURRENCE-ID overrides itself (see lib docs in
// the plan: occurrence identity is epoch-normalized so UTC and same-zone
// floating forms compare equal).

import { RRule, Weekday } from 'rrule'
import { parseCalDate } from '@/lib/dates'
import { lineParams } from '@/api/ical'
import type { CalEvent, EventFields, EventOverride } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Reinterpret a local Date's calendar day as UTC midnight (rrule's all-day space). */
export function toUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

const pad = (n: number) => n.toString().padStart(2, '0')

function localYmd(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function compactLocal(d: Date): string {
  return `${localYmd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function compactUTC(d: Date): string {
  return `${utcYmd(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Parse an RFC 5545 DURATION value to milliseconds; null when malformed. */
export function parseIcalDuration(s: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(s.trim())
  if (!m) return null
  const [, sign, w, d, h, min, sec] = m
  if (![w, d, h, min, sec].some((v) => v !== undefined)) return null
  const ms =
    ((+(w ?? 0)) * 7 * 86400 + (+(d ?? 0)) * 86400 + (+(h ?? 0)) * 3600 + (+(min ?? 0)) * 60 + +(sec ?? 0)) * 1000
  return sign === '-' ? -ms : ms
}

/**
 * Canonical occurrence identity for an iCal date/datetime value: date-only
 * values compare by calendar day, datetimes by epoch (so `…Z` and same-zone
 * floating forms — which is exactly how expansion interprets them — match).
 */
export function occurrenceKey(icalValue: string): string {
  const v = icalValue.trim()
  if (!v.includes('T')) return 'D' + v.replace(/-/g, '').slice(0, 8)
  const d = parseCalDate(v)
  return d ? 'T' + d.getTime() : 'T' + v
}

function keyOfOriginal(occ: Date, allDay: boolean): string {
  // All-day candidates live in rrule's UTC-midnight space; timed ones are real instants.
  return allDay ? 'D' + utcYmd(occ) : 'T' + occ.getTime()
}

/** One concrete calendar entry produced by expanding a CalEvent resource. */
export interface Occurrence {
  /** Canonical identity of the *original* slot (see occurrenceKey). */
  key: string
  /** RECURRENCE-ID / EXDATE value for this slot, in the master's DTSTART form. */
  recurrenceId: string
  /** Param-carrying RECURRENCE-ID line when the master DTSTART has params (TZID). */
  recurrenceIdRaw?: string
  start: Date
  end: Date
  allDay: boolean
  master: CalEvent
  /** Present when this slot is customised by a RECURRENCE-ID override. */
  override?: EventOverride
  /** Resolved display/edit fields (override values over master's). */
  fields: EventFields
  isRecurring: boolean
}

/** The master's per-occurrence duration in ms. */
function masterDuration(e: CalEvent, dtstart: Date): number {
  if (e.end) {
    const end = parseCalDate(e.end)
    if (end) return Math.abs(end.getTime() - dtstart.getTime())
  }
  if (e.duration) {
    const ms = parseIcalDuration(e.duration)
    if (ms !== null) return Math.abs(ms)
  }
  return e.all_day ? DAY_MS : HOUR_MS
}

/** Render an original occurrence instant in the master's DTSTART form. */
function renderRecurrenceId(occ: Date, e: CalEvent): { value: string; raw?: string } {
  if (e.all_day) {
    const value = utcYmd(occ)
    return { value, raw: e.start_raw ? `RECURRENCE-ID${lineParams(e.start_raw)}:${value}` : undefined }
  }
  if (e.start.endsWith('Z')) return { value: compactUTC(occ) }
  const value = compactLocal(occ)
  return { value, raw: e.start_raw ? `RECURRENCE-ID${lineParams(e.start_raw)}:${value}` : undefined }
}

/**
 * Display/edit fields for an overridden occurrence: the override's own values
 * over the master's. Raw round-trip carriers stay strictly the override's —
 * inheriting the master's would duplicate alarm/X-prop lines into the override
 * component on the next save.
 */
export function resolveFields(master: CalEvent, o: EventOverride): EventFields {
  return {
    summary: o.summary || master.summary,
    description: o.description ?? master.description,
    start: o.start ?? o.recurrence_id,
    end: o.end,
    duration: o.duration,
    all_day: o.start !== undefined ? o.all_day : master.all_day,
    location: o.location ?? master.location,
    status: o.status ?? master.status,
    transp: o.transp ?? master.transp,
    categories: o.categories ?? master.categories,
    url: o.url ?? master.url,
    reminder: o.reminder ?? (o.alarms_raw ? undefined : master.reminder),
    start_raw: o.start_raw,
    end_raw: o.end_raw,
    alarms_raw: o.alarms_raw,
    reminder_alarm_index: o.reminder_alarm_index,
    extra_lines: o.extra_lines,
  }
}

function overrideOccurrence(
  e: CalEvent,
  o: EventOverride,
  originalKey: string,
  fallbackStart: Date,
  fallbackAllDay: boolean,
  durMs: number,
): Occurrence | null {
  if (o.status === 'CANCELLED') return null
  const parsedStart = o.start ? parseCalDate(o.start) : null
  const start = parsedStart ?? fallbackStart
  const allDay = o.start ? !o.start.includes('T') : fallbackAllDay
  const overrideDur = o.end
    ? (() => {
        const end = parseCalDate(o.end)
        return end ? Math.abs(end.getTime() - start.getTime()) : durMs
      })()
    : o.duration
    ? Math.abs(parseIcalDuration(o.duration) ?? durMs)
    : durMs
  return {
    key: originalKey,
    recurrenceId: o.recurrence_id,
    recurrenceIdRaw: o.recurrence_id_raw,
    start,
    end: new Date(start.getTime() + overrideDur),
    allDay,
    master: e,
    override: o,
    fields: resolveFields(e, o),
    isRecurring: !!e.rrule,
  }
}

/**
 * Expand one calendar object resource into the concrete occurrences that
 * intersect [rangeStart, rangeEnd): RRULE instances minus EXDATEs, overrides
 * replacing (or cancelling) their slot, and overrides moved in from outside
 * the window emitted standalone. Non-recurring events yield one occurrence
 * unconditionally (range filtering is the caller's concern, matching the
 * previous calendar behaviour).
 */
export function expandEvent(e: CalEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const dtstart = parseCalDate(e.start)
  if (!dtstart) return []
  const allDay = !!e.all_day
  const durMs = masterDuration(e, dtstart)
  const overrides = e.overrides ?? []
  const consumed = new Set<EventOverride>()
  const out: Occurrence[] = []

  const masterOccurrence = (start: Date, key: string, rid: { value: string; raw?: string }): Occurrence => ({
    key,
    recurrenceId: rid.value,
    recurrenceIdRaw: rid.raw,
    start,
    end: new Date(start.getTime() + durMs),
    allDay,
    master: e,
    fields: e,
    isRecurring: !!e.rrule,
  })

  if (!e.rrule) {
    const key = occurrenceKey(e.start)
    const rid = renderRecurrenceId(allDay ? toUTCDate(dtstart) : dtstart, e)
    // Overrides on a rule-less master are foreign but real — match by slot, show the rest standalone.
    const byKey = new Map(overrides.map((o) => [occurrenceKey(o.recurrence_id), o]))
    const own = byKey.get(key)
    if (own) {
      consumed.add(own)
      const occ = overrideOccurrence(e, own, key, dtstart, allDay, durMs)
      if (occ) out.push(occ)
    } else {
      out.push(masterOccurrence(dtstart, key, rid))
    }
    for (const o of overrides) {
      if (consumed.has(o)) continue
      const occ = overrideOccurrence(e, o, occurrenceKey(o.recurrence_id), dtstart, allDay, durMs)
      if (occ && occ.start < rangeEnd && occ.end > rangeStart) out.push(occ)
    }
    return out
  }

  const rruleStart = allDay ? toUTCDate(dtstart) : dtstart
  let rule: RRule
  try {
    rule = new RRule({ ...RRule.parseString(e.rrule), dtstart: rruleStart })
  } catch {
    // Unparseable rule: show the master as a single event rather than hiding it.
    return [masterOccurrence(dtstart, occurrenceKey(e.start), renderRecurrenceId(rruleStart, e))]
  }

  const exdateKeys = new Set((e.exdates ?? []).map(occurrenceKey))
  // Lenient day-level matching for date-only EXDATEs against a timed series.
  const exdateDays = new Set(
    (e.exdates ?? []).filter((x) => !x.includes('T')).map((x) => x.replace(/-/g, '').slice(0, 8)),
  )
  const byKey = new Map(overrides.map((o) => [occurrenceKey(o.recurrence_id), o]))

  const queryStart = allDay ? toUTCDate(rangeStart) : new Date(rangeStart.getTime() - durMs)
  const queryEnd = allDay ? toUTCDate(rangeEnd) : rangeEnd

  for (const occ of rule.between(queryStart, queryEnd, true)) {
    const key = keyOfOriginal(occ, allDay)
    const occLocal = allDay ? new Date(occ.getUTCFullYear(), occ.getUTCMonth(), occ.getUTCDate()) : occ
    if (exdateKeys.has(key)) continue
    if (!allDay && exdateDays.has(localYmd(occLocal))) continue
    const override = byKey.get(key)
    if (override) {
      consumed.add(override)
      const resolved = overrideOccurrence(e, override, key, occLocal, allDay, durMs)
      if (resolved) out.push(resolved)
      continue
    }
    out.push(masterOccurrence(occLocal, key, renderRecurrenceId(occ, e)))
  }

  // Overrides whose original slot fell outside the query window (or whose id
  // form we couldn't match) may still have been *moved into* the visible range.
  for (const o of overrides) {
    if (consumed.has(o)) continue
    const key = occurrenceKey(o.recurrence_id)
    const fallbackStart = parseCalDate(o.recurrence_id) ?? dtstart
    const occ = overrideOccurrence(e, o, key, fallbackStart, allDay, durMs)
    if (occ && occ.start < rangeEnd && occ.end > rangeStart) out.push(occ)
  }

  return out
}

/** Render a Date as an iCal value the UI writes: bare date (all-day) or UTC datetime. */
export function toICalString(d: Date, allDay: boolean): string {
  return allDay ? localYmd(d) : compactUTC(d)
}

/**
 * Apply an occurrence-level time edit to the whole series: shift the master
 * start by the same delta and adopt the new duration, rendered in the master's
 * datetime form (or the new all-day-ness when that was toggled).
 */
export function shiftSeries(
  master: CalEvent,
  deltaMs: number,
  durationMs: number,
  allDay: boolean,
): { start: string; end: string; all_day: boolean } {
  const dtstart = parseCalDate(master.start) ?? new Date()
  const newStart = new Date(dtstart.getTime() + deltaMs)
  const newEnd = new Date(newStart.getTime() + durationMs)
  if (allDay) return { start: localYmd(newStart), end: localYmd(newEnd), all_day: true }
  const floating = !master.start.endsWith('Z') && !master.all_day
  return floating
    ? { start: compactLocal(newStart), end: compactLocal(newEnd), all_day: false }
    : { start: compactUTC(newStart), end: compactUTC(newEnd), all_day: false }
}

// ── Edit semantics (pure; the mutation hook wires these to the client) ──────

/** Field edits from the dialog; rrule: null removes the rule, undefined leaves it. */
export interface SeriesEdits extends Partial<EventFields> {
  rrule?: string | null
}

/** True when an edit changes the series schedule (times, all-day-ness, or rule). */
export function scheduleChanged(master: CalEvent, edits: SeriesEdits): boolean {
  if (edits.rrule !== undefined && (edits.rrule ?? undefined) !== master.rrule) return true
  if (edits.start !== undefined && edits.start !== master.start) return true
  if (edits.end !== undefined && edits.end !== master.end) return true
  if (edits.all_day !== undefined && !!edits.all_day !== !!master.all_day) return true
  return false
}

/**
 * Apply edits to the whole series. A schedule change (rule or times) resets
 * overrides and exdates — their RECURRENCE-IDs no longer name valid slots
 * (industry-standard behaviour; the scope dialog warns before this happens).
 */
export function applySeriesEdits(master: CalEvent, edits: SeriesEdits): CalEvent {
  const reset = scheduleChanged(master, edits)
  const { rrule, ...fields } = edits
  const next: CalEvent = {
    ...master,
    ...fields,
    rrule: rrule === undefined ? master.rrule : rrule ?? undefined,
  }
  if (reset) {
    next.overrides = undefined
    next.exdates = undefined
    next.exdates_raw = undefined
  }
  return next
}

/** The user-editable content of a resolved occurrence, without round-trip carriers. */
function contentFields(f: EventFields): Partial<EventFields> {
  return {
    summary: f.summary,
    description: f.description,
    start: f.start,
    end: f.end,
    all_day: f.all_day,
    location: f.location,
    status: f.status,
    transp: f.transp,
    categories: f.categories,
    url: f.url,
    reminder: f.reminder,
  }
}

/**
 * Apply edits to a single occurrence: build/replace its override (a full
 * snapshot of the resolved fields) and return the updated master resource.
 * When the slot already had an override, its own raw carriers (alarms, X-props)
 * are kept; a fresh override deliberately carries none of the master's.
 */
export function applyOccurrenceEdits(occ: Occurrence, edits: Partial<EventFields>): CalEvent {
  const base = occ.override ? occ.fields : contentFields(occ.fields)
  const override: EventOverride = {
    ...base,
    ...edits,
    recurrence_id: occ.recurrenceId,
    recurrence_id_raw: occ.recurrenceIdRaw ?? occ.override?.recurrence_id_raw,
  }
  const overrides = (occ.master.overrides ?? []).filter((o) => occurrenceKey(o.recurrence_id) !== occ.key)
  overrides.push(override)
  return { ...occ.master, overrides }
}

/** Remove one occurrence: EXDATE its original slot and drop any override there. */
export function removeOccurrence(occ: Occurrence): CalEvent {
  const overrides = (occ.master.overrides ?? []).filter((o) => occurrenceKey(o.recurrence_id) !== occ.key)
  return {
    ...occ.master,
    exdates: [...(occ.master.exdates ?? []), occ.recurrenceId],
    overrides: overrides.length ? overrides : undefined,
  }
}

/**
 * Truncate the series just before this occurrence's original slot (UNTIL cut),
 * dropping overrides/exdates at or after it. Returns null when the cut lands
 * at/before the first occurrence — the caller should delete the resource.
 */
export function cutSeriesBefore(occ: Occurrence): CalEvent | null {
  const master = occ.master
  if (!master.rrule) return null
  const orig = parseCalDate(occ.recurrenceId)
  const dtstart = parseCalDate(master.start)
  if (!orig || !dtstart || orig.getTime() <= dtstart.getTime()) return null

  let until: string
  if (master.all_day) {
    until = localYmd(new Date(orig.getTime() - DAY_MS))
  } else {
    const prev = new Date(orig.getTime() - 1000)
    until = master.start.endsWith('Z') ? compactUTC(prev) : compactLocal(prev)
  }
  const rrule = master.rrule
    .split(';')
    .filter((p) => !/^(UNTIL|COUNT)=/i.test(p))
    .concat(`UNTIL=${until}`)
    .join(';')

  const cutMs = orig.getTime()
  const before = (v: string) => {
    const d = parseCalDate(v)
    return d !== null && d.getTime() < cutMs
  }
  const exdates = (master.exdates ?? []).filter(before)
  const overrides = (master.overrides ?? []).filter((o) => before(o.recurrence_id))
  return {
    ...master,
    rrule,
    exdates: exdates.length ? exdates : undefined,
    exdates_raw: undefined, // list may have changed; serialize canonically
    overrides: overrides.length ? overrides : undefined,
  }
}

// ── Recurrence rule editor model ─────────────────────────────────────────────

export interface RecurrenceForm {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  /** 0=Mon … 6=Sun; meaningful for WEEKLY only. */
  byweekday: number[]
  ends: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; n: number }
}

const FREQ_NAMES: Record<number, RecurrenceForm['freq']> = {
  [RRule.DAILY]: 'DAILY',
  [RRule.WEEKLY]: 'WEEKLY',
  [RRule.MONTHLY]: 'MONTHLY',
  [RRule.YEARLY]: 'YEARLY',
}

const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/**
 * Map an RRULE to the editor's vocabulary; null when the rule uses parts the
 * editor can't express (BYMONTHDAY, BYSETPOS, nth-weekday, WKST, …) — such
 * rules are shown read-only, never silently rewritten through a lossy form.
 */
export function rruleToForm(rrule: string): RecurrenceForm | null {
  let opts: ReturnType<typeof RRule.parseString>
  try {
    opts = RRule.parseString(rrule)
  } catch {
    return null
  }
  const freq = opts.freq !== undefined ? FREQ_NAMES[opts.freq] : undefined
  if (!freq) return null
  const unsupported = [
    opts.bymonthday, opts.byyearday, opts.byweekno, opts.bymonth, opts.bysetpos,
    opts.byhour, opts.byminute, opts.bysecond, opts.byeaster, opts.bynmonthday, opts.bynweekday,
  ]
  if (unsupported.some((v) => v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0))) return null
  if (opts.wkst !== null && opts.wkst !== undefined) return null

  let byweekday: number[] = []
  if (opts.byweekday !== null && opts.byweekday !== undefined) {
    if (freq !== 'WEEKLY') return null
    const days = Array.isArray(opts.byweekday) ? opts.byweekday : [opts.byweekday]
    for (const d of days) {
      if (typeof d === 'number') byweekday.push(d)
      else if (d instanceof Weekday) {
        if (d.n !== undefined && d.n !== null) return null // nth-weekday (e.g. 2FR)
        byweekday.push(d.weekday)
      } else return null
    }
    byweekday = [...new Set(byweekday)].sort()
  }

  const ends: RecurrenceForm['ends'] = opts.until
    ? { type: 'until', date: opts.until.toISOString().slice(0, 10) }
    : opts.count
    ? { type: 'count', n: opts.count }
    : { type: 'never' }

  return { freq, interval: opts.interval && opts.interval > 1 ? opts.interval : 1, byweekday, ends }
}

/** Serialize the editor form to an RRULE value. UNTIL's type follows DTSTART's. */
export function formToRrule(f: RecurrenceForm, allDay: boolean): string {
  const parts = [`FREQ=${f.freq}`]
  if (f.interval > 1) parts.push(`INTERVAL=${f.interval}`)
  if (f.freq === 'WEEKLY' && f.byweekday.length > 0) {
    parts.push(`BYDAY=${f.byweekday.map((i) => BYDAY_CODES[i]).join(',')}`)
  }
  if (f.ends.type === 'until') {
    const ymd = f.ends.date.replace(/-/g, '')
    parts.push(`UNTIL=${allDay ? ymd : `${ymd}T235959Z`}`)
  } else if (f.ends.type === 'count') {
    parts.push(`COUNT=${f.ends.n}`)
  }
  return parts.join(';')
}

/** Human-readable summary of an RRULE ("every 2 weeks on Monday"), raw value as fallback. */
export function rruleSummary(rrule: string): string {
  try {
    const text = new RRule(RRule.parseString(rrule)).toText()
    return text && !text.includes('RRule error') ? text : rrule
  } catch {
    return rrule
  }
}
