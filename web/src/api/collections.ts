import type { Collection } from '@/types'

const PRINCIPAL = '/calstakk'

// Minimal PROPFIND helper — send the request and parse the multistatus XML.
async function propfind(path: string, depth: string, body: string): Promise<Document> {
  const res = await fetch(path, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml',
      Depth: depth,
    },
    body,
  })
  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPFIND ${path} failed: ${res.status}`)
  }
  const text = await res.text()
  return new DOMParser().parseFromString(text, 'application/xml')
}

function nsText(el: Element, ns: string, local: string): string {
  const child = el.getElementsByTagNameNS(ns, local)[0]
  return child?.textContent?.trim() ?? ''
}

const DAV_NS = 'DAV:'
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav'

export async function listCollections(): Promise<Collection[]> {
  // 1. Find calendar home set.
  const principalDoc = await propfind(PRINCIPAL, '0', `<?xml version="1.0" encoding="UTF-8"?>
    <d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
      <d:prop><c:calendar-home-set/></d:prop>
    </d:propfind>`)

  const homeSetHref = nsText(principalDoc.documentElement, CALDAV_NS, 'calendar-home-set')
    || (() => {
      // Fallback: find the href inside calendar-home-set
      const hs = principalDoc.getElementsByTagNameNS(CALDAV_NS, 'calendar-home-set')[0]
      return hs?.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
    })()

  if (!homeSetHref) {
    throw new Error('Could not find calendar home set')
  }

  // 2. List collections in the home set.
  const homeDoc = await propfind(homeSetHref, '1', `<?xml version="1.0" encoding="UTF-8"?>
    <d:propfind xmlns:d="DAV:">
      <d:prop>
        <d:displayname/>
        <d:resourcetype/>
      </d:prop>
    </d:propfind>`)

  const responses = homeDoc.getElementsByTagNameNS(DAV_NS, 'response')
  const collections: Collection[] = []

  for (const resp of Array.from(responses)) {
    const href = resp.getElementsByTagNameNS(DAV_NS, 'href')[0]?.textContent?.trim() ?? ''
    if (!href || href === homeSetHref || href === homeSetHref + '/') continue

    const resourceType = resp.getElementsByTagNameNS(DAV_NS, 'resourcetype')[0]
    const isCollection = resourceType?.getElementsByTagNameNS(DAV_NS, 'collection').length > 0
    if (!isCollection) continue

    const displayName = nsText(resp, DAV_NS, 'displayname')
    const name = href.replace(/\/$/, '').split('/').pop() ?? ''

    collections.push({
      name,
      display_name: displayName || name,
      href,
    })
  }

  return collections
}
