import type { Collection, CalEvent, Todo } from '@/types'
import { CalDAVError, type SyncResult, type FreeBusySlot } from './types'
import { parseICalProps, extractComponent, toICalDateTime, first, all, nowIcal, buildVCalendar } from './ical'
import {
  propfind, report,
  nsText, nsHref, extractCalendarData,
  calQueryBody, syncCollectionBody,
  DAV_NS, CALDAV_NS, APPLE_NS, CS_NS,
} from './xml'

export { CalDAVError }

interface ClientConfig {
  username?: string
  password?: string
}

export class CalDAVClient {
  private authHeader: string | undefined
  private homeSetHref: string | null = null

  constructor(config: ClientConfig = {}) {
    if (config.username && config.password) {
      this.authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`)
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (this.authHeader) return { Authorization: this.authHeader, ...extra }
    return extra
  }

  // ── Discovery ────────────────────────────────────────────────────────────────

  /** Discover and cache the calendar home set path. Called lazily before any collection op. */
  async discover(): Promise<string> {
    if (this.homeSetHref) return this.homeSetHref

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`

    // PROPFIND /.well-known/caldav — server 308-redirects to principal (method preserved)
    const doc = await propfind('/.well-known/caldav', '0', body, this.headers())
    const href = nsHref(doc.documentElement, CALDAV_NS, 'calendar-home-set')
    if (!href) throw new CalDAVError(0, 'Could not discover calendar home set')
    this.homeSetHref = href
    return href
  }

  // ── Collections ─────────────────────────────────────────────────────────────

  async listCollections(): Promise<Collection[]> {
    const home = await this.discover()
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}" xmlns:cs="${CS_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:calendar-description/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:group/>
  </d:prop>
</d:propfind>`
    const doc = await propfind(home, '1', body, this.headers())
    const responses = doc.getElementsByTagNameNS(DAV_NS, 'response')
    const collections: Collection[] = []

    for (const resp of Array.from(responses)) {
      const href = resp.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
      if (!href || href === home || href === home + '/') continue

      const resourceType = resp.getElementsByTagNameNS(DAV_NS, 'resourcetype')[0]
      const isCalendar = resourceType?.getElementsByTagNameNS(CALDAV_NS, 'calendar').length > 0
      if (!isCalendar) continue

      const displayName = nsText(resp, DAV_NS, 'displayname')
      const name = href.replace(/\/$/, '').split('/').pop() ?? ''
      const color = nsText(resp, APPLE_NS, 'calendar-color') || undefined
      const description = nsText(resp, CALDAV_NS, 'calendar-description') || undefined
      const orderStr = nsText(resp, APPLE_NS, 'calendar-order')
      const order = orderStr ? parseInt(orderStr) : undefined
      const group = nsText(resp, CS_NS, 'group') || undefined

      collections.push({ name, display_name: displayName || name, href, color, description, order, group })
    }

    return collections
  }

  async getCollectionProps(name: string): Promise<Collection> {
    const home = await this.discover()
    const path = `${home}/${name}`
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}" xmlns:cs="${CS_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:calendar-description/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:group/>
  </d:prop>
</d:propfind>`
    const doc = await propfind(path, '0', body, this.headers())
    const resp = doc.getElementsByTagNameNS(DAV_NS, 'response')[0]
    if (!resp) throw new CalDAVError(404, `Collection ${name} not found`)
    const displayName = nsText(resp, DAV_NS, 'displayname')
    const color = nsText(resp, APPLE_NS, 'calendar-color') || undefined
    const description = nsText(resp, CALDAV_NS, 'calendar-description') || undefined
    const orderStr = nsText(resp, APPLE_NS, 'calendar-order')
    const order = orderStr ? parseInt(orderStr) : undefined
    const group = nsText(resp, CS_NS, 'group') || undefined
    return { name, display_name: displayName || name, href: path, color, description, order, group }
  }

  async createCollection(
    name: string,
    props: { displayName: string; color?: string; description?: string },
  ): Promise<void> {
    const home = await this.discover()
    const path = `${home}/${name}`
    const descLine = props.description
      ? `<c:calendar-description xmlns:c="${CALDAV_NS}">${escXml(props.description)}</c:calendar-description>`
      : ''
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:set><d:prop>
    <d:displayname>${escXml(props.displayName)}</d:displayname>
    ${descLine}
  </d:prop></d:set>
</c:mkcalendar>`
    const res = await fetch(path, {
      method: 'MKCALENDAR',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (res.status !== 201) throw new CalDAVError(res.status, `MKCALENDAR failed: ${res.status}`)

    if (props.color) {
      await this.updateCollectionProps(name, { color: props.color })
    }
  }

  async updateCollectionProps(
    name: string,
    props: { displayName?: string; color?: string; description?: string; group?: string | null },
  ): Promise<void> {
    const home = await this.discover()
    const path = `${home}/${name}`
    const sets: string[] = []
    const removes: string[] = []
    if (props.displayName !== undefined)
      sets.push(`<d:displayname>${escXml(props.displayName)}</d:displayname>`)
    if (props.color !== undefined)
      sets.push(`<a:calendar-color xmlns:a="${APPLE_NS}">${escXml(props.color)}</a:calendar-color>`)
    if (props.description !== undefined)
      sets.push(`<c:calendar-description xmlns:c="${CALDAV_NS}">${escXml(props.description)}</c:calendar-description>`)
    if (props.group === null) {
      removes.push(`<cs:group xmlns:cs="${CS_NS}"/>`)
    } else if (props.group !== undefined) {
      sets.push(`<cs:group xmlns:cs="${CS_NS}">${escXml(props.group)}</cs:group>`)
    }
    if (sets.length === 0 && removes.length === 0) return

    const setPart = sets.length > 0 ? `<d:set><d:prop>${sets.join('')}</d:prop></d:set>` : ''
    const removePart = removes.length > 0 ? `<d:remove><d:prop>${removes.join('')}</d:prop></d:remove>` : ''
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}">
  ${setPart}${removePart}
</d:propertyupdate>`
    const res = await fetch(path, {
      method: 'PROPPATCH',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (!res.ok && res.status !== 207) throw new CalDAVError(res.status, `PROPPATCH failed: ${res.status}`)
  }

  async deleteCollection(name: string): Promise<void> {
    const home = await this.discover()
    const res = await fetch(`${home}/${name}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok) throw new CalDAVError(res.status, `DELETE collection failed: ${res.status}`)
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  async listEvents(collection: string, opts?: { from?: string; to?: string }): Promise<CalEvent[]> {
    const home = await this.discover()
    const xml = await report(`${home}/${collection}`, calQueryBody('VEVENT', opts?.from, opts?.to), this.headers())
    return extractCalendarData(xml).flatMap(ics => {
      const block = extractComponent(ics, 'VEVENT')
      if (!block) return []
      const p = parseICalProps(block)
      const dtstart = first(p['DTSTART']) ?? ''
      return [buildCalEvent(p, dtstart, `${home}/${collection}`)]
    })
  }

  async getEvent(collection: string, uid: string): Promise<CalEvent> {
    const home = await this.discover()
    const path = objectPath(home, collection, uid)
    const res = await fetch(path, { headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `GET event failed: ${res.status}`)
    const block = extractComponent(await res.text(), 'VEVENT')
    if (!block) throw new CalDAVError(0, 'No VEVENT found')
    const p = parseICalProps(block)
    const dtstart = first(p['DTSTART']) ?? ''
    return buildCalEvent(p, dtstart, `${home}/${collection}`, uid)
  }

  async createEvent(
    collection: string,
    event: Omit<CalEvent, 'href'> & { uid: string; summary: string; start: string },
  ): Promise<void> {
    const home = await this.discover()
    await this._putObject(objectPath(home, collection, event.uid), buildEventIcs(event), 'create')
  }

  async updateEvent(
    collection: string,
    event: Omit<CalEvent, 'href'> & { uid: string; summary: string; start: string },
  ): Promise<void> {
    const home = await this.discover()
    await this._putObject(objectPath(home, collection, event.uid), buildEventIcs(event), 'update')
  }

  async deleteEvent(collection: string, uid: string): Promise<void> {
    const home = await this.discover()
    await this._delete(objectPath(home, collection, uid))
  }

  // ── Todos ────────────────────────────────────────────────────────────────────

  async listTodos(collection: string, opts?: { completed?: boolean }): Promise<Todo[]> {
    const home = await this.discover()
    let filter = ''
    if (opts?.completed === false) {
      filter = '<c:prop-filter name="STATUS"><c:text-match negate-condition="yes">COMPLETED</c:text-match></c:prop-filter>'
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO">${filter}</c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
    const xml = await report(`${home}/${collection}`, body, this.headers())
    return extractCalendarData(xml).flatMap(ics => {
      const block = extractComponent(ics, 'VTODO')
      if (!block) return []
      return [buildTodo(parseICalProps(block), `${home}/${collection}`)]
    })
  }

  async getTodo(collection: string, uid: string): Promise<Todo> {
    const home = await this.discover()
    const path = objectPath(home, collection, uid)
    const res = await fetch(path, { headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `GET todo failed: ${res.status}`)
    const block = extractComponent(await res.text(), 'VTODO')
    if (!block) throw new CalDAVError(0, 'No VTODO found')
    return buildTodo(parseICalProps(block), `${home}/${collection}`, uid)
  }

  async createTodo(
    collection: string,
    todo: Omit<Todo, 'href'> & { uid: string; summary: string },
  ): Promise<void> {
    const home = await this.discover()
    await this._putObject(objectPath(home, collection, todo.uid), buildTodoIcs(todo), 'create')
  }

  async updateTodo(
    collection: string,
    todo: Omit<Todo, 'href'> & { uid: string; summary: string },
  ): Promise<void> {
    const home = await this.discover()
    await this._putObject(objectPath(home, collection, todo.uid), buildTodoIcs(todo), 'update')
  }

  async deleteTodo(collection: string, uid: string): Promise<void> {
    const home = await this.discover()
    await this._delete(objectPath(home, collection, uid))
  }

  // ── Sync ─────────────────────────────────────────────────────────────────────

  /**
   * Delta-sync a collection. Pass a previous syncToken for incremental updates;
   * omit for a full PROPFIND-based initial sync that also returns the new token.
   */
  async syncCollection<T extends CalEvent | Todo>(
    collection: string,
    syncToken?: string,
    compName: 'VEVENT' | 'VTODO' = 'VEVENT',
  ): Promise<SyncResult<T>> {
    const home = await this.discover()
    const path = `${home}/${collection}`

    if (!syncToken) {
      // Full initial sync: PROPFIND with calendar-data to get all items + current token
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><d:sync-token/><d:getetag/><c:calendar-data/></d:prop>
</d:propfind>`
      const doc = await propfind(path, '1', body, this.headers())
      const token = nsText(doc.documentElement, DAV_NS, 'sync-token')
      const xml = new XMLSerializer().serializeToString(doc)
      const items = extractCalendarData(xml).flatMap(ics => {
        const block = extractComponent(ics, compName)
        if (!block) return []
        const p = parseICalProps(block)
        return compName === 'VEVENT'
          ? [buildCalEvent(p, first(p['DTSTART']) ?? '', path) as T]
          : [buildTodo(p, path) as T]
      })
      return { syncToken: token, changed: items, deleted: [] }
    }

    // Incremental delta sync
    const props = `<d:getetag/><c:calendar-data xmlns:c="${CALDAV_NS}"/>`
    const body = syncCollectionBody(syncToken, props)
    const res = await fetch(path, {
      method: 'REPORT',
      headers: this.headers({ 'Content-Type': 'application/xml', Depth: '0' }),
      body,
    })
    if (res.status === 403) throw new CalDAVError(403, 'Sync token expired — perform a full sync')
    if (!res.ok && res.status !== 207) throw new CalDAVError(res.status, `sync-collection failed: ${res.status}`)

    const xml = await res.text()
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const newToken = nsText(doc.documentElement, DAV_NS, 'sync-token')

    const changed: T[] = []
    const deleted: string[] = []

    for (const resp of Array.from(doc.getElementsByTagNameNS(DAV_NS, 'response'))) {
      const href = resp.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
      const status = resp.getElementsByTagNameNS(DAV_NS, 'status')[0]?.textContent ?? ''
      if (status.includes('404')) {
        deleted.push(href)
        continue
      }
      const calData = resp.getElementsByTagNameNS(CALDAV_NS, 'calendar-data')[0]?.textContent ?? ''
      if (!calData) continue
      const block = extractComponent(calData, compName)
      if (!block) continue
      const p = parseICalProps(block)
      changed.push(
        compName === 'VEVENT'
          ? (buildCalEvent(p, first(p['DTSTART']) ?? '', path) as T)
          : (buildTodo(p, path) as T),
      )
    }

    return { syncToken: newToken, changed, deleted }
  }

  // ── Free/Busy ────────────────────────────────────────────────────────────────

  async queryFreeBusy(from: string, to: string): Promise<FreeBusySlot[]> {
    const home = await this.discover()
    const outbox = `${home}/outbox`
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:free-busy-query xmlns:c="${CALDAV_NS}">
  <c:time-range start="${from}" end="${to}"/>
</c:free-busy-query>`
    const res = await fetch(outbox, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (!res.ok) throw new CalDAVError(res.status, `Free/busy query failed: ${res.status}`)
    return parseFreeBusy(await res.text())
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /** PUT a calendar object, sending the correct conditional header for create vs update. */
  private async _putObject(path: string, ics: string, mode: 'create' | 'update'): Promise<void> {
    let etag: string | null = null
    if (mode === 'update') {
      etag = await this._etag(path)
    }
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar' }
    if (etag) headers['If-Match'] = etag
    else headers['If-None-Match'] = '*'

    const res = await fetch(path, {
      method: 'PUT',
      headers: this.headers(headers),
      body: ics,
    })
    if (!res.ok) throw new CalDAVError(res.status, `PUT failed: ${res.status}`)
  }

  private async _delete(path: string): Promise<void> {
    const res = await fetch(path, { method: 'DELETE', headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `DELETE failed: ${res.status}`)
  }

  private async _etag(path: string): Promise<string | null> {
    try {
      const res = await fetch(path, { method: 'HEAD', headers: this.headers() })
      return res.ok ? (res.headers.get('ETag') ?? null) : null
    } catch {
      return null
    }
  }
}

// ── Pure helpers (no class dependency) ──────────────────────────────────────

function objectPath(home: string, collection: string, uid: string): string {
  return `${home}/${collection}/${uid}.ics`
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildCalEvent(
  p: Record<string, string | string[]>,
  dtstart: string,
  collectionHref: string,
  fallbackUid?: string,
): CalEvent {
  const uid = first(p['UID']) ?? fallbackUid ?? ''
  return {
    uid,
    summary: first(p['SUMMARY']) ?? '',
    description: first(p['DESCRIPTION']) ?? undefined,
    start: dtstart,
    end: first(p['DTEND']) ?? undefined,
    duration: first(p['DURATION']) ?? undefined,
    all_day: !dtstart.includes('T'),
    location: first(p['LOCATION']) ?? undefined,
    status: first(p['STATUS']) ?? undefined,
    rrule: first(p['RRULE']) ?? undefined,
    recurrence_id: first(p['RECURRENCE-ID']) ?? undefined,
    href: `${collectionHref}/${uid}.ics`,
  }
}

function buildTodo(
  p: Record<string, string | string[]>,
  collectionHref: string,
  fallbackUid?: string,
): Todo {
  const uid = first(p['UID']) ?? fallbackUid ?? ''
  return {
    uid,
    summary: first(p['SUMMARY']) ?? '',
    description: first(p['DESCRIPTION']) ?? undefined,
    due: first(p['DUE']) ?? undefined,
    status: first(p['STATUS']) ?? undefined,
    priority: first(p['PRIORITY']) ? parseInt(first(p['PRIORITY'])!) : undefined,
    related_to: first(p['RELATED-TO']) ?? undefined,
    categories: all(p['CATEGORIES']).filter(Boolean),
    href: `${collectionHref}/${uid}.ics`,
  }
}

function buildEventIcs(event: Partial<CalEvent> & { uid: string; summary: string; start: string }): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${nowIcal()}`,
    `DTSTART:${toICalDateTime(event.start)}`,
  ]
  if (event.end) lines.push(`DTEND:${toICalDateTime(event.end)}`)
  if (event.duration) lines.push(`DURATION:${event.duration}`)
  if (event.summary) lines.push(`SUMMARY:${event.summary}`)
  if (event.description) lines.push(`DESCRIPTION:${event.description}`)
  if (event.location) lines.push(`LOCATION:${event.location}`)
  if (event.status) lines.push(`STATUS:${event.status}`)
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  if (event.recurrence_id) lines.push(`RECURRENCE-ID:${event.recurrence_id}`)
  lines.push('END:VEVENT')
  return buildVCalendar(lines)
}

function buildTodoIcs(todo: Partial<Todo> & { uid: string; summary: string }): string {
  const lines = [
    'BEGIN:VTODO',
    `UID:${todo.uid}`,
    `DTSTAMP:${nowIcal()}`,
    `SUMMARY:${todo.summary}`,
  ]
  if (todo.description) lines.push(`DESCRIPTION:${todo.description}`)
  if (todo.due) lines.push(`DUE:${toICalDateTime(todo.due)}`)
  if (todo.status) lines.push(`STATUS:${todo.status.toUpperCase()}`)
  if (todo.priority !== undefined) lines.push(`PRIORITY:${todo.priority}`)
  if (todo.related_to) lines.push(`RELATED-TO:${todo.related_to}`)
  lines.push('END:VTODO')
  return buildVCalendar(lines)
}

function parseFreeBusy(icsText: string): FreeBusySlot[] {
  const block = extractComponent(icsText, 'VFREEBUSY')
  if (!block) return []
  const slots: FreeBusySlot[] = []
  const lines = block.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n|\r/)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).toUpperCase()
    const val = line.slice(colon + 1)
    if (!key.startsWith('FREEBUSY')) continue
    const fbType = key.includes(';FBTYPE=')
      ? (key.split(';FBTYPE=')[1].split(';')[0] as FreeBusySlot['type'])
      : 'BUSY'
    for (const period of val.split(',')) {
      const [start, end] = period.split('/')
      if (start && end) slots.push({ start, end, type: fbType })
    }
  }
  return slots
}
