import { describe, it, expect } from 'vitest'
import {
  expandEvent, occurrenceKey, parseIcalDuration,
  rruleToForm, formToRrule, rruleSummary,
  applySeriesEdits, applyOccurrenceEdits, removeOccurrence, cutSeriesBefore, scheduleChanged,
  splitSeries, hasCustomisationsFrom,
} from '../recur'
import { parseCalDate } from '../dates'
import type { CalEvent } from '@/types'

const base: CalEvent = {
  uid: 'ev1',
  summary: 'Standup',
  start: '20260706T090000Z', // a Monday
  end: '20260706T093000Z',
  href: '/calendars/u/work/ev1.ics',
}

// A window comfortably around July 2026.
const from = parseCalDate('20260701T000000Z')!
const to = parseCalDate('20260801T000000Z')!

describe('parseIcalDuration', () => {
  it('parses common forms', () => {
    expect(parseIcalDuration('PT1H')).toBe(3600_000)
    expect(parseIcalDuration('PT30M')).toBe(1800_000)
    expect(parseIcalDuration('P1D')).toBe(86400_000)
    expect(parseIcalDuration('P1W')).toBe(7 * 86400_000)
    expect(parseIcalDuration('-PT15M')).toBe(-900_000)
    expect(parseIcalDuration('P1DT2H')).toBe(86400_000 + 7200_000)
  })
  it('rejects malformed values', () => {
    expect(parseIcalDuration('P')).toBeNull()
    expect(parseIcalDuration('15M')).toBeNull()
  })
})

describe('occurrenceKey', () => {
  it('keys date-only values by day and datetimes by epoch', () => {
    expect(occurrenceKey('20260706')).toBe('D20260706')
    expect(occurrenceKey('20260706T090000Z')).toBe('T' + parseCalDate('20260706T090000Z')!.getTime())
  })
})

describe('expandEvent', () => {
  it('returns a single occurrence for non-recurring events', () => {
    const occs = expandEvent(base, from, to)
    expect(occs).toHaveLength(1)
    expect(occs[0].isRecurring).toBe(false)
    expect(occs[0].start).toEqual(parseCalDate(base.start))
    expect(occs[0].end).toEqual(parseCalDate(base.end!))
  })

  it('expands a weekly rule inside the window', () => {
    const occs = expandEvent({ ...base, rrule: 'FREQ=WEEKLY' }, from, to)
    // Mondays 6, 13, 20, 27 July
    expect(occs).toHaveLength(4)
    expect(occs.every((o) => o.isRecurring)).toBe(true)
    expect(occs[1].recurrenceId).toBe('20260713T090000Z')
    expect(occs[1].key).toBe(occurrenceKey('20260713T090000Z'))
  })

  it('drops EXDATEd occurrences', () => {
    const occs = expandEvent({ ...base, rrule: 'FREQ=WEEKLY', exdates: ['20260713T090000Z'] }, from, to)
    expect(occs.map((o) => o.recurrenceId)).toEqual([
      '20260706T090000Z', '20260720T090000Z', '20260727T090000Z',
    ])
  })

  it('drops occurrences named by a date-only EXDATE on a timed series', () => {
    const occs = expandEvent({ ...base, rrule: 'FREQ=WEEKLY', exdates: ['20260713'] }, from, to)
    expect(occs.some((o) => o.recurrenceId === '20260713T090000Z')).toBe(false)
    expect(occs.length).toBeGreaterThanOrEqual(3)
  })

  it('replaces an occurrence with its override', () => {
    const occs = expandEvent({
      ...base,
      rrule: 'FREQ=WEEKLY',
      overrides: [{
        recurrence_id: '20260713T090000Z',
        summary: 'Standup (moved)',
        start: '20260713T140000Z',
        end: '20260713T143000Z',
      }],
    }, from, to)
    expect(occs).toHaveLength(4)
    const moved = occs.find((o) => o.override)
    expect(moved).toBeDefined()
    expect(moved!.start).toEqual(parseCalDate('20260713T140000Z'))
    expect(moved!.fields.summary).toBe('Standup (moved)')
    expect(moved!.recurrenceId).toBe('20260713T090000Z') // identity stays the original slot
  })

  it('resolves unset override fields from the master', () => {
    const occs = expandEvent({
      ...base,
      location: 'Room 1',
      rrule: 'FREQ=WEEKLY',
      overrides: [{ recurrence_id: '20260713T090000Z', start: '20260713T100000Z' }],
    }, from, to)
    const moved = occs.find((o) => o.override)!
    expect(moved.fields.summary).toBe('Standup')
    expect(moved.fields.location).toBe('Room 1')
    // A moved start without an own end keeps the master's duration.
    expect(moved.end.getTime() - moved.start.getTime()).toBe(30 * 60_000)
  })

  it('hides occurrences cancelled by an override', () => {
    const occs = expandEvent({
      ...base,
      rrule: 'FREQ=WEEKLY',
      overrides: [{ recurrence_id: '20260720T090000Z', status: 'CANCELLED' }],
    }, from, to)
    expect(occs).toHaveLength(3)
    expect(occs.some((o) => o.recurrenceId === '20260720T090000Z')).toBe(false)
  })

  it('emits an override moved into the window from an out-of-window slot', () => {
    const occs = expandEvent({
      ...base,
      rrule: 'FREQ=WEEKLY',
      overrides: [{
        recurrence_id: '20260831T090000Z', // original slot in August, after the window
        start: '20260715T090000Z',          // moved into July
        end: '20260715T093000Z',
      }],
    }, from, to)
    const moved = occs.find((o) => o.recurrenceId === '20260831T090000Z')
    expect(moved).toBeDefined()
    expect(moved!.start).toEqual(parseCalDate('20260715T090000Z'))
  })

  it('expands all-day series with date keys and local starts', () => {
    const occs = expandEvent({
      uid: 'a', summary: 'Away', start: '20260706', end: '20260707', all_day: true,
      rrule: 'FREQ=WEEKLY', href: 'x',
    }, from, to)
    expect(occs).toHaveLength(4)
    expect(occs[0].allDay).toBe(true)
    expect(occs[0].key).toBe('D20260706')
    expect(occs[0].recurrenceId).toBe('20260706')
    expect(occs[0].start).toEqual(new Date(2026, 6, 6)) // local midnight
  })

  it('falls back to a single occurrence when the rule is unparseable', () => {
    const occs = expandEvent({ ...base, rrule: 'FREQ=BOGUS' }, from, to)
    expect(occs).toHaveLength(1)
  })
})

