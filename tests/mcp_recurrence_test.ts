// MCP recurrence tests: expansion plus every edit scope (series, occurrence,
// this_and_future) against a real in-process backend.
//
// Sanitizers off for the same reason as mcp_test.ts: the reused browser client
// doesn't drain mutation response bodies.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { TestServer } from './conformance/harness.ts'
import { connectMcp } from './mcp_helpers.ts'

Deno.test({
  name: 'MCP: recurrence expansion and scoped edits',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const ts = await TestServer.create()
    const mcp = await connectMcp(ts)
    try {
      // Mondays 10:00–11:00 UTC starting 2026-07-06.
      const { uid } = await mcp.json('create_event', {
        collection: 'default',
        summary: 'Weekly sync',
        start: '20260706T100000Z',
        end: '20260706T110000Z',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      })

      await t.step('expand returns one occurrence per slot', async () => {
        const occs = await mcp.json('list_events', {
          collection: 'default',
          from: '20260706',
          to: '20260727', // date-only `to` is inclusive → 4 Mondays
          expand: true,
        })
        assertEquals(occs.length, 4)
        assertEquals(
          occs.map((o: any) => o.recurrence_id),
          ['20260706T100000Z', '20260713T100000Z', '20260720T100000Z', '20260727T100000Z'],
        )
        assert(occs.every((o: any) => o.uid === uid && o.is_recurring))

        const unexpanded = await mcp.json('list_events', { collection: 'default' })
        assertEquals(unexpanded.length, 1)
        assertEquals(unexpanded[0].rrule, 'FREQ=WEEKLY;BYDAY=MO')
      })

      await t.step('scope occurrence creates an override', async () => {
        await mcp.json('update_event', {
          collection: 'default',
          uid,
          scope: 'occurrence',
          recurrence_id: '20260713T100000Z',
          summary: 'Special edition',
          location: 'Big room',
        })
        const master = await mcp.json('get_event', { collection: 'default', uid })
        assertEquals(master.summary, 'Weekly sync')
        assertEquals(master.overrides?.length, 1)
        assertEquals(master.overrides[0].recurrence_id, '20260713T100000Z')

        const occs = await mcp.json('list_events', {
          collection: 'default',
          from: '20260706',
          to: '20260727',
          expand: true,
        })
        const special = occs.find((o: any) => o.recurrence_id === '20260713T100000Z')
        assertEquals(special.summary, 'Special edition')
        assertEquals(special.location, 'Big room')
        assertEquals(special.is_override, true)
        assertEquals(occs.filter((o: any) => o.is_override).length, 1)
      })

      await t.step('scope occurrence delete adds an exdate', async () => {
        await mcp.json('delete_event', {
          collection: 'default',
          uid,
          scope: 'occurrence',
          recurrence_id: '20260720T100000Z',
        })
        const master = await mcp.json('get_event', { collection: 'default', uid })
        assertEquals(master.exdates, ['20260720T100000Z'])

        const occs = await mcp.json('list_events', {
          collection: 'default',
          from: '20260706',
          to: '20260727',
          expand: true,
        })
        assertEquals(
          occs.map((o: any) => o.recurrence_id),
          ['20260706T100000Z', '20260713T100000Z', '20260727T100000Z'],
        )
      })

      let newUid = ''
      await t.step('scope this_and_future splits the series', async () => {
        const result = await mcp.json('update_event', {
          collection: 'default',
          uid,
          scope: 'this_and_future',
          recurrence_id: '20260727T100000Z',
          location: 'New office',
        })
        newUid = result.new_uid
        assert(newUid && newUid !== uid)

        const truncated = await mcp.json('get_event', { collection: 'default', uid })
        assertStringIncludes(truncated.rrule, 'UNTIL=')

        const detached = await mcp.json('get_event', { collection: 'default', uid: newUid })
        assertEquals(detached.start, '20260727T100000Z')
        assertEquals(detached.location, 'New office')
        assertEquals(detached.rrule, 'FREQ=WEEKLY;BYDAY=MO')

        // Old series still stops before the cut; new one carries on.
        const occs = await mcp.json('list_events', {
          collection: 'default',
          from: '20260706',
          to: '20260803',
          expand: true,
        })
        assertEquals(
          occs.map((o: any) => [o.uid, o.recurrence_id]),
          [
            [uid, '20260706T100000Z'],
            [uid, '20260713T100000Z'],
            [newUid, '20260727T100000Z'],
            [newUid, '20260803T100000Z'],
          ],
        )
      })

      await t.step('series schedule change resets customisations', async () => {
        // The truncated original still has its override at 2026-07-13.
        const result = await mcp.json('update_event', {
          collection: 'default',
          uid,
          start: '20260706T140000Z',
          end: '20260706T150000Z',
        })
        assertEquals(result.overrides_reset, true)
        const master = await mcp.json('get_event', { collection: 'default', uid })
        assertEquals(master.start, '20260706T140000Z')
        assertEquals(master.overrides, undefined)
        assertEquals(master.exdates, undefined)
      })

      await t.step('this_and_future delete truncates; at first occurrence deletes all', async () => {
        const cut = await mcp.json('delete_event', {
          collection: 'default',
          uid: newUid,
          scope: 'this_and_future',
          recurrence_id: '20260803T100000Z',
        })
        assertEquals(cut.deleted, true)
        const remaining = await mcp.json('get_event', { collection: 'default', uid: newUid })
        assertStringIncludes(remaining.rrule, 'UNTIL=')

        const all = await mcp.json('delete_event', {
          collection: 'default',
          uid: newUid,
          scope: 'this_and_future',
          recurrence_id: '20260727T100000Z',
        })
        assertStringIncludes(all.note ?? '', 'whole event')
        const listed = await mcp.json('list_events', { collection: 'default' })
        assert(!listed.some((e: any) => e.uid === newUid))
      })

      await t.step('all-day recurrence expands with date-only ids', async () => {
        const { uid: daily } = await mcp.json('create_event', {
          collection: 'default',
          summary: 'Daily ritual',
          start: '20260901',
          rrule: 'FREQ=DAILY;COUNT=3',
        })
        const occs = await mcp.json('list_events', {
          collection: 'default',
          from: '20260901',
          to: '20260910',
          expand: true,
        })
        const dailies = occs.filter((o: any) => o.uid === daily)
        assertEquals(dailies.map((o: any) => o.recurrence_id), ['20260901', '20260902', '20260903'])
        assert(dailies.every((o: any) => o.all_day))
        await mcp.json('delete_event', { collection: 'default', uid: daily })
      })

      await t.step('validation errors are actionable', async () => {
        const noRid = await mcp.call('update_event', {
          collection: 'default',
          uid,
          scope: 'occurrence',
          summary: 'x',
        })
        assert(noRid.isError)
        assertStringIncludes(noRid.text, 'requires recurrence_id')

        const badSlot = await mcp.call('update_event', {
          collection: 'default',
          uid,
          scope: 'occurrence',
          recurrence_id: '20260707T100000Z', // a Tuesday — not in the series
          summary: 'x',
        })
        assert(badSlot.isError)
        assertStringIncludes(badSlot.text, 'no occurrence at')
        assertStringIncludes(badSlot.text, 'expand: true')

        const { uid: plain } = await mcp.json('create_event', {
          collection: 'default',
          summary: 'One-off',
          start: '20261001T100000Z',
        })
        const notRecurring = await mcp.call('update_event', {
          collection: 'default',
          uid: plain,
          scope: 'occurrence',
          recurrence_id: '20261001T100000Z',
          summary: 'x',
        })
        assert(notRecurring.isError)
        assertStringIncludes(notRecurring.text, 'not recurring')
        await mcp.json('delete_event', { collection: 'default', uid: plain })
      })
    } finally {
      await mcp.close()
      await ts.shutdown()
    }
  },
})
