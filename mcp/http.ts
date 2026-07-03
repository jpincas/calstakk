// MCP over HTTP: stateless streamable-HTTP endpoint, mounted at /mcp by
// server.ts. Each POST is self-contained: authenticate the Basic credentials
// through the same authenticate() path as every CalDAV route (via an
// in-process /api/me probe), build the standard tool server acting as that
// user, and answer the JSON-RPC message. Tool traffic dispatches straight to
// the in-process CalDAV handler — no loopback HTTP through the public origin.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { parseBasicAuth } from '../src/auth.ts'
import { createCalstakkMcpServer } from './server.ts'
import { installDispatch } from './shims.ts'

/** Synthetic origin marking requests for in-process dispatch (never resolves). */
const INTERNAL_ORIGIN = 'http://calstakk-mcp.internal'

export function createMcpHttpHandler(
  caldavHandler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  installDispatch(INTERNAL_ORIGIN, caldavHandler)

  return async (req: Request): Promise<Response> => {
    // Stateless mode: no server-initiated SSE streams (GET) and no sessions
    // to delete (DELETE) — POST carries everything.
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
    }

    const authorization = req.headers.get('Authorization')
    const probe = await caldavHandler(
      new Request(`${INTERNAL_ORIGIN}/api/me`, {
        headers: authorization ? { Authorization: authorization } : {},
      }),
    )
    await probe.body?.cancel()
    if (probe.status === 401) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="CalStakk"' },
      })
    }

    const creds = parseBasicAuth(authorization)
    const server = createCalstakkMcpServer({
      baseUrl: INTERNAL_ORIGIN,
      displayUrl: new URL(req.url).origin,
      username: creds?.username,
      password: creds?.password,
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — every request is self-contained
      enableJsonResponse: true, // plain JSON responses; no SSE stream needed
    })
    await server.connect(transport)
    return await transport.handleRequest(req)
  }
}
