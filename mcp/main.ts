// CalStakk MCP server — stdio entry point.
//
// Env (loaded from .env.local / .env by `deno task mcp`):
//   CALSTAKK_URL       target server origin (default http://127.0.0.1:5232)
//   CALSTAKK_USERNAME  acting user (omit with password for a no-auth dev server)
//   CALSTAKK_PASSWORD  acting user's password
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCalstakkMcpServer } from './server.ts'

const baseUrl = (Deno.env.get('CALSTAKK_URL') ?? 'http://127.0.0.1:5232').replace(/\/+$/, '')
const username = Deno.env.get('CALSTAKK_USERNAME') || undefined
const password = Deno.env.get('CALSTAKK_PASSWORD') || undefined

const server = createCalstakkMcpServer({ baseUrl, username, password })
await server.connect(new StdioServerTransport())
console.error(
  `calstakk mcp: serving ${baseUrl} ${username && password ? `as ${username}` : '(no auth)'}`,
)
