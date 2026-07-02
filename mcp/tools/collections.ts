import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import type { Ctx } from '../common.ts'
import { cleanCollection } from '../clean.ts'

export const refArg = z.string().describe(
  "Collection ref from list_collections: the plain name for your own collections, 'owner~name' for collections shared with you.",
)

const GetCollectionArgs = z.object({ ref: refArg })

const CreateCollectionArgs = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, underscore and dash only')
    .describe('URL-safe identifier, e.g. "work" — becomes the collection ref'),
  display_name: z.string().describe('Human-readable name shown in UIs'),
  color: z.string().optional().describe('CSS hex color, e.g. #3B82F6'),
  description: z.string().optional(),
})

const UpdateCollectionArgs = z.object({
  ref: refArg,
  display_name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  group: z.string().optional().describe('Sidebar group label'),
  clear_group: z.boolean().optional().describe('Remove the collection from its group'),
})

export function registerCollectionTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'list_collections',
    {
      description:
        'List every calendar/todo collection visible to you — your own plus those shared with you. ' +
        'Call this first: the returned `ref` identifies a collection in every other tool. ' +
        "`myAccess` is 'owner', 'read-write', or 'read'; 'read' collections cannot be modified. " +
        'Each collection can hold both events (VEVENT) and todos (VTODO).',
      inputSchema: {},
    },
    () =>
      run(ctx.baseUrl, async () => (await ctx.client.listCollections()).map(cleanCollection)),
  )

  server.registerTool(
    'get_collection',
    {
      description: 'Properties of one collection (display name, color, description, group, access, sharees).',
      inputSchema: GetCollectionArgs.shape,
    },
    ({ ref }: z.infer<typeof GetCollectionArgs>) =>
      run(ctx.baseUrl, async () => cleanCollection(await ctx.client.getCollectionProps(ref))),
  )

  server.registerTool(
    'create_collection',
    {
      description:
        'Create a new collection in your own calendar home. `name` becomes the ref; pick a short URL-safe slug.',
      inputSchema: CreateCollectionArgs.shape,
    },
    ({ name, display_name, color, description }: z.infer<typeof CreateCollectionArgs>) =>
      run(ctx.baseUrl, async () => {
        await ctx.client.createCollection(name, { displayName: display_name, color, description })
        return { ref: name, created: true }
      }),
  )

  server.registerTool(
    'update_collection',
    {
      description:
        'Update collection properties (display name, color, description, sidebar group). Owner only. ' +
        'Omitted fields are left unchanged; set clear_group to remove the group.',
      inputSchema: UpdateCollectionArgs.shape,
    },
    ({ ref, display_name, color, description, group, clear_group }: z.infer<typeof UpdateCollectionArgs>) =>
      run(ctx.baseUrl, async () => {
        await ctx.client.updateCollectionProps(ref, {
          displayName: display_name,
          color,
          description,
          group: clear_group ? null : group,
        })
        return { ref, updated: true }
      }),
  )

  server.registerTool(
    'delete_collection',
    {
      description:
        'Permanently delete a collection AND all events/todos inside it. Owner only; cannot be undone.',
      inputSchema: GetCollectionArgs.shape,
    },
    ({ ref }: z.infer<typeof GetCollectionArgs>) =>
      run(ctx.baseUrl, async () => {
        await ctx.client.deleteCollection(ref)
        return { ref, deleted: true }
      }),
  )
}
