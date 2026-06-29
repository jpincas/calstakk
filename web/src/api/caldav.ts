import type { CalEvent, Todo } from '@/types'

const CALENDAR_HOME = '/calstakk/calendars'
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav'

// --- XML helpers ---

async function report(path: string, body: string): Promise<string> {
  const res = await fetch(path, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml',
      Depth: '1',
    },
    body,
  })
  if (!res.ok && res.status !== 207) {
    throw new Error(`REPORT ${path} failed: ${res.status}`)
  }
  return res.text()
}

function collectionPath(collection: string): string {
  return `${CALENDAR_HOME}/${collection}`
}

function calObjectPath(collection: string, uid: string): string {
  return `${CALENDAR_HOME}/${collection}/${uid}.ics`
}

// Strip iCal compact datetime to bare digits+T, removing any trailing Z.
// Used when building time-range XML: we always add a trailing Z explicitly.
function stripToICalBase(iso: string): string {
  return iso.replace(/[-:]/g, '').split('.')[0].replace(/Z$/, '')
}

// Minimal VCALENDAR REPORT body filtered by component type.
function calQueryBody(compName: string, fromISO?: string, toISO?: string): string {
  let timeRange = ''
  if (fromISO && toISO) {
    const f = stripToICalBase(fromISO)
    const t = stripToICalBase(toISO)
    timeRange = `<c:time-range start="${f}Z" end="${t}Z"/>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="${compName}">${timeRange}</c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

// Parse a raw iCal text response's calendar-data elements.
function extractCalendarData(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const dataEls = doc.getElementsByTagNameNS(CALDAV_NS, 'calendar-data')
  return Array.from(dataEls).map(el => el.textContent ?? '')
}

// Unescape iCal text values: \, → ,  \; → ;  \n → newline  \\ → \
function unescapeIcal(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

// Parse iCal text into a property map. Multi-valued properties accumulate as
// arrays; single-valued produce a string. Property names are stripped of
// parameters (e.g. DTSTART;TZID=X → DTSTART).
function parseICalProps(text: string): Record<string, string | string[]> {
  const props: Record<string, string | string[]> = {}
  // Unfold continuation lines (CRLF + space/tab), then split
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n|\r/)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).split(';')[0].toUpperCase()
    const val = unescapeIcal(line.slice(colon + 1))
    const existing = props[key]
    if (existing === undefined) {
      props[key] = val
    } else if (Array.isArray(existing)) {
      existing.push(val)
    } else {
      props[key] = [existing, val]
    }
  }
  return props
}

// Get first value from a possibly multi-valued property.
function first(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined
  return Array.isArray(v) ? v[0] : v
}

// Get all values from a possibly multi-valued property.
function all(v: string | string[] | undefined): string[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

// Extract the VEVENT/VTODO/VJOURNAL block from a VCALENDAR text.
function extractComponent(ics: string, comp: string): string | null {
  const start = ics.indexOf(`BEGIN:${comp}`)
  const end = ics.indexOf(`END:${comp}`)
  if (start < 0 || end < 0) return null
  return ics.slice(start, end + `END:${comp}`.length)
}

// Fold a single iCal line at 75-octet boundaries per RFC 5545 §3.1.
// Continuation lines are prefixed with a single space.
function foldLine(line: string): string {
  const enc = new TextEncoder()
  const bytes = enc.encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let pos = 0
  while (pos < bytes.length) {
    const limit = pos === 0 ? 75 : 74
    parts.push(new TextDecoder().decode(bytes.slice(pos, pos + limit)))
    pos += limit
  }
  return parts.join('\r\n ')
}

// Convert a datetime string to iCal compact format, preserving UTC/local semantics.
// - Already compact iCal → returned as-is (with or without Z)
// - ISO with Z or numeric offset → UTC compact ("20260512T090000Z")
// - ISO without offset / datetime-local → floating compact ("20260512T090000", no Z)
function toICalDateTime(s: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  // Already iCal compact (with or without trailing Z)
  if (/^\d{8}T\d{6}Z?$/.test(s)) return s
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
  if (hasOffset) {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  }
  // Floating — treat digits as local wall-clock time
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function href(collection: string, uid: string): string {
  return calObjectPath(collection, uid)
}

// Fetch the ETag of an existing calendar object (null if not found).
async function getETag(path: string): Promise<string | null> {
  try {
    const res = await fetch(path, { method: 'HEAD' })
    return res.ok ? (res.headers.get('ETag') ?? null) : null
  } catch {
    return null
  }
}

// --- Events ---

export async function listEvents(collection: string, from?: string, to?: string): Promise<CalEvent[]> {
  const xml = await report(collectionPath(collection), calQueryBody('VEVENT', from, to))
  const dataList = extractCalendarData(xml)
  return dataList.flatMap(ics => {
    const block = extractComponent(ics, 'VEVENT')
    if (!block) return []
    const p = parseICalProps(block)
    const dtstart = first(p['DTSTART']) ?? ''
    return [{
      uid: first(p['UID']) ?? '',
      summary: first(p['SUMMARY']) ?? '',
      description: first(p['DESCRIPTION']) ?? undefined,
      start: dtstart,
      end: first(p['DTEND']) ?? undefined,
      all_day: !dtstart.includes('T'),
      location: first(p['LOCATION']) ?? undefined,
      status: first(p['STATUS']) ?? undefined,
      rrule: first(p['RRULE']) ?? undefined,
      href: href(collection, first(p['UID']) ?? ''),
    } satisfies CalEvent]
  })
}

export async function getEvent(collection: string, uid: string): Promise<CalEvent> {
  const res = await fetch(calObjectPath(collection, uid))
  if (!res.ok) throw new Error(`GET event failed: ${res.status}`)
  const ics = await res.text()
  const block = extractComponent(ics, 'VEVENT')
  if (!block) throw new Error('No VEVENT found')
  const p = parseICalProps(block)
  const dtstart = first(p['DTSTART']) ?? ''
  return {
    uid: first(p['UID']) ?? uid,
    summary: first(p['SUMMARY']) ?? '',
    description: first(p['DESCRIPTION']) ?? undefined,
    start: dtstart,
    end: first(p['DTEND']) ?? undefined,
    all_day: !dtstart.includes('T'),
    location: first(p['LOCATION']) ?? undefined,
    status: first(p['STATUS']) ?? undefined,
    rrule: first(p['RRULE']) ?? undefined,
    href: calObjectPath(collection, uid),
  }
}

export async function deleteCalObject(collection: string, uid: string): Promise<void> {
  const res = await fetch(calObjectPath(collection, uid), { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE failed: ${res.status}`)
}

