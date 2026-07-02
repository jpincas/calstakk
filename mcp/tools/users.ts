import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import type { Ctx } from '../common.ts'

const CreateUserArgs = z.object({
  username: z.string(),
  password: z.string(),
  display_name: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional().describe('IANA timezone, e.g. Europe/Madrid'),
})

const UpdateUserArgs = z.object({
  username: z.string(),
  password: z.string().optional(),
  display_name: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
})

const DeleteUserArgs = z.object({ username: z.string() })

export function registerUserTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'list_users',
    {
      description: 'List all user accounts on the server. Admin only.',
      inputSchema: {},
    },
    () => run(ctx.baseUrl, async () => ctx.client.listUsers()),
  )

  server.registerTool(
    'create_user',
    {
      description:
        'Create a user account (lowercase letters/digits/._- username; a default calendar is created for them). Admin only.',
      inputSchema: CreateUserArgs.shape,
    },
    ({ username, password, display_name, email, timezone }: z.infer<typeof CreateUserArgs>) =>
      run(ctx.baseUrl, async () =>
        ctx.client.createUser({ username, password, displayName: display_name, email, timezone })),
  )

  server.registerTool(
    'update_user',
    {
      description: "Update a user's password, display name, email, or timezone. Admin only.",
      inputSchema: UpdateUserArgs.shape,
    },
    ({ username, password, display_name, email, timezone }: z.infer<typeof UpdateUserArgs>) =>
      run(ctx.baseUrl, async () =>
        ctx.client.updateUser(username, { password, displayName: display_name, email, timezone })),
  )

  server.registerTool(
    'delete_user',
    {
      description:
        'Permanently delete a user account and their calendars. The admin account and your own account cannot be deleted. Admin only.',
      inputSchema: DeleteUserArgs.shape,
    },
    ({ username }: z.infer<typeof DeleteUserArgs>) =>
      run(ctx.baseUrl, async () => {
        await ctx.client.deleteUser(username)
        return { username, deleted: true }
      }),
  )
}
