// End-to-end MCP server tests: real backend (MemoryStorage) + MCP server over
// an in-memory transport. Covers identity, collections, events (incl. raw-data
// round-trip), todos, sections, sync, free/busy, sharing and admin.
//
// Sanitizers are off: the reused browser CalDAV client doesn't drain response
// bodies of mutation requests (the browser doesn't require it), which trips
// Deno's resource sanitizer without being a real leak for a test process.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { TestServer } from './conformance/harness.ts'
import { connectMcp } from './mcp_helpers.ts'

Deno.test({
  name: 'MCP: identity, collections, events, todos, sections',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const ts = await TestServer.create()
    const mcp = await connectMcp(ts)
    try {
      await t.step('whoami reports the authenticated admin', async () => {
        const me = await mcp.json('whoami')
        assertEquals(me.username, 'owner')
        assertEquals(me.isAdmin, true)
        assertEquals(me.serverUrl, ts.base)
      })

      await t.step('collection CRUD', async () => {
        let cols = await mcp.json('list_collections')
        assertEquals(cols.map((c: any) => c.ref), ['default'])
        assertEquals(cols[0].myAccess, 'owner')
        assert(!('href' in cols[0]), 'href must be stripped from output')

        await mcp.json('create_collection', {
          name: 'work',
          display_name: 'Work',
          color: '#112233',
          description: 'Work stuff',
        })
        const work = await mcp.json('get_collection', { ref: 'work' })
        assertEquals(work.display_name, 'Work')
        assertEquals(work.color, '#112233')
        assertEquals(work.description, 'Work stuff')

        await mcp.json('update_collection', { ref: 'work', display_name: 'Werk', group: 'Projects' })
        let updated = await mcp.json('get_collection', { ref: 'work' })
        assertEquals(updated.display_name, 'Werk')
        assertEquals(updated.group, 'Projects')

        await mcp.json('update_collection', { ref: 'work', clear_group: true })
        updated = await mcp.json('get_collection', { ref: 'work' })
        assertEquals(updated.group, undefined)

        const missing = await mcp.call('get_collection', { ref: 'nope' })
        assert(missing.isError)
        assertStringIncludes(missing.text, 'Not found (404)')
        assertStringIncludes(missing.text, 'list_collections')

        await mcp.json('delete_collection', { ref: 'work' })
        cols = await mcp.json('list_collections')
        assertEquals(cols.map((c: any) => c.ref), ['default'])
      })

      await t.step('event CRUD with clean output', async () => {
        const { uid } = await mcp.json('create_event', {
          collection: 'default',
          summary: 'Standup',
          start: '20260710T090000Z',
          end: '20260710T091500Z',
          location: 'Room 1',
          categories: ['work'],
        })
        assert(uid)

        const listed = await mcp.json('list_events', { collection: 'default' })
        assertEquals(listed.length, 1)
        const ev = listed[0]
        assertEquals(ev.summary, 'Standup')
        for (const noisy of ['etag', 'href', 'start_raw', 'alarms_raw', 'extra_lines']) {
          assert(!(noisy in ev), `${noisy} must be stripped from output`)
        }

        // ISO input is normalized to iCal compact form.
        await mcp.json('update_event', {
          collection: 'default',
          uid,
          summary: 'Standup (moved)',
          start: '2026-07-10T10:00:00Z',
          end: '2026-07-10T10:15:00Z',
          description: 'Daily',
        })
        let got = await mcp.json('get_event', { collection: 'default', uid })
        assertEquals(got.summary, 'Standup (moved)')
        assertEquals(got.start, '20260710T100000Z')
        assertEquals(got.description, 'Daily')
        assertEquals(got.location, 'Room 1')

        // JSON null clears a field.
        await mcp.json('update_event', { collection: 'default', uid, description: null })
        got = await mcp.json('get_event', { collection: 'default', uid })
        assertEquals(got.description, undefined)

        await mcp.json('delete_event', { collection: 'default', uid })
        assertEquals((await mcp.json('list_events', { collection: 'default' })).length, 0)
      })

      await t.step('MCP edits preserve foreign client data (round-trip)', async () => {
        const path = '/calendars/owner/default/roundtrip-1.ics'
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Foreign//EN',
          'BEGIN:VEVENT',
          'UID:roundtrip-1',
          'DTSTAMP:20260101T000000Z',
          'DTSTART:20260715T100000Z',
          'DTEND:20260715T110000Z',
          'SUMMARY:Original',
          'X-CUSTOM-PROP:keepme',
          'BEGIN:VALARM',
          'ACTION:AUDIO',
          'TRIGGER:-PT30M',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')
        await ts.putObject(path, ics)

        await mcp.json('update_event', { collection: 'default', uid: 'roundtrip-1', summary: 'Renamed' })

        const raw = await ts.do('GET', path)
        assertEquals(raw.status, 200)
        assertStringIncludes(raw.body, 'SUMMARY:Renamed')
        assertStringIncludes(raw.body, 'X-CUSTOM-PROP:keepme')
        assertStringIncludes(raw.body, 'ACTION:AUDIO')
        assertStringIncludes(raw.body, 'TRIGGER:-PT30M')

        await mcp.json('delete_event', { collection: 'default', uid: 'roundtrip-1' })
      })

      await t.step('todo lifecycle', async () => {
        const { uid } = await mcp.json('create_todo', {
          collection: 'default',
          summary: 'Buy milk',
          due: '2026-07-10',
          priority: 3,
        })

        let todos = await mcp.json('list_todos', { collection: 'default' })
        assertEquals(todos.length, 1)
        assertEquals(todos[0].summary, 'Buy milk')
        assertEquals(todos[0].due, '20260710')
        assertEquals(todos[0].priority, 3)
        assert(!('href' in todos[0]))

        await mcp.json('update_todo', {
          collection: 'default',
          uid,
          summary: 'Buy oat milk',
          priority: null,
        })
        todos = await mcp.json('list_todos', { collection: 'default' })
        assertEquals(todos[0].summary, 'Buy oat milk')
        assertEquals(todos[0].priority, undefined)

        await mcp.json('complete_todo', { collection: 'default', uid })
        assertEquals((await mcp.json('list_todos', { collection: 'default' })).length, 0)
        const withDone = await mcp.json('list_todos', { collection: 'default', include_completed: true })
        assertEquals(withDone.length, 1)
        assertEquals(withDone[0].status, 'COMPLETED')

        await mcp.json('delete_todo', { collection: 'default', uid })
        assertEquals(
          (await mcp.json('list_todos', { collection: 'default', include_completed: true })).length,
          0,
        )
      })

      await t.step('move todo between collections', async () => {
        await mcp.json('create_collection', { name: 'errands', display_name: 'Errands' })
        const { uid } = await mcp.json('create_todo', { collection: 'default', summary: 'Post letter' })
        await mcp.json('move_todo', { from: 'default', to: 'errands', uid })
        assertEquals((await mcp.json('list_todos', { collection: 'default' })).length, 0)
        const moved = await mcp.json('list_todos', { collection: 'errands' })
        assertEquals(moved.length, 1)
        assertEquals(moved[0].summary, 'Post letter')
        await mcp.json('delete_collection', { ref: 'errands' })
      })

      await t.step('sections', async () => {
        const { sections } = await mcp.json('set_sections', {
          collection: 'default',
          sections: [{ name: 'Planning' }, { name: 'Doing' }],
        })
        assertEquals(sections.length, 2)
        assert(sections[0].id && sections[1].id, 'ids are auto-generated')

        const fetched = await mcp.json('get_sections', { collection: 'default' })
        assertEquals(fetched.map((s: any) => s.name), ['Planning', 'Doing'])

        const { uid } = await mcp.json('create_todo', {
          collection: 'default',
          summary: 'Plan sprint',
          section_id: sections[0].id,
        })
        const todos = await mcp.json('list_todos', { collection: 'default' })
        assertEquals(todos[0].section_id, sections[0].id)
        await mcp.json('delete_todo', { collection: 'default', uid })
      })
    } finally {
      await mcp.close()
      await ts.shutdown()
    }
  },
})

