// Shared wiring for the MCP integration tests: a real in-process backend
// (conformance TestServer) with the MCP server attached over an in-memory
// transport, exercised through the official MCP client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { TestServer } from './conformance/harness.ts'
import { createCalstakkMcpServer } from '../mcp/server.ts'

export const OWNER = { username: 'owner', password: 'ownerpass' }

export interface McpTestClient {
  /** Call a tool; returns the raw text payload and the isError flag. */
  call: (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>
  /** Call a tool expecting success; returns the parsed JSON payload. */
  json: <T = any>(name: string, args?: Record<string, unknown>) => Promise<T>
  close: () => Promise<void>
}

export async function connectMcp(
  ts: TestServer,
  username = OWNER.username,
  password = OWNER.password,
): Promise<McpTestClient> {
  const server = createCalstakkMcpServer({ baseUrl: ts.base, username, password })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'mcp-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    return { text: res.content?.[0]?.text ?? '', isError: res.isError === true }
  }

  const json = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { text, isError } = await call(name, args)
    if (isError) throw new Error(`tool ${name} failed: ${text}`)
    return JSON.parse(text) as T
  }

  return {
    call,
    json,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}