describe('edit semantics', () => {
  const weekly: CalEvent = {
    ...base,
    rrule: 'FREQ=WEEKLY',
    exdates: ['20260810T090000Z'],
    overrides: [{ recurrence_id: '20260720T090000Z', summary: 'Moved', start: '20260720T140000Z' }],
  }

  it('keeps overrides on non-schedule series edits, resets them on schedule edits', () => {
    expect(scheduleChanged(weekly, { summary: 'Renamed' })).toBe(false)
    const renamed = applySeriesEdits(weekly, { summary: 'Renamed' })
    expect(renamed.summary).toBe('Renamed')
    expect(renamed.overrides).toHaveLength(1)
    expect(renamed.exdates).toHaveLength(1)

    expect(scheduleChanged(weekly, { start: '20260706T100000Z' })).toBe(true)
    const rescheduled = applySeriesEdits(weekly, { start: '20260706T100000Z', end: '20260706T103000Z' })
    expect(rescheduled.overrides).toBeUndefined()
    expect(rescheduled.exdates).toBeUndefined()

    expect(scheduleChanged(weekly, { rrule: 'FREQ=DAILY' })).toBe(true)
    expect(scheduleChanged(weekly, { rrule: 'FREQ=WEEKLY' })).toBe(false)
    const ruleless = applySeriesEdits(weekly, { rrule: null })
    expect(ruleless.rrule).toBeUndefined()
  })

  it('builds a snapshot override for an occurrence edit and replaces an existing one', () => {
    const occs = expandEvent(weekly, from, to)
    const plain = occs.find((o) => o.recurrenceId === '20260713T090000Z')!
    const next = applyOccurrenceEdits(plain, { summary: 'One-off title', start: '20260713T090000Z', end: '20260713T093000Z' })
    expect(next.overrides).toHaveLength(2)
    const added = next.overrides!.find((o) => o.recurrence_id === '20260713T090000Z')!
    expect(added.summary).toBe('One-off title')
    expect(added.alarms_raw).toBeUndefined() // no master carriers duplicated in

    const already = expandEvent(next, from, to).find((o) => o.override?.summary === 'One-off title')!
    const replaced = applyOccurrenceEdits(already, { summary: 'Again' })
    expect(replaced.overrides).toHaveLength(2) // replaced, not appended
    expect(replaced.overrides!.find((o) => o.recurrence_id === '20260713T090000Z')!.summary).toBe('Again')
  })

  it('removes an occurrence via EXDATE and drops its override', () => {
    const occs = expandEvent(weekly, from, to)
    const moved = occs.find((o) => o.override)!
    const next = removeOccurrence(moved)
    expect(next.exdates).toContain('20260720T090000Z')
    expect(next.overrides).toBeUndefined()
  })

  it('cuts a series with UNTIL just before the chosen slot', () => {
    const occs = expandEvent(weekly, from, to)
    const cutAt = occs.find((o) => o.recurrenceId === '20260720T090000Z')!
    const next = cutSeriesBefore(cutAt)!
    expect(next.rrule).toBe('FREQ=WEEKLY;UNTIL=20260720T085959Z')
    expect(next.overrides).toBeUndefined() // the 20 Jul override is at the cut
    expect(next.exdates).toBeUndefined() // the Aug exdate is after the cut
    const remaining = expandEvent(next, from, to)
    expect(remaining.map((o) => o.recurrenceId)).toEqual(['20260706T090000Z', '20260713T090000Z'])
  })

  it('degrades to a full delete when cutting at the first occurrence', () => {
    const occs = expandEvent(weekly, from, to)
    expect(cutSeriesBefore(occs[0])).toBeNull()
  })
})