Deno.test({
  name: 'MCP: sync and free/busy',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const ts = await TestServer.create()
    const mcp = await connectMcp(ts)
    try {
      await t.step('sync token workflow', async () => {
        const initial = await mcp.json('sync_collection', { collection: 'default' })
        assert(initial.sync_token)
        assertEquals(initial.changed.length, 0)
        assertEquals(initial.deleted.length, 0)

        const { uid } = await mcp.json('create_event', {
          collection: 'default',
          summary: 'Sync me',
          start: '20260801T120000Z',
        })
        const delta = await mcp.json('sync_collection', {
          collection: 'default',
          sync_token: initial.sync_token,
        })
        assertEquals(delta.changed.length, 1)
        assertEquals(delta.changed[0].uid, uid)
        assert(!('etag' in delta.changed[0]))

        await mcp.json('delete_event', { collection: 'default', uid })
        const afterDelete = await mcp.json('sync_collection', {
          collection: 'default',
          sync_token: delta.sync_token,
        })
        assertEquals(afterDelete.changed.length, 0)
        assertEquals(afterDelete.deleted, [uid])
      })

      await t.step('sync todos separately from events', async () => {
        const { uid } = await mcp.json('create_todo', { collection: 'default', summary: 'Todo sync' })
        const todosSync = await mcp.json('sync_collection', { collection: 'default', component: 'VTODO' })
        assertEquals(todosSync.changed.length, 1)
        assertEquals(todosSync.changed[0].uid, uid)
        const eventsSync = await mcp.json('sync_collection', { collection: 'default' })
        assertEquals(eventsSync.changed.length, 0)
        await mcp.json('delete_todo', { collection: 'default', uid })
      })

      await t.step('free/busy reports a busy slot', async () => {
        const { uid } = await mcp.json('create_event', {
          collection: 'default',
          summary: 'Busy block',
          start: '20260805T140000Z',
          end: '20260805T150000Z',
        })
        const slots = await mcp.json('query_free_busy', {
          from: '20260805T000000Z',
          to: '20260806T000000Z',
        })
        assertEquals(slots.length, 1)
        assertEquals(slots[0].type, 'BUSY')
        assertEquals(slots[0].start, '20260805T140000Z')
        await mcp.json('delete_event', { collection: 'default', uid })
      })
    } finally {
      await mcp.close()
      await ts.shutdown()
    }
  },
})

