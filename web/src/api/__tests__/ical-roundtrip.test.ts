import { describe, it, expect } from 'vitest'
import {
  escapeIcal, unescapeIcal, extractComponents, splitSubComponents,
  parseComponentProps, dtLine, toICalDateTime, unfoldLines,
} from '../ical'
import { parseEventResource, buildEventIcs } from '../client'
import type { CalEvent } from '@/types'

function ics(...componentLines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...componentLines, 'END:VCALENDAR'].join('\r\n')
}

/** Unfolded content lines of a serialized calendar, DTSTAMP/wrapper noise stripped. */
function contentLines(serialized: string): string[] {
  return unfoldLines(serialized).filter(
    (l) => !/^(DTSTAMP:|BEGIN:VCALENDAR|END:VCALENDAR|VERSION:|PRODID:)/.test(l),
  )
}

function parse(icsText: string): CalEvent {
  const e = parseEventResource(icsText, '/calendars/u/work')
  if (!e) throw new Error('no VEVENT parsed')
  return e
}

describe('text escaping', () => {
  it('escapes and unescapes symmetrically', () => {
    const s = 'a,b;c\\d\nnewline'
    expect(unescapeIcal(escapeIcal(s))).toBe(s)
    expect(escapeIcal(s)).toBe('a\\,b\\;c\\\\d\\nnewline')
  })

  it('decodes literal backslash-n correctly (single pass)', () => {
    // "\\n" (escaped backslash + n) must become "\" + "n", not a newline.
    expect(unescapeIcal('a\\\\nb')).toBe('a\\nb')
    expect(unescapeIcal('a\\nb')).toBe('a\nb')
    expect(unescapeIcal('a\\Nb')).toBe('a\nb')
  })
})