describe('splitSeries', () => {
  const weekly: CalEvent = {
    ...base,
    rrule: 'FREQ=WEEKLY',
    exdates: ['20260810T090000Z'],
    overrides: [{ recurrence_id: '20260720T090000Z', summary: 'Moved', start: '20260720T140000Z' }],
  }
  const at = (e: CalEvent, rid: string) =>
    expandEvent(e, from, parseCalDate('20260901T000000Z')!).find((o) => o.recurrenceId === rid)!

  it('returns null at the first occurrence (caller edits the whole series)', () => {
    expect(splitSeries(at(weekly, '20260706T090000Z'), { summary: 'X' }, 'uid2')).toBeNull()
  })

  it('splits on a content edit: truncated master + detached future series', () => {
    const split = splitSeries(at(weekly, '20260713T090000Z'), { summary: 'New era' }, 'uid2')!
    expect(split.truncated.rrule).toBe('FREQ=WEEKLY;UNTIL=20260713T085959Z')
    expect(split.truncated.uid).toBe('ev1')
    expect(split.truncated.overrides).toBeUndefined()
    expect(split.truncated.exdates).toBeUndefined()

    const d = split.detached
    expect(d.uid).toBe('uid2')
    expect(d.etag).toBeUndefined()
    expect(d.start).toBe('20260713T090000Z')
    expect(d.end).toBe('20260713T093000Z')
    expect(d.summary).toBe('New era')
    expect(d.rrule).toBe('FREQ=WEEKLY')
    // The at/after-cut override and exdate moved across verbatim.
    expect(d.overrides).toEqual(weekly.overrides)
    expect(d.exdates).toEqual(['20260810T090000Z'])

    const occs = expandEvent({ ...d, href: 'x' }, from, to)
    expect(occs.map((o) => o.recurrenceId)).toEqual([
      '20260713T090000Z', '20260720T090000Z', '20260727T090000Z',
    ])
    expect(occs[0].fields.summary).toBe('New era')
    expect(occs[1].fields.summary).toBe('Moved') // override snapshot kept
  })

  it('reduces an inherited COUNT by the occurrences kept behind', () => {
    const counted: CalEvent = { ...base, rrule: 'FREQ=WEEKLY;COUNT=10' }
    const split = splitSeries(at(counted, '20260720T090000Z'), {}, 'uid2')!
    expect(split.truncated.rrule).toBe('FREQ=WEEKLY;UNTIL=20260720T085959Z')
    expect(split.detached.rrule).toBe('FREQ=WEEKLY;COUNT=8')
  })

  it('keeps an inherited UNTIL as-is', () => {
    const until: CalEvent = { ...base, rrule: 'FREQ=WEEKLY;UNTIL=20261001T000000Z' }
    const split = splitSeries(at(until, '20260720T090000Z'), {}, 'uid2')!
    expect(split.detached.rrule).toBe('FREQ=WEEKLY;UNTIL=20261001T000000Z')
  })

  it('resets carried overrides/exdates and drops raw times on a time edit', () => {
    const split = splitSeries(
      at(weekly, '20260713T090000Z'),
      { start: '20260713T100000Z', end: '20260713T110000Z' },
      'uid2',
    )!
    const d = split.detached
    expect(d.start).toBe('20260713T100000Z')
    expect(d.end).toBe('20260713T110000Z')
    expect(d.overrides).toBeUndefined()
    expect(d.exdates).toBeUndefined()
    expect(d.start_raw).toBeUndefined()
    expect(d.end_raw).toBeUndefined()
  })

  it('rebases param-carrying raw DTSTART/DTEND lines onto the slot', () => {
    const tzid: CalEvent = {
      ...base,
      start: '20260706T090000',
      end: '20260706T093000',
      start_raw: 'DTSTART;TZID=Europe/Madrid:20260706T090000',
      end_raw: 'DTEND;TZID=Europe/Madrid:20260706T093000',
      rrule: 'FREQ=WEEKLY',
      vtimezones_raw: ['BEGIN:VTIMEZONE\nTZID:Europe/Madrid\nEND:VTIMEZONE'],
    }
    const split = splitSeries(at(tzid, '20260713T090000'), { summary: 'X' }, 'uid2')!
    expect(split.detached.start).toBe('20260713T090000')
    expect(split.detached.start_raw).toBe('DTSTART;TZID=Europe/Madrid:20260713T090000')
    expect(split.detached.end).toBe('20260713T093000')
    expect(split.detached.end_raw).toBe('DTEND;TZID=Europe/Madrid:20260713T093000')
    expect(split.detached.vtimezones_raw).toEqual(tzid.vtimezones_raw)
  })

  it('rebases all-day series by calendar days', () => {
    const allDay: CalEvent = {
      uid: 'a', summary: 'Away', start: '20260706', end: '20260708', all_day: true,
      rrule: 'FREQ=WEEKLY', href: 'x',
    }
    const split = splitSeries(at(allDay, '20260720'), { summary: 'Trip' }, 'uid2')!
    expect(split.truncated.rrule).toBe('FREQ=WEEKLY;UNTIL=20260719')
    expect(split.detached.start).toBe('20260720')
    expect(split.detached.end).toBe('20260722')
  })
})

