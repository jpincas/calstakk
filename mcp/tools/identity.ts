import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import type { Ctx } from '../common.ts'

export function registerIdentityTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'whoami',
    {
      description:
        'Identity of the authenticated CalStakk user (username, display name, email, timezone, admin flag) ' +
        'plus the server URL. Also serves as a connectivity/credentials check.',
      inputSchema: {},
    },
    () =>
      run(ctx.baseUrl, async () => {
        const me = await ctx.client.whoami()
        return { ...me, serverUrl: ctx.baseUrl }
      }),
  )
}
