import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Todo } from '@/types/index.ts'
import { run } from '../errors.ts'
import { assertWritable, toCompact, type Ctx } from '../common.ts'
import { cleanTodo } from '../clean.ts'
import { refArg } from './collections.ts'

const ListTodosArgs = z.object({
  collection: refArg,
  include_completed: z.boolean().optional(),
})

const GetTodoArgs = z.object({ collection: refArg, uid: z.string() })

const CreateTodoArgs = z.object({
  collection: refArg,
  summary: z.string(),
  description: z.string().optional(),
  due: z.string().optional().describe('Due date/datetime: 20260706 or 20260706T170000Z (ISO also accepted)'),
  status: z.enum(['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.number().int().min(1).max(9).optional().describe('1 = highest, 9 = lowest'),
  related_to: z.string().optional().describe('uid of a parent todo (subtask relationship)'),
  categories: z.array(z.string()).optional(),
  url: z.string().optional(),
  section_id: z.string().optional().describe('Section id from get_sections'),
  uid: z.string().optional().describe('Auto-generated when omitted'),
})

// JSON null clears a field (summary cannot be cleared).
const UpdateTodoArgs = z.object({
  collection: refArg,
  uid: z.string(),
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  due: z.string().nullable().optional().describe('Due date/datetime: 20260706 or 20260706T170000Z; null removes it'),
  status: z.enum(['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED']).nullable().optional(),
  priority: z.number().int().min(1).max(9).nullable().optional().describe('1 = highest, 9 = lowest'),
  related_to: z.string().nullable().optional().describe('uid of a parent todo (subtask relationship)'),
  categories: z.array(z.string()).nullable().optional(),
  url: z.string().nullable().optional(),
  section_id: z.string().nullable().optional().describe('Section id from get_sections; null ungroups the todo'),
})

const MoveTodoArgs = z.object({
  from: refArg.describe('Source collection ref'),
  to: refArg.describe('Destination collection ref'),
  uid: z.string(),
})

export function registerTodoTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'list_todos',
    {
      description:
        'List todos in a collection. Completed and cancelled todos are excluded unless include_completed is true.',
      inputSchema: ListTodosArgs.shape,
    },
    ({ collection, include_completed }: z.infer<typeof ListTodosArgs>) =>
      run(ctx.baseUrl, async () => {
        // Filter locally (like the web UI): a server-side STATUS prop-filter
        // would exclude todos that carry no STATUS property at all.
        const todos = await ctx.client.listTodos(collection)
        return todos
          .filter((t) => include_completed || (t.status !== 'COMPLETED' && t.status !== 'CANCELLED'))
          .map(cleanTodo)
      }),
  )

  server.registerTool(
    'get_todo',
    {
      description: 'Fetch one todo by uid.',
      inputSchema: GetTodoArgs.shape,
    },
    ({ collection, uid }: z.infer<typeof GetTodoArgs>) =>
      run(ctx.baseUrl, async () => cleanTodo(await ctx.client.getTodo(collection, uid))),
  )

  server.registerTool(
    'create_todo',
    {
      description: 'Create a todo. Only summary is required. Returns the uid.',
      inputSchema: CreateTodoArgs.shape,
    },
    (args: z.infer<typeof CreateTodoArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, args.collection)
        const uid = args.uid ?? crypto.randomUUID()
        await ctx.client.createTodo(args.collection, {
          uid,
          summary: args.summary,
          description: args.description,
          due: args.due ? toCompact(args.due) : undefined,
          status: args.status,
          priority: args.priority,
          related_to: args.related_to,
          categories: args.categories,
          url: args.url,
          section_id: args.section_id,
        })
        return { uid, created: true }
      }),
  )

  server.registerTool(
    'update_todo',
    {
      description:
        'Update a todo. Omitted fields stay unchanged; JSON null clears a field (summary cannot be cleared).',
      inputSchema: UpdateTodoArgs.shape,
    },
    (args: z.infer<typeof UpdateTodoArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, args.collection)
        const current = await ctx.client.getTodo(args.collection, args.uid)
        const next: Todo = { ...current }
        const keys = [
          'summary', 'description', 'due', 'status', 'priority',
          'related_to', 'categories', 'url', 'section_id',
        ] as const
        let changed = false
        for (const k of keys) {
          if (args[k] !== undefined) {
            ;(next as unknown as Record<string, unknown>)[k] = args[k] ?? undefined
            changed = true
          }
        }
        if (!changed) throw new Error('No fields to update — provide at least one field.')
        if (typeof next.due === 'string') next.due = toCompact(next.due)
        await ctx.client.updateTodo(args.collection, next)
        return { uid: args.uid, updated: true }
      }),
  )

  server.registerTool(
    'complete_todo',
    {
      description: 'Mark a todo as completed.',
      inputSchema: GetTodoArgs.shape,
    },
    ({ collection, uid }: z.infer<typeof GetTodoArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, collection)
        const todo = await ctx.client.getTodo(collection, uid)
        await ctx.client.updateTodo(collection, { ...todo, status: 'COMPLETED' })
        return { uid, completed: true }
      }),
  )

  server.registerTool(
    'delete_todo',
    {
      description: 'Permanently delete a todo.',
      inputSchema: GetTodoArgs.shape,
    },
    ({ collection, uid }: z.infer<typeof GetTodoArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, collection)
        await ctx.client.deleteTodo(collection, uid)
        return { uid, deleted: true }
      }),
  )

  server.registerTool(
    'move_todo',
    {
      description:
        'Move a todo to a different collection (it lands ungrouped there — section and manual order are dropped).',
      inputSchema: MoveTodoArgs.shape,
    },
    ({ from, to, uid }: z.infer<typeof MoveTodoArgs>) =>
      run(ctx.baseUrl, async () => {
        await assertWritable(ctx, from)
        await assertWritable(ctx, to)
        const todo = await ctx.client.getTodo(from, uid)
        await ctx.client.moveTodo(from, to, todo)
        return { uid, moved: true, from, to }
      }),
  )
}