// Build minimal iCal text for a VEVENT.
export async function putEvent(collection: string, event: Partial<CalEvent> & { uid: string; summary: string; start: string }): Promise<void> {
  const path = calObjectPath(collection, event.uid)
  const etag = await getETag(path)
  const now = stripToICalBase(new Date().toISOString()) + 'Z'
  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalStakk//Web//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toICalDateTime(event.start)}`,
  ]
  if (event.end) rawLines.push(`DTEND:${toICalDateTime(event.end)}`)
  if (event.summary) rawLines.push(`SUMMARY:${event.summary}`)
  if (event.description) rawLines.push(`DESCRIPTION:${event.description}`)
  if (event.location) rawLines.push(`LOCATION:${event.location}`)
  if (event.status) rawLines.push(`STATUS:${event.status}`)
  if (event.rrule) rawLines.push(`RRULE:${event.rrule}`)
  rawLines.push('END:VEVENT', 'END:VCALENDAR')

  const headers: Record<string, string> = { 'Content-Type': 'text/calendar' }
  if (etag) {
    headers['If-Match'] = etag
  } else {
    headers['If-None-Match'] = '*'
  }

  const res = await fetch(path, {
    method: 'PUT',
    headers,
    body: rawLines.map(foldLine).join('\r\n'),
  })
  if (!res.ok) throw new Error(`PUT event failed: ${res.status}`)
}

// --- Todos ---

export async function listTodos(collection: string): Promise<Todo[]> {
  const xml = await report(collectionPath(collection), calQueryBody('VTODO'))
  const dataList = extractCalendarData(xml)
  return dataList.flatMap(ics => {
    const block = extractComponent(ics, 'VTODO')
    if (!block) return []
    const p = parseICalProps(block)
    return [{
      uid: first(p['UID']) ?? '',
      summary: first(p['SUMMARY']) ?? '',
      description: first(p['DESCRIPTION']) ?? undefined,
      due: first(p['DUE']) ?? undefined,
      status: first(p['STATUS']) ?? undefined,
      priority: first(p['PRIORITY']) ? parseInt(first(p['PRIORITY'])!) : undefined,
      related_to: first(p['RELATED-TO']) ?? undefined,
      categories: all(p['CATEGORIES']).filter(Boolean),
      href: href(collection, first(p['UID']) ?? ''),
    } satisfies Todo]
  })
}

export async function putTodo(collection: string, todo: Partial<Todo> & { uid: string; summary: string }): Promise<void> {
  const path = calObjectPath(collection, todo.uid)
  const etag = await getETag(path)
  const now = stripToICalBase(new Date().toISOString()) + 'Z'
  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalStakk//Web//EN',
    'BEGIN:VTODO',
    `UID:${todo.uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${todo.summary}`,
  ]
  if (todo.description) rawLines.push(`DESCRIPTION:${todo.description}`)
  if (todo.due) rawLines.push(`DUE:${toICalDateTime(todo.due)}`)
  if (todo.status) rawLines.push(`STATUS:${todo.status.toUpperCase()}`)
  if (todo.priority !== undefined) rawLines.push(`PRIORITY:${todo.priority}`)
  if (todo.related_to) rawLines.push(`RELATED-TO:${todo.related_to}`)
  rawLines.push('END:VTODO', 'END:VCALENDAR')

  const headers: Record<string, string> = { 'Content-Type': 'text/calendar' }
  if (etag) {
    headers['If-Match'] = etag
  } else {
    headers['If-None-Match'] = '*'
  }

  const res = await fetch(path, {
    method: 'PUT',
    headers,
    body: rawLines.map(foldLine).join('\r\n'),
  })
  if (!res.ok) throw new Error(`PUT todo failed: ${res.status}`)
}