describe('hasCustomisationsFrom', () => {
  const weekly: CalEvent = {
    ...base,
    rrule: 'FREQ=WEEKLY',
    exdates: ['20260810T090000Z'],
    overrides: [{ recurrence_id: '20260720T090000Z', summary: 'Moved' }],
  }
  const wide = parseCalDate('20260901T000000Z')!

  it('sees overrides and exdates at or after the slot, not before it', () => {
    const occs = expandEvent(weekly, from, wide)
    const early = occs.find((o) => o.recurrenceId === '20260713T090000Z')!
    const late = occs.find((o) => o.recurrenceId === '20260817T090000Z')!
    expect(hasCustomisationsFrom(early)).toBe(true) // 20 Jul override, 10 Aug exdate ahead
    expect(hasCustomisationsFrom(late)).toBe(false) // both behind
  })
})

describe('rrule form conversion', () => {
  it('round-trips the editor vocabulary', () => {
    const cases = [
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=MONTHLY;COUNT=10',
      'FREQ=YEARLY',
      'FREQ=WEEKLY;UNTIL=20260801T235959Z',
    ]
    for (const rule of cases) {
      const form = rruleToForm(rule)
      expect(form, rule).not.toBeNull()
      expect(formToRrule(form!, false)).toBe(rule)
    }
  })

  it('serializes UNTIL as a bare date for all-day series', () => {
    const form = rruleToForm('FREQ=WEEKLY;UNTIL=20260801T235959Z')!
    expect(formToRrule(form, true)).toBe('FREQ=WEEKLY;UNTIL=20260801')
  })

  it('returns null for rules beyond the editor vocabulary', () => {
    expect(rruleToForm('FREQ=MONTHLY;BYMONTHDAY=15')).toBeNull()
    expect(rruleToForm('FREQ=MONTHLY;BYDAY=2FR')).toBeNull()
    expect(rruleToForm('FREQ=HOURLY')).toBeNull()
    expect(rruleToForm('FREQ=YEARLY;BYMONTH=3')).toBeNull()
    expect(rruleToForm('not a rule')).toBeNull()
  })

  it('summarizes rules for humans with a raw fallback', () => {
    expect(rruleSummary('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toMatch(/every 2 weeks on Monday/i)
    expect(rruleSummary(':::')).toBe(':::')
  })
})
