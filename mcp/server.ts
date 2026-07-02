// CalStakk MCP server factory: wires the reused web CalDAV client (via the
// runtime shims) to the full tool catalog. Transport-agnostic — main.ts
// connects it to stdio, tests to an in-memory transport.
//
// stdio discipline: nothing in mcp/ may write to stdout (console.log) — that
// corrupts the MCP protocol stream. Diagnostics go to console.error.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CalDAVClient } from '@/api/client.ts'
import { installShims } from './shims.ts'
import type { Ctx } from './common.ts'
import { registerIdentityTools } from './tools/identity.ts'
import { registerCollectionTools } from './tools/collections.ts'
import { registerEventTools } from './tools/events.ts'
import { registerTodoTools } from './tools/todos.ts'
import { registerSectionTools } from './tools/sections.ts'
import { registerSyncTools } from './tools/sync.ts'
import { registerFreeBusyTools } from './tools/freebusy.ts'
import { registerSharingTools } from './tools/sharing.ts'
import { registerUserTools } from './tools/users.ts'

export interface McpOptions {
  /** Origin of the CalStakk server, e.g. http://127.0.0.1:5232 */
  baseUrl: string
  /** Acting user; omit both for a no-auth dev server. */
  username?: string
  password?: string
}

export function createCalstakkMcpServer(opts: McpOptions): McpServer {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  installShims(baseUrl)

  const client = new CalDAVClient({ username: opts.username, password: opts.password })
  const ctx: Ctx = { client, baseUrl }

  const server = new McpServer({ name: 'calstakk', version: '1.0.0' })
  registerIdentityTools(server, ctx)
  registerCollectionTools(server, ctx)
  registerEventTools(server, ctx)
  registerTodoTools(server, ctx)
  registerSectionTools(server, ctx)
  registerSyncTools(server, ctx)
  registerFreeBusyTools(server, ctx)
  registerSharingTools(server, ctx)
  registerUserTools(server, ctx)
  return server
}
