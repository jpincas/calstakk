// Maps client/network failures to actionable MCP tool errors.
import { CalDAVError } from '@/api/client.ts'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

/** Successful tool result: pretty-printed JSON payload. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function mapError(e: unknown, baseUrl: string): string {
  if (e instanceof CalDAVError) {
    switch (e.status) {
      case 401:
        return `Authentication failed (401). Check CALSTAKK_USERNAME / CALSTAKK_PASSWORD for the CalStakk server at ${baseUrl}.`
      case 403:
        return `Access denied (403): ${e.message}. This operation needs write access (is the collection shared with you read-only?) or admin rights.`
      case 404:
        return `Not found (404): ${e.message}. Use list_collections to see valid collection refs, and list_events / list_todos to see valid uids.`
      case 412:
        return `Conflict (412): ${e.message}`
      default:
        return `CalDAV error (${e.status || 'protocol'}): ${e.message}`
    }
  }
  if (e instanceof TypeError) {
    return `Cannot reach CalStakk at ${baseUrl} — is the server running (deno task start)? (${e.message})`
  }
  return e instanceof Error ? e.message : String(e)
}

/** Run a tool body, converting any failure into an isError result. */
export async function run(baseUrl: string, fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(mapError(e, baseUrl))
  }
}
