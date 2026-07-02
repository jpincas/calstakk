import type { Collection, CalEvent, EventFields, EventOverride, Todo, Section, Sharee, Me, UserAccount, PrincipalMatch } from '@/types'
import { CalDAVError, type SyncResult, type FreeBusySlot } from './types'
import {
  parseICalProps, extractComponent, extractComponents, splitSubComponents,
  parseComponentProps, propFirst, propAll, type ParsedProp,
  escapeIcal, unescapeIcal, lineValue, dtLine, unfoldLines,
  toICalDateTime, first, all, nowIcal, buildVCalendar,
} from './ical'
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
  /** Calendar homes of the authenticated user — own home first, then homes with collections shared to them. */
  private homes: string[] | null = null
  private principalHref: string | null = null

  constructor(config: ClientConfig = {}) {
    if (config.username && config.password) {
      this.authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`)
    }
  }

  /** Set or clear the Basic auth credentials. Resets cached discovery state. */
  configure(config: ClientConfig | null): void {
    this.authHeader = config?.username && config?.password
      ? 'Basic ' + btoa(`${config.username}:${config.password}`)
      : undefined
    this.homes = null
    this.principalHref = null
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // X-Requested-With tells the server to answer 401 without a Basic
    // challenge, so the browser never pops its native credentials dialog.
    const base: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' }
    if (this.authHeader) base.Authorization = this.authHeader
    return { ...base, ...extra }
  }

  // ── Discovery ────────────────────────────────────────────────────────────────

  /**
   * Discover and cache the authenticated user's calendar homes. The well-known
   * URL leads to a principal; current-user-principal there identifies *our*
   * principal (RFC 5397), whose calendar-home-set lists the own home first,
   * followed by homes containing collections shared with us.
   */
  async discover(): Promise<string[]> {
    if (this.homes) return this.homes

    // Step 1: find our principal via the well-known entry point
    const cupBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`
    const entry = await propfind('/.well-known/caldav', '0', cupBody, this.headers())
    const principal = nsHref(entry.documentElement, DAV_NS, 'current-user-principal')
    if (!principal) throw new CalDAVError(0, 'Could not discover current-user-principal')
    this.principalHref = principal.replace(/\/$/, '')

    // Step 2: read the calendar-home-set from our principal
    const homeBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`
    const doc = await propfind(this.principalHref, '0', homeBody, this.headers())
    const homeSet = doc.getElementsByTagNameNS(CALDAV_NS, 'calendar-home-set')[0]
    const hrefs = homeSet
      ? Array.from(homeSet.getElementsByTagNameNS(DAV_NS, 'href'))
          .map((h) => (h.textContent ?? '').trim().replace(/\/$/, ''))
          .filter(Boolean)
      : []
    if (hrefs.length === 0) throw new CalDAVError(0, 'Could not discover calendar home set')
    this.homes = hrefs
    return hrefs
  }

  /** The authenticated user's own calendar home. */
  private async ownHome(): Promise<string> {
    return (await this.discover())[0]
  }

  /**
   * Resolve a collection ref to its path. Own collections are referenced by
   * plain name; shared collections by `${owner}~${name}` (see Collection.ref).
   */
  private async colPath(ref: string): Promise<string> {
    const tilde = ref.indexOf('~')
    if (tilde > 0) {
      return `/calendars/${ref.slice(0, tilde)}/${ref.slice(tilde + 1)}`
    }
    return `${await this.ownHome()}/${ref}`
  }

  /** Build the UI ref for a collection in the given home. */
  private refFor(homeOwner: string, name: string, isOwn: boolean): string {
    return isOwn ? name : `${homeOwner}~${name}`
  }

  // ── Collections ─────────────────────────────────────────────────────────────

  async listCollections(): Promise<Collection[]> {
    const homes = await this.discover()
    const ownHome = homes[0]
    const collections: Collection[] = []

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}" xmlns:cs="${CS_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:owner/>
    <d:current-user-privilege-set/>
    <d:acl/>
    <c:calendar-description/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:group/>
  </d:prop>
</d:propfind>`

    for (const home of homes) {
      const isOwn = home === ownHome
      const homeOwner = home.replace(/\/$/, '').split('/').pop() ?? ''
      const doc = await propfind(home, '1', body, this.headers())
      const responses = doc.getElementsByTagNameNS(DAV_NS, 'response')

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

        const myAccess: Collection['myAccess'] = isOwn ? 'owner' : parseAccess(resp)
        const sharedWith = isOwn ? parseSharees(resp, homeOwner) : undefined

        collections.push({
          name,
          display_name: displayName || name,
          href,
          color,
          description,
          order,
          group,
          ref: this.refFor(homeOwner, name, isOwn),
          owner: homeOwner,
          shared: !isOwn,
          myAccess,
          sharedWith,
        })
      }
    }

    return collections
  }

  async getCollectionProps(ref: string): Promise<Collection> {
    const path = await this.colPath(ref)
    const ownHome = await this.ownHome()
    const isOwn = path.startsWith(ownHome + '/')
    const owner = path.split('/').filter(Boolean)[1] ?? ''
    const name = path.replace(/\/$/, '').split('/').pop() ?? ''
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}" xmlns:cs="${CS_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:owner/>
    <d:current-user-privilege-set/>
    <d:acl/>
    <c:calendar-description/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:group/>
  </d:prop>
</d:propfind>`
    const doc = await propfind(path, '0', body, this.headers())
    const resp = doc.getElementsByTagNameNS(DAV_NS, 'response')[0]
    if (!resp) throw new CalDAVError(404, `Collection ${ref} not found`)
    const displayName = nsText(resp, DAV_NS, 'displayname')
    const color = nsText(resp, APPLE_NS, 'calendar-color') || undefined
    const description = nsText(resp, CALDAV_NS, 'calendar-description') || undefined
    const orderStr = nsText(resp, APPLE_NS, 'calendar-order')
    const order = orderStr ? parseInt(orderStr) : undefined
    const group = nsText(resp, CS_NS, 'group') || undefined
    return {
      name,
      display_name: displayName || name,
      href: path,
      color,
      description,
      order,
      group,
      ref,
      owner,
      shared: !isOwn,
      myAccess: isOwn ? 'owner' : parseAccess(resp),
      sharedWith: isOwn ? parseSharees(resp, owner) : undefined,
    }
  }

  async createCollection(
    name: string,
    props: { displayName: string; color?: string; description?: string },
  ): Promise<void> {
    // Collections are always created in the user's own home
    const path = `${await this.ownHome()}/${name}`
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
    const path = await this.colPath(name)
    const sets: string[] = []
    if (props.displayName !== undefined)
      sets.push(`<d:displayname>${escXml(props.displayName)}</d:displayname>`)
    if (props.color !== undefined)
      sets.push(`<a:calendar-color xmlns:a="${APPLE_NS}">${escXml(props.color)}</a:calendar-color>`)
    if (props.description !== undefined)
      sets.push(`<c:calendar-description xmlns:c="${CALDAV_NS}">${escXml(props.description)}</c:calendar-description>`)
    if (props.group !== undefined) {
      // Clearing writes an empty value rather than a d:remove: the server acks
      // remove ops without applying them, and reads already treat '' as unset.
      sets.push(`<cs:group xmlns:cs="${CS_NS}">${escXml(props.group ?? '')}</cs:group>`)
    }
    if (sets.length === 0) return

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}">
  <d:set><d:prop>${sets.join('')}</d:prop></d:set>
</d:propertyupdate>`
    const res = await fetch(path, {
      method: 'PROPPATCH',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (!res.ok && res.status !== 207) throw new CalDAVError(res.status, `PROPPATCH failed: ${res.status}`)
  }

  async deleteCollection(name: string): Promise<void> {
    const res = await fetch(await this.colPath(name), {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok) throw new CalDAVError(res.status, `DELETE collection failed: ${res.status}`)
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  async listEvents(collection: string, opts?: { from?: string; to?: string }): Promise<CalEvent[]> {
    const path = await this.colPath(collection)
    const xml = await report(path, calQueryBody('VEVENT', opts?.from, opts?.to), this.headers())
    return extractCalendarData(xml).flatMap(({ ics, etag }) => {
      const event = parseEventResource(ics, path, undefined, etag)
      return event ? [event] : []
    })
  }

  async getEvent(collection: string, uid: string): Promise<CalEvent> {
    const colPath = await this.colPath(collection)
    const res = await fetch(`${colPath}/${uid}.ics`, { headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `GET event failed: ${res.status}`)
    const event = parseEventResource(await res.text(), colPath, uid, res.headers.get('ETag') ?? undefined)
    if (!event) throw new CalDAVError(0, 'No VEVENT found')
    return event
  }

  async createEvent(
    collection: string,
    event: Omit<CalEvent, 'href'> & { uid: string; summary: string; start: string },
  ): Promise<void> {
    await this._putObject(`${await this.colPath(collection)}/${event.uid}.ics`, buildEventIcs(event), 'create')
  }

  async updateEvent(
    collection: string,
    event: Omit<CalEvent, 'href'> & { uid: string; summary: string; start: string },
  ): Promise<void> {
    await this._putObject(`${await this.colPath(collection)}/${event.uid}.ics`, buildEventIcs(event), 'update', event.etag)
  }

  async deleteEvent(collection: string, uid: string): Promise<void> {
    await this._delete(`${await this.colPath(collection)}/${uid}.ics`)
  }

  // ── Todos ────────────────────────────────────────────────────────────────────

  async listTodos(collection: string, opts?: { completed?: boolean }): Promise<Todo[]> {
    const path = await this.colPath(collection)
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
    const xml = await report(path, body, this.headers())
    return extractCalendarData(xml).flatMap(({ ics }) => {
      const block = extractComponent(ics, 'VTODO')
      if (!block) return []
      return [buildTodo(parseTodoProps(block), path)]
    })
  }

  async getTodo(collection: string, uid: string): Promise<Todo> {
    const colPath = await this.colPath(collection)
    const res = await fetch(`${colPath}/${uid}.ics`, { headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `GET todo failed: ${res.status}`)
    const block = extractComponent(await res.text(), 'VTODO')
    if (!block) throw new CalDAVError(0, 'No VTODO found')
    return buildTodo(parseTodoProps(block), colPath, uid)
  }

  async createTodo(
    collection: string,
    todo: Omit<Todo, 'href'> & { uid: string; summary: string },
  ): Promise<void> {
    await this._putObject(`${await this.colPath(collection)}/${todo.uid}.ics`, buildTodoIcs(todo), 'create')
  }

  async updateTodo(
    collection: string,
    todo: Omit<Todo, 'href'> & { uid: string; summary: string },
  ): Promise<void> {
    await this._putObject(`${await this.colPath(collection)}/${todo.uid}.ics`, buildTodoIcs(todo), 'update')
  }

  async deleteTodo(collection: string, uid: string): Promise<void> {
    await this._delete(`${await this.colPath(collection)}/${uid}.ics`)
  }

  /** Move a todo to a different collection, dropping section/order so it lands ungrouped there. */
  async moveTodo(from: string, to: string, todo: Todo): Promise<void> {
    await this.createTodo(to, { ...todo, section_id: undefined, x_sort_order: undefined })
    await this.deleteTodo(from, todo.uid)
  }

  // ── Sections ─────────────────────────────────────────────────────────────────

  /**
   * Read the ordered section registry for a collection.
   * Stored as a custom dead-property on the collection (cs:sections in CS_NS),
   * containing a JSON array. Returns [] if no sections have been created yet.
   */
  async getSections(collection: string): Promise<Section[]> {
    const path = await this.colPath(collection)
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="${CS_NS}">
  <d:prop><cs:sections/></d:prop>
</d:propfind>`
    const doc = await propfind(path, '0', body, this.headers())
    const resp = doc.getElementsByTagNameNS(DAV_NS, 'response')[0]
    if (!resp) return []
    const raw = nsText(resp, CS_NS, 'sections')
    if (!raw) return []
    try {
      return JSON.parse(raw) as Section[]
    } catch {
      return []
    }
  }

  /**
   * Persist the ordered section registry for a collection via PROPPATCH.
   * Last-write-wins (no ETag); safe for single-user self-hosted deployments.
   */
  async setSections(collection: string, sections: Section[]): Promise<void> {
    const path = await this.colPath(collection)
    const json = escXml(JSON.stringify(sections))
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:cs="${CS_NS}">
  <d:set><d:prop>
    <cs:sections>${json}</cs:sections>
  </d:prop></d:set>
</d:propertyupdate>`
    const res = await fetch(path, {
      method: 'PROPPATCH',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (!res.ok && res.status !== 207) throw new CalDAVError(res.status, `setSections failed: ${res.status}`)
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
    const path = await this.colPath(collection)

    if (!syncToken) {
      // Full initial sync: PROPFIND with calendar-data to get all items + current token
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><d:sync-token/><d:getetag/><c:calendar-data/></d:prop>
</d:propfind>`
      const doc = await propfind(path, '1', body, this.headers())
      const token = nsText(doc.documentElement, DAV_NS, 'sync-token')
      const xml = new XMLSerializer().serializeToString(doc)
      const items = extractCalendarData(xml).flatMap(({ ics, etag }) => {
        if (compName === 'VEVENT') {
          const event = parseEventResource(ics, path, undefined, etag)
          return event ? [event as T] : []
        }
        const block = extractComponent(ics, 'VTODO')
        return block ? [buildTodo(parseTodoProps(block), path) as T] : []
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
      const etag = resp.getElementsByTagNameNS(DAV_NS, 'getetag')[0]?.textContent?.trim() || undefined
      if (compName === 'VEVENT') {
        const event = parseEventResource(calData, path, undefined, etag)
        if (event) changed.push(event as T)
      } else {
        const block = extractComponent(calData, 'VTODO')
        if (block) changed.push(buildTodo(parseTodoProps(block), path) as T)
      }
    }

    return { syncToken: newToken, changed, deleted }
  }

  // ── Free/Busy ────────────────────────────────────────────────────────────────

  /**
   * Busy periods across all of the user's own collections, via the RFC 4791
   * §7.10 free-busy-query REPORT (issued per collection, results merged).
   */
  async queryFreeBusy(from: string, to: string): Promise<FreeBusySlot[]> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:free-busy-query xmlns:c="${CALDAV_NS}">
  <c:time-range start="${from}" end="${to}"/>
</c:free-busy-query>`
    const collections = await this.listCollections()
    const slots: FreeBusySlot[] = []
    for (const col of collections) {
      if (col.shared) continue
      slots.push(...parseFreeBusy(await report(col.href, body, this.headers())))
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start))
  }

  // ── Identity / session ───────────────────────────────────────────────────────

  /** Identity of the authenticated user. Throws CalDAVError(401) when credentials are required. */
  async whoami(): Promise<Me> {
    const res = await fetch('/api/me', { headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `whoami failed: ${res.status}`)
    return (await res.json()) as Me
  }

  // ── Sharing ──────────────────────────────────────────────────────────────────

  /** Search principals by display name / username (RFC 3744 principal-property-search). */
  async searchUsers(query: string): Promise<PrincipalMatch[]> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:principal-property-search xmlns:d="DAV:">
  <d:property-search>
    <d:prop><d:displayname/></d:prop>
    <d:match>${escXml(query)}</d:match>
  </d:property-search>
  <d:prop><d:displayname/></d:prop>
</d:principal-property-search>`
    const res = await fetch('/principals', {
      method: 'REPORT',
      headers: this.headers({ 'Content-Type': 'application/xml', Depth: '0' }),
      body,
    })
    if (!res.ok && res.status !== 207) {
      throw new CalDAVError(res.status, `principal search failed: ${res.status}`)
    }
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
    const matches: PrincipalMatch[] = []
    for (const resp of Array.from(doc.getElementsByTagNameNS(DAV_NS, 'response'))) {
      const href = resp.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
      const username = href.replace(/\/$/, '').split('/').pop() ?? ''
      if (!username) continue
      const displayName = nsText(resp, DAV_NS, 'displayname') || username
      matches.push({ username, displayName })
    }
    return matches.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  /** Current sharees of an owned collection (from its DAV:acl). */
  async getSharees(ref: string): Promise<Sharee[]> {
    const path = await this.colPath(ref)
    const owner = path.split('/').filter(Boolean)[1] ?? ''
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:acl/></d:prop>
</d:propfind>`
    const doc = await propfind(path, '0', body, this.headers())
    const resp = doc.getElementsByTagNameNS(DAV_NS, 'response')[0]
    if (!resp) return []
    return parseSharees(resp, owner) ?? []
  }

  /**
   * Replace the sharee set of an owned collection via the ACL method
   * (RFC 3744 §8.1). The owner's protected ACE is implicit.
   */
  async setSharees(ref: string, sharees: Sharee[]): Promise<void> {
    const path = await this.colPath(ref)
    const aces = sharees.map((s) => {
      const write = s.access === 'read-write' ? '<d:privilege><d:write/></d:privilege>' : ''
      return `<d:ace><d:principal><d:href>/principals/${escXml(s.username)}</d:href></d:principal>` +
        `<d:grant><d:privilege><d:read/></d:privilege>${write}</d:grant></d:ace>`
    }).join('')
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:acl xmlns:d="DAV:">${aces}</d:acl>`
    const res = await fetch(path, {
      method: 'ACL',
      headers: this.headers({ 'Content-Type': 'application/xml' }),
      body,
    })
    if (!res.ok) throw new CalDAVError(res.status, `ACL failed: ${res.status}`)
  }

  // ── User administration (admin only) ─────────────────────────────────────────

  async listUsers(): Promise<UserAccount[]> {
    return this._api('GET', '/api/users')
  }

  async createUser(user: {
    username: string
    password: string
    displayName?: string
    email?: string
    timezone?: string
  }): Promise<UserAccount> {
    return this._api('POST', '/api/users', user)
  }

  async updateUser(
    username: string,
    updates: { password?: string; displayName?: string; email?: string; timezone?: string },
  ): Promise<UserAccount> {
    return this._api('PATCH', `/api/users/${encodeURIComponent(username)}`, updates)
  }

  async deleteUser(username: string): Promise<void> {
    await this._api('DELETE', `/api/users/${encodeURIComponent(username)}`)
  }

  private async _api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      let message = `${method} ${path} failed: ${res.status}`
      try {
        const err = (await res.json()) as { error?: string }
        if (err?.error) message = err.error
      } catch { /* not JSON */ }
      throw new CalDAVError(res.status, message)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * PUT a calendar object. Creates guard against overwrite; updates send
   * If-Match when an ETag is known, so concurrent edits surface as 412.
   */
  private async _putObject(path: string, ics: string, mode: 'create' | 'update', etag?: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar' }
    if (mode === 'create') headers['If-None-Match'] = '*'
    else if (etag) headers['If-Match'] = etag
    const res = await fetch(path, { method: 'PUT', headers: this.headers(headers), body: ics })
    if (res.status === 412) {
      throw new CalDAVError(412, mode === 'create'
        ? 'An item with this ID already exists'
        : 'This item was changed elsewhere — reload and try again')
    }
    if (!res.ok) throw new CalDAVError(res.status, `PUT failed: ${res.status}`)
  }

  private async _delete(path: string): Promise<void> {
    const res = await fetch(path, { method: 'DELETE', headers: this.headers() })
    if (!res.ok) throw new CalDAVError(res.status, `DELETE failed: ${res.status}`)
  }

}

// ── Pure helpers (no class dependency) ──────────────────────────────────────

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Derive read vs read-write from a response's DAV:current-user-privilege-set. */
function parseAccess(resp: Element): 'read' | 'read-write' {
  const cups = resp.getElementsByTagNameNS(DAV_NS, 'current-user-privilege-set')[0]
  if (!cups) return 'read'
  const hasWrite = cups.getElementsByTagNameNS(DAV_NS, 'write').length > 0 ||
    cups.getElementsByTagNameNS(DAV_NS, 'all').length > 0
  return hasWrite ? 'read-write' : 'read'
}

/** Extract sharees from a response's DAV:acl, skipping the owner's protected ACE. */
function parseSharees(resp: Element, owner: string): Sharee[] | undefined {
  const acl = resp.getElementsByTagNameNS(DAV_NS, 'acl')[0]
  if (!acl) return undefined
  const sharees: Sharee[] = []
  for (const ace of Array.from(acl.getElementsByTagNameNS(DAV_NS, 'ace'))) {
    if (ace.getElementsByTagNameNS(DAV_NS, 'protected').length > 0) continue
    const href = nsHref(ace, DAV_NS, 'principal')
    const username = href.replace(/\/$/, '').split('/').pop() ?? ''
    if (!username || username === owner) continue
    const grant = ace.getElementsByTagNameNS(DAV_NS, 'grant')[0]
    const hasWrite = grant ? grant.getElementsByTagNameNS(DAV_NS, 'write').length > 0 : false
    sharees.push({ username, access: hasWrite ? 'read-write' : 'read' })
  }
  return sharees
}

/** Properties the UI models on events; everything else round-trips via extra_lines. */
const MODELED_EVENT_PROPS = new Set([
  'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'DESCRIPTION',
  'LOCATION', 'STATUS', 'TRANSP', 'CATEGORIES', 'URL', 'RRULE', 'EXDATE', 'RECURRENCE-ID',
])

interface ParsedVevent {
  uid?: string
  fields: EventFields
  rrule?: string
  exdates: string[]
  exdatesRaw: string[]
  recurrenceId?: ParsedProp
}

/** Unescaped TEXT value of the first matching property, undefined when absent. */
function textOf(props: ParsedProp[], name: string): string | undefined {
  const v = propFirst(props, name)?.value
  return v === undefined ? undefined : unescapeIcal(v)
}

function parseVevent(block: string): ParsedVevent {
  const { propLines, sub } = splitSubComponents(block)
  const props = parseComponentProps(propLines)
  const dtstart = propFirst(props, 'DTSTART')
  const dtend = propFirst(props, 'DTEND')
  const start = dtstart?.value ?? ''
  const allDay = start.length > 0 && !start.includes('T')

  const categories = propAll(props, 'CATEGORIES')
    .flatMap((p) => p.value.split(/(?<!\\),/))
    .map((c) => unescapeIcal(c).trim())
    .filter(Boolean)

  // The simple reminder is the first DISPLAY alarm with a plain relative
  // (start-anchored, duration-valued) trigger. Everything else stays opaque.
  const alarmsRaw = sub['VALARM'] ?? []
  let reminder: string | undefined
  let reminderIdx: number | undefined
  for (let i = 0; i < alarmsRaw.length; i++) {
    const aProps = parseComponentProps(splitSubComponents(alarmsRaw[i]).propLines)
    const trigger = propFirst(aProps, 'TRIGGER')
    if (
      propFirst(aProps, 'ACTION')?.value.toUpperCase() === 'DISPLAY' &&
      trigger && /^-?P/i.test(trigger.value) &&
      !/RELATED=END/i.test(trigger.params) && !/VALUE=DATE-TIME/i.test(trigger.params)
    ) {
      reminder = trigger.value
      reminderIdx = i
      break
    }
  }

  const extraLines = props.filter((p) => !MODELED_EVENT_PROPS.has(p.name)).map((p) => p.raw)

  const exdateProps = propAll(props, 'EXDATE')
  return {
    uid: propFirst(props, 'UID')?.value,
    rrule: propFirst(props, 'RRULE')?.value,
    exdates: exdateProps
      .flatMap((p) => p.value.split(','))
      .map((s) => s.trim())
      .filter(Boolean),
    exdatesRaw: exdateProps.map((p) => p.raw),
    recurrenceId: propFirst(props, 'RECURRENCE-ID'),
    fields: {
      summary: textOf(props, 'SUMMARY') ?? '',
      description: textOf(props, 'DESCRIPTION'),
      start,
      end: dtend?.value,
      duration: propFirst(props, 'DURATION')?.value,
      all_day: allDay || undefined,
      location: textOf(props, 'LOCATION'),
      status: propFirst(props, 'STATUS')?.value.toUpperCase(),
      transp: propFirst(props, 'TRANSP')?.value.toUpperCase(),
      categories: categories.length ? categories : undefined,
      url: propFirst(props, 'URL')?.value,
      reminder,
      reminder_alarm_index: reminderIdx,
      start_raw: dtstart?.params ? dtstart.raw : undefined,
      end_raw: dtend?.params ? dtend.raw : undefined,
      alarms_raw: alarmsRaw.length ? alarmsRaw : undefined,
      extra_lines: extraLines.length ? extraLines : undefined,
    },
  }
}

/**
 * Parse one calendar object resource: the master VEVENT plus any sibling
 * RECURRENCE-ID override components sharing its UID. Overrides stay sparse —
 * only the properties their component actually carries.
 */
export function parseEventResource(
  ics: string,
  collectionHref: string,
  fallbackUid?: string,
  etag?: string,
): CalEvent | null {
  const blocks = extractComponents(ics, 'VEVENT')
  if (blocks.length === 0) return null
  const parsed = blocks.map(parseVevent)
  const masterIdx = Math.max(0, parsed.findIndex((v) => !v.recurrenceId))
  const master = parsed[masterIdx]
  const uid = master.uid ?? fallbackUid ?? ''

  const masterFields = { ...master.fields }
  // Orphan-override resource (every component has RECURRENCE-ID): keep the
  // "master" component's id line verbatim so it survives a save.
  if (master.recurrenceId) {
    masterFields.extra_lines = [...(masterFields.extra_lines ?? []), master.recurrenceId.raw]
  }

  const overrides: EventOverride[] = parsed
    .filter((v, i) => i !== masterIdx && v.recurrenceId)
    .map((v) => ({
      ...v.fields,
      recurrence_id: v.recurrenceId!.value,
      recurrence_id_raw: v.recurrenceId!.params ? v.recurrenceId!.raw : undefined,
    }))

  const vtimezones = extractComponents(ics, 'VTIMEZONE').map((b) => unfoldLines(b).join('\n'))

  return {
    ...masterFields,
    uid,
    rrule: master.rrule,
    exdates: master.exdates.length ? master.exdates : undefined,
    exdates_raw: master.exdatesRaw.length ? master.exdatesRaw : undefined,
    overrides: overrides.length ? overrides : undefined,
    vtimezones_raw: vtimezones.length ? vtimezones : undefined,
    etag,
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
    url: first(p['URL']) ?? undefined,
    x_sort_order: first(p['X-SORT-ORDER']) ? parseInt(first(p['X-SORT-ORDER'])!) : undefined,
    section_id: first(p['X-SECTION-ID']) ?? undefined,
    href: `${collectionHref}/${uid}.ics`,
  }
}

/** TRIGGER value of a raw alarm block, undefined when it has none. */
function alarmTrigger(block: string): string | undefined {
  const aProps = parseComponentProps(splitSubComponents(block).propLines)
  return propFirst(aProps, 'TRIGGER')?.value
}

/**
 * Reconcile the simple `reminder` field with the raw alarm blocks: an untouched
 * reminder leaves every block byte-identical; a changed one patches only the
 * TRIGGER line of the alarm it came from (or adds/removes a minimal DISPLAY alarm).
 */
function reconcileAlarms(f: Partial<EventFields>): string[] {
  const alarms = [...(f.alarms_raw ?? [])]
  const idx = f.reminder_alarm_index
  if (idx !== undefined && alarms[idx] !== undefined) {
    if (f.reminder === undefined) {
      alarms.splice(idx, 1)
    } else if (f.reminder !== alarmTrigger(alarms[idx])) {
      alarms[idx] = alarms[idx]
        .split('\n')
        .map((l) => (/^TRIGGER[;:]/i.test(l) ? `TRIGGER:${f.reminder}` : l))
        .join('\n')
    }
  } else if (f.reminder) {
    alarms.push(['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${f.reminder}`, 'DESCRIPTION:Reminder', 'END:VALARM'].join('\n'))
  }
  return alarms
}

function emitVevent(
  uid: string,
  f: Partial<EventFields>,
  opts: { rrule?: string; exdates?: string[]; exdatesRaw?: string[]; recurrenceIdLine?: string } = {},
): string[] {
  const allDay = !!f.all_day
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${nowIcal()}`]
  if (opts.recurrenceIdLine) lines.push(opts.recurrenceIdLine)
  if (f.start) lines.push(dtLine('DTSTART', f.start, allDay, f.start_raw))
  if (f.end) lines.push(dtLine('DTEND', f.end, allDay, f.end_raw))
  else if (f.duration) lines.push(`DURATION:${f.duration}`)
  if (f.summary) lines.push(`SUMMARY:${escapeIcal(f.summary)}`)
  if (f.description) lines.push(`DESCRIPTION:${escapeIcal(f.description)}`)
  if (f.location) lines.push(`LOCATION:${escapeIcal(f.location)}`)
  if (f.status) lines.push(`STATUS:${f.status}`)
  if (f.transp) lines.push(`TRANSP:${f.transp}`)
  if (f.url) lines.push(`URL:${f.url}`)
  if (f.categories?.length) lines.push(`CATEGORIES:${f.categories.map(escapeIcal).join(',')}`)
  if (opts.rrule) lines.push(`RRULE:${opts.rrule}`)
  if (opts.exdates?.length) {
    // While the exdates list is untouched, re-emit the original lines so
    // param-carrying (TZID) EXDATEs survive; once edited, write canonically.
    const rawValues = (opts.exdatesRaw ?? [])
      .flatMap((l) => lineValue(l).split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    const untouched = rawValues.length === opts.exdates.length &&
      rawValues.every((v, i) => v === opts.exdates![i])
    if (opts.exdatesRaw?.length && untouched) lines.push(...opts.exdatesRaw)
    else lines.push(allDay ? `EXDATE;VALUE=DATE:${opts.exdates.join(',')}` : `EXDATE:${opts.exdates.join(',')}`)
  }
  for (const extra of f.extra_lines ?? []) lines.push(extra)
  for (const alarm of reconcileAlarms(f)) lines.push(...alarm.split('\n'))
  lines.push('END:VEVENT')
  return lines
}

function recurrenceIdLine(o: EventOverride): string {
  if (o.recurrence_id_raw && lineValue(o.recurrence_id_raw) === o.recurrence_id) return o.recurrence_id_raw
  return o.recurrence_id.includes('T')
    ? `RECURRENCE-ID:${o.recurrence_id}`
    : `RECURRENCE-ID;VALUE=DATE:${o.recurrence_id}`
}

/** Exported for unit tests; not part of the UI-facing API surface. */
export function buildEventIcs(event: Partial<CalEvent> & { uid: string; summary: string; start: string }): string {
  const lines: string[] = []
  for (const tz of event.vtimezones_raw ?? []) lines.push(...tz.split('\n'))
  lines.push(...emitVevent(event.uid, event, { rrule: event.rrule, exdates: event.exdates, exdatesRaw: event.exdates_raw }))
  for (const o of event.overrides ?? []) {
    lines.push(...emitVevent(event.uid, o, { recurrenceIdLine: recurrenceIdLine(o) }))
  }
  return buildVCalendar(lines)
}

/** Parse a VTODO block's top-level properties, keeping nested VALARMs out of them. */
function parseTodoProps(block: string): Record<string, string | string[]> {
  return parseICalProps(splitSubComponents(block).propLines.join('\n'))
}

function buildTodoIcs(todo: Partial<Todo> & { uid: string; summary: string }): string {
  const lines = [
    'BEGIN:VTODO',
    `UID:${todo.uid}`,
    `DTSTAMP:${nowIcal()}`,
    `SUMMARY:${todo.summary}`,
  ]
  if (todo.description) lines.push(`DESCRIPTION:${escapeIcal(todo.description)}`)
  if (todo.due) lines.push(`DUE:${toICalDateTime(todo.due)}`)
  if (todo.status) lines.push(`STATUS:${todo.status.toUpperCase()}`)
  if (todo.priority !== undefined) lines.push(`PRIORITY:${todo.priority}`)
  if (todo.related_to) lines.push(`RELATED-TO:${todo.related_to}`)
  if (todo.url) lines.push(`URL:${todo.url}`)
  if (todo.categories?.length) todo.categories.forEach((c) => lines.push(`CATEGORIES:${escapeIcal(c)}`))
  if (todo.x_sort_order !== undefined) lines.push(`X-SORT-ORDER:${todo.x_sort_order}`)
  if (todo.section_id) lines.push(`X-SECTION-ID:${todo.section_id}`)
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
