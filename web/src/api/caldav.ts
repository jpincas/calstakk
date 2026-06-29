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

// Minimal VCALENDAR REPORT body filtered by component type.
function calQueryBody(compName: string, fromISO?: string, toISO?: string): string {
  let timeRange = ''
  if (fromISO && toISO) {
    const f = fromISO.replace(/[-:]/g, '').split('.')[0]
    const t = toISO.replace(/[-:]/g, '').split('.')[0]
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

// Very minimal iCal text → property map parser.
// Unescape iCal text values: \, → ,  \; → ;  \n → newline  \\ → \
function unescapeIcal(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseICalProps(text: string): Record<string, string> {
  const props: Record<string, string> = {}
  // Unfold continuation lines (CRLF + space/tab), then split
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n|\r/)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).split(';')[0].toUpperCase()
    props[key] = unescapeIcal(line.slice(colon + 1))
  }
  return props
}

// Extract the VEVENT/VTODO/VJOURNAL block from a VCALENDAR text.
function extractComponent(ics: string, comp: string): string | null {
  const start = ics.indexOf(`BEGIN:${comp}`)
  const end = ics.indexOf(`END:${comp}`)
  if (start < 0 || end < 0) return null
  return ics.slice(start, end + `END:${comp}`.length)
}

function href(collection: string, uid: string): string {
  return calObjectPath(collection, uid)
}

// --- Events ---

export async function listEvents(collection: string, from?: string, to?: string): Promise<CalEvent[]> {
  const xml = await report(collectionPath(collection), calQueryBody('VEVENT', from, to))
  const dataList = extractCalendarData(xml)
  return dataList.flatMap(ics => {
    const block = extractComponent(ics, 'VEVENT')
    if (!block) return []
    const p = parseICalProps(block)
    return [{
      uid: p['UID'] ?? '',
      summary: p['SUMMARY'] ?? '',
      description: p['DESCRIPTION'] ?? undefined,
      start: p['DTSTART'] ?? '',
      end: p['DTEND'] ?? undefined,
      all_day: !p['DTSTART']?.includes('T'),
      location: p['LOCATION'] ?? undefined,
      status: p['STATUS'] ?? undefined,
      rrule: p['RRULE'] ?? undefined,
      href: href(collection, p['UID'] ?? ''),
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
  return {
    uid: p['UID'] ?? uid,
    summary: p['SUMMARY'] ?? '',
    description: p['DESCRIPTION'] ?? undefined,
    start: p['DTSTART'] ?? '',
    end: p['DTEND'] ?? undefined,
    all_day: !p['DTSTART']?.includes('T'),
    location: p['LOCATION'] ?? undefined,
    status: p['STATUS'] ?? undefined,
    rrule: p['RRULE'] ?? undefined,
    href: calObjectPath(collection, uid),
  }
}

export async function deleteCalObject(collection: string, uid: string): Promise<void> {
  const res = await fetch(calObjectPath(collection, uid), { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE failed: ${res.status}`)
}

// Build minimal iCal text for a VEVENT.
export async function putEvent(collection: string, event: Partial<CalEvent> & { uid: string; summary: string; start: string }): Promise<void> {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalStakk//Web//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${event.start.replace(/[-:]/g, '').split('.')[0]}Z`,
  ]
  if (event.end) lines.push(`DTEND:${event.end.replace(/[-:]/g, '').split('.')[0]}Z`)
  if (event.summary) lines.push(`SUMMARY:${event.summary}`)
  if (event.description) lines.push(`DESCRIPTION:${event.description}`)
  if (event.location) lines.push(`LOCATION:${event.location}`)
  if (event.status) lines.push(`STATUS:${event.status}`)
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  const res = await fetch(calObjectPath(collection, event.uid), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar' },
    body: lines.join('\r\n'),
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
      uid: p['UID'] ?? '',
      summary: p['SUMMARY'] ?? '',
      description: p['DESCRIPTION'] ?? undefined,
      due: p['DUE'] ?? undefined,
      status: p['STATUS'] ?? undefined,
      priority: p['PRIORITY'] ? parseInt(p['PRIORITY']) : undefined,
      related_to: p['RELATED-TO'] ?? undefined,
      href: href(collection, p['UID'] ?? ''),
    } satisfies Todo]
  })
}

export async function putTodo(collection: string, todo: Partial<Todo> & { uid: string; summary: string }): Promise<void> {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalStakk//Web//EN',
    'BEGIN:VTODO',
    `UID:${todo.uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${todo.summary}`,
  ]
  if (todo.description) lines.push(`DESCRIPTION:${todo.description}`)
  if (todo.due) lines.push(`DUE:${todo.due.replace(/[-:]/g, '').split('.')[0]}Z`)
  if (todo.status) lines.push(`STATUS:${todo.status.toUpperCase()}`)
  if (todo.priority !== undefined) lines.push(`PRIORITY:${todo.priority}`)
  if (todo.related_to) lines.push(`RELATED-TO:${todo.related_to}`)
  lines.push('END:VTODO', 'END:VCALENDAR')

  const res = await fetch(calObjectPath(collection, todo.uid), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar' },
    body: lines.join('\r\n'),
  })
  if (!res.ok) throw new Error(`PUT todo failed: ${res.status}`)
}

