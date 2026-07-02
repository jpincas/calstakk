import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import type { Ctx } from '../common.ts'
import { refArg } from './collections.ts'

const SearchUsersArgs = z.object({ query: z.string() })

const GetShareesArgs = z.object({ ref: refArg })

const SetShareesArgs = z.object({
  ref: refArg,
  sharees: z
    .array(
      z.object({
        username: z.string(),
        access: z.enum(['read', 'read-write']),
      }),
    )
    .describe("Complete new sharee set, e.g. [{username: 'anna', access: 'read-write'}]"),
})

export function registerSharingTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'search_users',
    {
      description: 'Find other users on this server by username or display name (for sharing).',
      inputSchema: SearchUsersArgs.shape,
    },
    ({ query }: z.infer<typeof SearchUsersArgs>) =>
      run(ctx.baseUrl, async () => ctx.client.searchUsers(query)),
  )

  server.registerTool(
    'get_sharees',
    {
      description: 'Who a collection you own is currently shared with, and their access level.',
      inputSchema: GetShareesArgs.shape,
    },
    ({ ref }: z.infer<typeof GetShareesArgs>) =>
      run(ctx.baseUrl, async () => ctx.client.getSharees(ref)),
  )

  server.registerTool(
    'set_sharees',
    {
      description:
        'Replace the FULL sharee list of a collection you own — call get_sharees first and send the complete ' +
        'edited list. An empty list unshares the collection from everyone. Owner only.',
      inputSchema: SetShareesArgs.shape,
    },
    ({ ref, sharees }: z.infer<typeof SetShareesArgs>) =>
      run(ctx.baseUrl, async () => {
        await ctx.client.setSharees(ref, sharees)
        return { ref, sharees }
      }),
  )
}
