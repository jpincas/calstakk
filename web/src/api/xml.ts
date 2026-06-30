// Internal XML build/parse utilities. Not part of the public API surface.

import { CalDAVError } from './types'

export const DAV_NS = 'DAV:'
export const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav'
export const APPLE_NS = 'http://apple.com/ns/ical/'

export async function propfind(
  path: string,
  depth: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<Document> {
  const res = await fetch(path, {
    method: 'PROPFIND',
    headers: { 'Content-Type': 'application/xml', Depth: depth, ...extraHeaders },
    body,
  })
  if (!res.ok && res.status !== 207) {
    throw new CalDAVError(res.status, `PROPFIND ${path} failed: ${res.status}`)
  }
  return new DOMParser().parseFromString(await res.text(), 'application/xml')
}

export async function report(
  path: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(path, {
    method: 'REPORT',
    headers: { 'Content-Type': 'application/xml', Depth: '1', ...extraHeaders },
    body,
  })
  if (!res.ok && res.status !== 207) {
    throw new CalDAVError(res.status, `REPORT ${path} failed: ${res.status}`)
  }
  return res.text()
}

/** Get trimmed text content of the first matching namespaced child element. */
export function nsText(el: Element, ns: string, local: string): string {
  return el.getElementsByTagNameNS(ns, local)[0]?.textContent?.trim() ?? ''
}

/** Get the href text inside a namespaced element (looks for DAV:href child). */
export function nsHref(el: Element, ns: string, local: string): string {
  const parent = el.getElementsByTagNameNS(ns, local)[0]
  return parent?.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
}

/** Extract calendar-data text from all multistatus response elements. */
export function extractCalendarData(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagNameNS(CALDAV_NS, 'calendar-data'))
    .map(el => el.textContent ?? '')
    .filter(Boolean)
}

export function calQueryBody(compName: string, fromISO?: string, toISO?: string): string {
  let timeRange = ''
  if (fromISO && toISO) {
    // strip to bare digits+T, then add Z
    const strip = (s: string) => s.replace(/[-:]/g, '').split('.')[0].replace(/Z$/, '')
    timeRange = `<c:time-range start="${strip(fromISO)}Z" end="${strip(toISO)}Z"/>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="${compName}">${timeRange}</c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

export function syncCollectionBody(syncToken: string, props: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:sync-token>${syncToken}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop>${props}</d:prop>
</d:sync-collection>`
}