describe('component primitives', () => {
  it('extracts every VEVENT in a resource', () => {
    const text = ics('BEGIN:VEVENT', 'UID:1', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:1', 'END:VEVENT')
    expect(extractComponents(text, 'VEVENT')).toHaveLength(2)
  })

  it('pulls nested VALARM out of the parent properties', () => {
    const block = [
      'BEGIN:VEVENT', 'UID:1', 'DTSTART:20260706T090000Z', 'DURATION:PT1H',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Ping', 'DURATION:PT5M', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n')
    const { propLines, sub } = splitSubComponents(block)
    const names = parseComponentProps(propLines).map((p) => p.name)
    expect(names).toEqual(['UID', 'DTSTART', 'DURATION'])
    expect(sub['VALARM']).toHaveLength(1)
    expect(sub['VALARM'][0]).toContain('TRIGGER:-PT15M')
  })

  it('parses params without splitting inside quoted values', () => {
    const [p] = parseComponentProps(['DTSTART;TZID="Odd:Zone";VALUE=DATE-TIME:20260706T090000'])
    expect(p.name).toBe('DTSTART')
    expect(p.params).toBe(';TZID="Odd:Zone";VALUE=DATE-TIME')
    expect(p.value).toBe('20260706T090000')
  })
})

describe('dtLine', () => {
  it('re-emits the raw param-carrying line while the value is untouched', () => {
    const raw = 'DTSTART;TZID=Europe/Madrid:20260706T090000'
    expect(dtLine('DTSTART', '20260706T090000', false, raw)).toBe(raw)
  })

  it('writes canonical form once the value changed', () => {
    const raw = 'DTSTART;TZID=Europe/Madrid:20260706T090000'
    expect(dtLine('DTSTART', '20260706T100000Z', false, raw)).toBe('DTSTART:20260706T100000Z')
  })

  it('emits VALUE=DATE for all-day values', () => {
    expect(dtLine('DTSTART', '20260706', true)).toBe('DTSTART;VALUE=DATE:20260706')
    expect(dtLine('DTEND', '2026-07-07', true)).toBe('DTEND;VALUE=DATE:20260707')
  })
})

describe('toICalDateTime', () => {
  it('passes through compact forms and bare dates', () => {
    expect(toICalDateTime('20260706T090000Z')).toBe('20260706T090000Z')
    expect(toICalDateTime('20260706')).toBe('20260706')
    expect(toICalDateTime('2026-07-06')).toBe('20260706')
  })

  it('converts ISO with offset to UTC compact', () => {
    expect(toICalDateTime('2026-07-06T09:00:00Z')).toBe('20260706T090000Z')
  })
})

describe('parseEventResource', () => {
  it('parses the modeled fields and unescapes text', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z', 'DTEND:20260706T100000Z',
      'SUMMARY:Lunch\\, then walk', 'DESCRIPTION:line1\\nline2', 'LOCATION:Caf\\;e',
      'STATUS:confirmed', 'TRANSP:TRANSPARENT', 'URL:https://example.com/x',
      'CATEGORIES:home,errands\\,urgent',
      'END:VEVENT',
    ))
    expect(e.uid).toBe('ev1')
    expect(e.summary).toBe('Lunch, then walk')
    expect(e.description).toBe('line1\nline2')
    expect(e.location).toBe('Caf;e')
    expect(e.status).toBe('CONFIRMED')
    expect(e.transp).toBe('TRANSPARENT')
    expect(e.categories).toEqual(['home', 'errands,urgent'])
    expect(e.all_day).toBeUndefined()
  })

  it('splits EXDATE comma-lists and merges multiple lines', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'RRULE:FREQ=DAILY',
      'EXDATE:20260707T090000Z,20260708T090000Z', 'EXDATE:20260710T090000Z',
      'END:VEVENT',
    ))
    expect(e.exdates).toEqual(['20260707T090000Z', '20260708T090000Z', '20260710T090000Z'])
  })

  it('keeps overrides sparse — no inheritance from the master', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'DTEND:20260706T100000Z',
      'SUMMARY:Standup', 'LOCATION:Room 1', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:ev1', 'RECURRENCE-ID:20260713T090000Z',
      'DTSTART:20260713T100000Z', 'DTEND:20260713T110000Z', 'SUMMARY:Standup (moved)', 'END:VEVENT',
    ))
    expect(e.overrides).toHaveLength(1)
    const o = e.overrides![0]
    expect(o.recurrence_id).toBe('20260713T090000Z')
    expect(o.summary).toBe('Standup (moved)')
    expect(o.location).toBeUndefined()
  })

  it('detects the simple reminder without leaking alarm props into the event', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'SUMMARY:Call',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Ping', 'END:VALARM',
      'END:VEVENT',
    ))
    expect(e.reminder).toBe('-PT15M')
    expect(e.reminder_alarm_index).toBe(0)
    expect(e.description).toBeUndefined() // VALARM's DESCRIPTION must not leak
    expect(e.duration).toBeUndefined()
  })

  it('ignores EMAIL and end-anchored alarms for the simple reminder', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'SUMMARY:Call',
      'BEGIN:VALARM', 'ACTION:EMAIL', 'TRIGGER:-PT30M', 'DESCRIPTION:d', 'SUMMARY:s', 'ATTENDEE:mailto:a@b.c', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=END:-PT5M', 'DESCRIPTION:d', 'END:VALARM',
      'END:VEVENT',
    ))
    expect(e.reminder).toBeUndefined()
    expect(e.alarms_raw).toHaveLength(2)
  })

  it('keeps unmodeled properties as verbatim extra lines', () => {
    const e = parse(ics(
      'BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'SUMMARY:X',
      'CLASS:PRIVATE', 'PRIORITY:5', 'SEQUENCE:3', 'X-FOO;X-BAR=1:custom',
      'END:VEVENT',
    ))
    expect(e.extra_lines).toEqual(['CLASS:PRIVATE', 'PRIORITY:5', 'SEQUENCE:3', 'X-FOO;X-BAR=1:custom'])
  })
})

