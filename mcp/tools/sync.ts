import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CalEvent, Todo } from '@/types/index.ts'
import { run } from '../errors.ts'
import type { Ctx } from '../common.ts'
import { cleanEvent, cleanTodo } from '../clean.ts'
import { refArg } from './collections.ts'

const SyncArgs = z.object({
  collection: refArg,
  sync_token: z.string().optional().describe('Token returned by the previous sync of this collection'),
  component: z
    .enum(['VEVENT', 'VTODO'])
    .optional()
    .describe('Which items to sync: VEVENT = events (default), VTODO = todos'),
})

/** '/calendars/owner/col/uid.ics' → 'uid' */
function hrefToUid(href: string): string {
  const last = href.replace(/\/$/, '').split('/').pop() ?? href
  return decodeURIComponent(last.replace(/\.ics$/, ''))
}

export function registerSyncTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'sync_collection',
    {
      description:
        'Efficiently track changes in a collection. Omit sync_token for the initial full sync; store the ' +
        'returned sync_token and pass it next time to receive only items changed or deleted since. If the ' +
        'token has expired the call fails with a 403 — restart with a full sync.',
      inputSchema: SyncArgs.shape,
    },
    ({ collection, sync_token, component }: z.infer<typeof SyncArgs>) =>
      run(ctx.baseUrl, async () => {
        const comp = component ?? 'VEVENT'
        const result = await ctx.client.syncCollection<CalEvent | Todo>(collection, sync_token, comp)
        return {
          sync_token: result.syncToken,
          changed: result.changed.map((item) =>
            comp === 'VEVENT' ? cleanEvent(item as CalEvent) : cleanTodo(item as Todo)
          ),
          deleted: result.deleted.map(hrefToUid),
        }
      }),
  )
}
