import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { run } from '../errors.ts'
import { assertWritable, type Ctx } from '../common.ts'
import { refArg } from './collections.ts'

const GetSectionsArgs = z.object({ collection: refArg })

const SetSectionsArgs = z.object({
  collection: refArg,
  sections: z.array(
    z.object({
      id: z.string().optional().describe('Keep the existing id; omit for a new section'),
      name: z.string(),
    }),
  ),
})

export function registerSectionTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'get_sections',
    {
      description:
        "A collection's ordered section registry (named groups for its todos). Todos reference sections via section_id.",
      inputSchema: GetSectionsArgs.shape,
    },
    ({ collection }: z.infer<typeof GetSectionsArgs>) =>
      run(ctx.baseUrl, async () => ctx.client.getSections(collection)),
  )

  server.registerTool(
    'set_sections',
    {
      description:
        "Replace a collection's ENTIRE ordered section registry — call get_sections first and send the full " +
        'edited list (order matters). Keep existing ids to preserve todo membership; omit id on new sections to ' +
        'auto-generate one. Todos pointing at a removed section keep their section_id but show ungrouped.',
      inputSchema: SetSectionsArgs.shape,
    },
    ({ collection, sections }: z.infer<typeof SetSectionsArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, collection)
        const full = sections.map((s) => ({ id: s.id ?? crypto.randomUUID(), name: s.name }))
        await ctx.client.setSections(collection, full)
        return { collection, sections: full }
      }),
  )
}