describe('round-trip fidelity', () => {
  const FOREIGN = ics(
    'BEGIN:VTIMEZONE', 'TZID:Europe/Madrid', 'BEGIN:STANDARD', 'DTSTART:19701025T030000',
    'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:ev1', 'DTSTAMP:20260101T000000Z',
    'DTSTART;TZID=Europe/Madrid:20260706T090000', 'DTEND;TZID=Europe/Madrid:20260706T100000',
    'SUMMARY:Reuni\\,on', 'CLASS:PRIVATE', 'X-APPLE-COLOR:blue',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Madrid:20260713T090000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=START:-PT10M', 'DESCRIPTION:Custom ping', 'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:ev1', 'RECURRENCE-ID;TZID=Europe/Madrid:20260720T090000',
    'DTSTART;TZID=Europe/Madrid:20260720T110000', 'DTEND;TZID=Europe/Madrid:20260720T120000',
    'SUMMARY:Reuni\\,on (moved)', 'END:VEVENT',
  )

  it('an untouched save preserves every foreign line', () => {
    const e = parse(FOREIGN)
    const out = contentLines(buildEventIcs(e))
    for (const line of contentLines(FOREIGN)) {
      expect(out).toContain(line)
    }
    expect(out.filter((l) => l.startsWith('BEGIN:VEVENT'))).toHaveLength(2)
    expect(out.filter((l) => l.startsWith('BEGIN:VTIMEZONE'))).toHaveLength(1)
  })

  it('editing the start drops TZID only for that property', () => {
    const e = parse(FOREIGN)
    e.start = '20260706T080000Z'
    const out = contentLines(buildEventIcs(e))
    expect(out).toContain('DTSTART:20260706T080000Z')
    expect(out).toContain('DTEND;TZID=Europe/Madrid:20260706T100000')
  })

  it('changing the reminder patches only the TRIGGER line of its alarm', () => {
    const e = parse(FOREIGN)
    expect(e.reminder).toBe('-PT10M')
    e.reminder = '-PT30M'
    const out = contentLines(buildEventIcs(e))
    expect(out).toContain('TRIGGER:-PT30M')
    expect(out).toContain('DESCRIPTION:Custom ping')
    expect(out).not.toContain('TRIGGER;RELATED=START:-PT10M')
  })

  it('clearing the reminder removes only its alarm block', () => {
    const e = parse(FOREIGN)
    e.reminder = undefined
    const out = buildEventIcs(e)
    expect(out).not.toContain('BEGIN:VALARM')
  })

  it('a new reminder appends a minimal DISPLAY alarm', () => {
    const e = parse(ics('BEGIN:VEVENT', 'UID:ev1', 'DTSTART:20260706T090000Z', 'SUMMARY:X', 'END:VEVENT'))
    e.reminder = '-PT5M'
    const out = contentLines(buildEventIcs(e))
    expect(out).toContain('BEGIN:VALARM')
    expect(out).toContain('ACTION:DISPLAY')
    expect(out).toContain('TRIGGER:-PT5M')
    expect(out).toContain('DESCRIPTION:Reminder')
  })

  it('serializes all-day events with matching VALUE=DATE start and end', () => {
    const out = contentLines(buildEventIcs({
      uid: 'ev2', summary: 'Away', start: '20260706', end: '20260708', all_day: true,
    }))
    expect(out).toContain('DTSTART;VALUE=DATE:20260706')
    expect(out).toContain('DTEND;VALUE=DATE:20260708')
  })

  it('escapes edited text fields and categories on write', () => {
    const out = contentLines(buildEventIcs({
      uid: 'ev3', summary: 'a, b; c', start: '20260706T090000Z',
      description: 'l1\nl2', categories: ['x,y', 'z'],
    }))
    expect(out).toContain('SUMMARY:a\\, b\\; c')
    expect(out).toContain('DESCRIPTION:l1\\nl2')
    expect(out).toContain('CATEGORIES:x\\,y,z')
  })

  it('writes EXDATE as one line in the master DTSTART form', () => {
    const timed = contentLines(buildEventIcs({
      uid: 'e', summary: 'S', start: '20260706T090000Z', rrule: 'FREQ=DAILY',
      exdates: ['20260707T090000Z', '20260708T090000Z'],
    }))
    expect(timed).toContain('EXDATE:20260707T090000Z,20260708T090000Z')
    const allday = contentLines(buildEventIcs({
      uid: 'e', summary: 'S', start: '20260706', all_day: true, rrule: 'FREQ=DAILY', exdates: ['20260707'],
    }))
    expect(allday).toContain('EXDATE;VALUE=DATE:20260707')
  })

  it('emits overrides with their RECURRENCE-ID and no RRULE', () => {
    const out = buildEventIcs({
      uid: 'e', summary: 'S', start: '20260706T090000Z', rrule: 'FREQ=WEEKLY',
      overrides: [{ recurrence_id: '20260713T090000Z', summary: 'Moved', start: '20260713T110000Z', end: '20260713T120000Z' }],
    })
    const lines = contentLines(out)
    expect(lines).toContain('RECURRENCE-ID:20260713T090000Z')
    expect(lines.filter((l) => l.startsWith('RRULE'))).toHaveLength(1)
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
  })
})
