// Runtime adapters that let the browser-targeted CalDAV client (web/src/api)
// run under Deno: XML parser globals and absolute-URL fetch.
//
// The fetch wrapper holds a single module-level base, so one process can only
// target one CalStakk server — fine for a dedicated stdio MCP process and for
// tests, which all point at one in-process TestServer. The HTTP endpoint
// (mcp/http.ts) always uses one synthetic origin per process, so the
// single-base rule holds there too.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

let currentBase: string | null = null
let dispatch: { origin: string; handler: (req: Request) => Promise<Response> } | null = null
let fetchWrapped = false

/**
 * Install the DOMParser/XMLSerializer globals the client's XML layer expects,
 * and wrap fetch so the client's root-relative paths ('/api/me', discovered
 * hrefs) resolve against `baseUrl`. Absolute URLs pass through untouched.
 * Idempotent; a repeat call just re-points the base URL.
 */
export function installShims(baseUrl: string): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.DOMParser) g.DOMParser = DOMParser
  if (!g.XMLSerializer) g.XMLSerializer = XMLSerializer

  currentBase = baseUrl.replace(/\/+$/, '')
  wrapFetchOnce()
}

/**
 * Route fetches of `origin`-prefixed URLs straight to an in-process handler
 * instead of the network. Lets the deployed server host the MCP tools without
 * looping HTTP requests back through its own public origin. Idempotent; a
 * repeat call just re-points the target.
 */
export function installDispatch(
  origin: string,
  handler: (req: Request) => Promise<Response>,
): void {
  dispatch = { origin: origin.replace(/\/+$/, ''), handler }
  wrapFetchOnce()
}

function wrapFetchOnce(): void {
  if (fetchWrapped) return
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
    let target = input
    if (typeof target === 'string' && target.startsWith('/') && currentBase) {
      target = currentBase + target
    }
    if (dispatch && typeof target === 'string' && target.startsWith(dispatch.origin)) {
      return dispatchWithRedirects(dispatch, target, init)
    }
    return realFetch(target, init)
  }) as typeof fetch
  fetchWrapped = true
}

/**
 * In-process dispatch with fetch-like redirect following, which Request
 * handlers don't do on their own. The server only issues 308 (well-known),
 * which preserves method and body, so re-dispatching the same init is correct.
 */
async function dispatchWithRedirects(
  d: NonNullable<typeof dispatch>,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let res = await d.handler(new Request(url, init))
  for (let hops = 0; hops < 5; hops++) {
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get('Location')
    if (!location || !location.startsWith(d.origin)) return res
    await res.body?.cancel()
    res = await d.handler(new Request(location, init))
  }
  return res
}
