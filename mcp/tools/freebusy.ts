import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import { toCompactUtc, type Ctx } from '../common.ts'

const FreeBusyArgs = z.object({
  from: z.string().describe('Window start: 20260101T000000Z (a date-only value means midnight UTC)'),
  to: z.string().describe('Window end, same forms'),
})

export function registerFreeBusyTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'query_free_busy',
    {
      description:
        'Busy periods across ALL of your calendars in a time window (RFC 4791 free-busy). Gaps between the ' +
        'returned slots are free time. Events marked TRANSPARENT do not count as busy.',
      inputSchema: FreeBusyArgs.shape,
    },
    ({ from, to }: z.infer<typeof FreeBusyArgs>) =>
      run(ctx.baseUrl, async () => ctx.client.queryFreeBusy(toCompactUtc(from), toCompactUtc(to))),
  )
}
