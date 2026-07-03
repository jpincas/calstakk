// End-to-end tests for the MCP-over-HTTP endpoint (/mcp): real backend
// (MemoryStorage) behind the same server.ts-style routing, exercised over
// real HTTP with the official MCP streamable-HTTP client — exactly how a
// remote agent (e.g. Claude Code with --transport http) connects.
//
// Sanitizers are off for the same reason as mcp_test.ts: the reused browser
// CalDAV client doesn't drain response bodies of mutation requests.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHandler } from '../src/protocol.ts'
import { MemoryStorage } from '../src/storage.ts'
import { hashPassword } from '../src/auth.ts'
import { DEFAULT_CALENDAR_NAME } from '../src/types.ts'
import type { Config } from '../src/config.ts'
import { createMcpHttpHandler } from '../mcp/http.ts'

const OWNER = { username: 'owner', password: 'ownerpass' }

interface HttpTestServer {
  base: string
  shutdown: () => Promise<void>
}

/** Boot storage + CalDAV handler + /mcp route, mirroring server.ts wiring. */
async function bootServer(withPassword: boolean): Promise<HttpTestServer> {
  const storage = new MemoryStorage()
  await storage.createUser({
    username: OWNER.username,
    passwordHash: withPassword ? await hashPassword(OWNER.password) : '',
    displayName: 'Test Owner',
    email: 'org@example.com',
    timezone: 'UTC',
    isAdmin: true,
  })
  await storage.createCalendar(OWNER.username, DEFAULT_CALENDAR_NAME, 'Default Calendar')

  const config: Config = {
    server: { host: 'localhost', port: 0, kvPath: undefined, webDir: undefined },
    user: {
      username: OWNER.username,
      password: withPassword ? OWNER.password : '',
      displayName: 'Test Owner',
      email: 'org@example.com',
      timezone: 'UTC',
    },
  }
  const caldavHandler = createHandler(storage, config)
  const mcpHandler = createMcpHttpHandler(caldavHandler)
  const controller = new AbortController()
  const server = Deno.serve({ port: 0, signal: controller.signal, onListen: () => {} }, (req) => {
    if (new URL(req.url).pathname === '/mcp') return mcpHandler(req)
    return caldavHandler(req)
  })
  return {
    base: `http://localhost:${server.addr.port}`,
    shutdown: async () => {
      controller.abort()
      await server.finished
    },
  }
}

/** Connect the official MCP client over streamable HTTP, optionally with Basic auth. */
async function connectHttp(
  base: string,
  auth?: { username: string; password: string },
): Promise<Client> {
  const headers: Record<string, string> = {}
  if (auth) headers.Authorization = 'Basic ' + btoa(`${auth.username}:${auth.password}`)
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers },
  })
  const client = new Client({ name: 'mcp-http-test', version: '0.0.0' })
  await client.connect(transport)
  return client
}

async function callJson<T = any>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
  }
  const text = res.content?.[0]?.text ?? ''
  if (res.isError) throw new Error(`tool ${name} failed: ${text}`)
  return JSON.parse(text) as T
}

Deno.test({
  name: 'MCP over HTTP: Basic auth gate + full tool round-trip',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const ts = await bootServer(true)
    try {
      await t.step('POST without credentials is 401 with a Basic challenge', async () => {
        const res = await fetch(`${ts.base}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        await res.body?.cancel()
        assertEquals(res.status, 401)
        assertStringIncludes(res.headers.get('WWW-Authenticate') ?? '', 'Basic')
      })

      await t.step('POST with wrong credentials is 401', async () => {
        const res = await fetch(`${ts.base}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa('owner:wrongpass'),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        await res.body?.cancel()
        assertEquals(res.status, 401)
      })

      await t.step('GET is 405 (stateless: POST only)', async () => {
        const res = await fetch(`${ts.base}/mcp`, {
          headers: { Authorization: 'Basic ' + btoa(`${OWNER.username}:${OWNER.password}`) },
        })
        await res.body?.cancel()
        assertEquals(res.status, 405)
        assertEquals(res.headers.get('Allow'), 'POST')
      })

      await t.step('official client: initialize + whoami', async () => {
        const client = await connectHttp(ts.base, OWNER)
        try {
          const me = await callJson(client, 'whoami')
          assertEquals(me.username, OWNER.username)
          assertEquals(me.isAdmin, true)
          // displayUrl: the public origin, not the internal dispatch origin.
          assertEquals(me.serverUrl, ts.base)
        } finally {
          await client.close()
        }
      })

      await t.step('todo create → list → delete round-trip', async () => {
        const client = await connectHttp(ts.base, OWNER)
        try {
          const { uid } = await callJson(client, 'create_todo', {
            collection: 'default',
            summary: 'Ship the HTTP MCP endpoint',
            due: '20260710T120000Z',
            priority: 1,
          })
          assert(uid)

          const listed = await callJson(client, 'list_todos', { collection: 'default' })
          assertEquals(listed.length, 1)
          assertEquals(listed[0].summary, 'Ship the HTTP MCP endpoint')
          assertEquals(listed[0].due, '20260710T120000Z')

          await callJson(client, 'delete_todo', { collection: 'default', uid })
          const after = await callJson(client, 'list_todos', { collection: 'default' })
          assertEquals(after.length, 0)
        } finally {
          await client.close()
        }
      })
    } finally {
      await ts.shutdown()
    }
  },
})

Deno.test({
  name: 'MCP over HTTP: no-auth dev server treats requests as the owner',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const ts = await bootServer(false)
    try {
      const client = await connectHttp(ts.base)
      try {
        const me = await callJson(client, 'whoami')
        assertEquals(me.username, OWNER.username)
        assertEquals(me.isAdmin, true)
      } finally {
        await client.close()
      }
    } finally {
      await ts.shutdown()
    }
  },
})