Deno.test({
  name: 'MCP: sharing, read-only enforcement, admin',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const ts = await TestServer.create()
    const owner = await connectMcp(ts)
    let alice: Awaited<ReturnType<typeof connectMcp>> | undefined
    try {
      await ts.createUser('alice', 'alice@example.com') // password: testpass
      alice = await connectMcp(ts, 'alice', 'testpass')

      await t.step('search users finds the sharee', async () => {
        const matches = await owner.json('search_users', { query: 'alice' })
        assertEquals(matches.length, 1)
        assertEquals(matches[0].username, 'alice')
      })

      await t.step('share read-only; sharee sees it but cannot write', async () => {
        await owner.json('set_sharees', {
          ref: 'default',
          sharees: [{ username: 'alice', access: 'read' }],
        })
        assertEquals(await owner.json('get_sharees', { ref: 'default' }), [
          { username: 'alice', access: 'read' },
        ])

        const cols = await alice!.json('list_collections')
        const shared = cols.find((c: any) => c.ref === 'owner~default')
        assert(shared, 'alice must see the shared collection')
        assertEquals(shared.myAccess, 'read')
        assertEquals(shared.shared, true)

        const denied = await alice!.call('create_event', {
          collection: 'owner~default',
          summary: 'Intrusion',
          start: '20260810T100000Z',
        })
        assert(denied.isError)
        assertStringIncludes(denied.text, 'read-only')
      })

      await t.step('upgrade to read-write; sharee can write', async () => {
        await owner.json('set_sharees', {
          ref: 'default',
          sharees: [{ username: 'alice', access: 'read-write' }],
        })
        const { uid } = await alice!.json('create_event', {
          collection: 'owner~default',
          summary: 'Pair session',
          start: '20260810T100000Z',
        })
        const events = await owner.json('list_events', { collection: 'default' })
        assertEquals(events.map((e: any) => e.uid), [uid])
        await alice!.json('delete_event', { collection: 'owner~default', uid })
      })

      await t.step('admin user CRUD; non-admin is rejected', async () => {
        const created = await owner.json('create_user', {
          username: 'bob',
          password: 'bobpass',
          display_name: 'Bob',
          timezone: 'Europe/Madrid',
        })
        assertEquals(created.username, 'bob')
        assertEquals(created.isAdmin, false)

        let users = await owner.json('list_users')
        assert(users.some((u: any) => u.username === 'bob'))

        const updated = await owner.json('update_user', { username: 'bob', display_name: 'Bobby' })
        assertEquals(updated.displayName, 'Bobby')

        const denied = await alice!.call('list_users')
        assert(denied.isError)
        assertStringIncludes(denied.text, 'Access denied (403)')

        await owner.json('delete_user', { username: 'bob' })
        users = await owner.json('list_users')
        assert(!users.some((u: any) => u.username === 'bob'))
      })
    } finally {
      await alice?.close()
      await owner.close()
      await ts.shutdown()
    }
  },
})
