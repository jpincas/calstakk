/**
 * Dev data seed script. Run with:
 *   ~/.deno/bin/deno run --allow-net scripts/seed.ts
 *
 * Wipes existing non-inbox collections and creates a rich set of
 * collections, events, and todos for UI development.
 */

const BASE = 'http://localhost:5232'
const USER = 'calstakk'
const HOME = `${BASE}/calendars/${USER}`
const CS_NS = 'https://calstakk.dev/ns/'

// ── iCal helpers ────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').toUpperCase()
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
}

/** Offset from today (2026-06-30) by days, return YYYYMMDD */
function date(offsetDays: number): string {
  const d = new Date('2026-06-30')
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Offset from today by days + time, return YYYYMMDDTHHMMSSz */
function dt(offsetDays: number, hour: number, minute = 0): string {
  const d = new Date('2026-06-30')
  d.setDate(d.getDate() + offsetDays)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
}

function vevent(fields: {
  uid?: string; summary: string; start: string; end?: string
  description?: string; location?: string; status?: string; allDay?: boolean
}): string {
  const u = fields.uid ?? uid()
  const s = stamp()
  const lines = ['BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`]
  if (fields.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fields.start}`)
    if (fields.end) lines.push(`DTEND;VALUE=DATE:${fields.end}`)
  } else {
    lines.push(`DTSTART:${fields.start}`)
    if (fields.end) lines.push(`DTEND:${fields.end}`)
  }
  lines.push(`SUMMARY:${fields.summary}`)
  if (fields.description) lines.push(`DESCRIPTION:${fields.description}`)
  if (fields.location) lines.push(`LOCATION:${fields.location}`)
  if (fields.status) lines.push(`STATUS:${fields.status}`)
  lines.push('END:VEVENT')
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//Seed//EN\r\n${lines.join('\r\n')}\r\nEND:VCALENDAR\r\n`
}

function vtodo(fields: {
  uid?: string; summary: string; due?: string; status?: string
  priority?: number; description?: string; categories?: string
}): string {
  const u = fields.uid ?? uid()
  const s = stamp()
  const lines = ['BEGIN:VTODO', `UID:${u}`, `DTSTAMP:${s}`]
  lines.push(`SUMMARY:${fields.summary}`)
  if (fields.due) lines.push(`DUE:${fields.due}`)
  if (fields.status) lines.push(`STATUS:${fields.status}`)
  if (fields.priority !== undefined) lines.push(`PRIORITY:${fields.priority}`)
  if (fields.description) lines.push(`DESCRIPTION:${fields.description}`)
  if (fields.categories) lines.push(`CATEGORIES:${fields.categories}`)
  lines.push('END:VTODO')
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//Seed//EN\r\n${lines.join('\r\n')}\r\nEND:VCALENDAR\r\n`
}

// ── CalDAV helpers ───────────────────────────────────────────────────────────

async function mkcalendar(name: string, displayName: string, color?: string): Promise<void> {
  const path = `${HOME}/${name}`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set><d:prop>
    <d:displayname>${displayName}</d:displayname>
  </d:prop></d:set>
</c:mkcalendar>`
  const res = await fetch(path, { method: 'MKCALENDAR', headers: { 'Content-Type': 'application/xml' }, body })
  if (res.status !== 201 && res.status !== 405) {
    console.warn(`  MKCALENDAR ${name}: ${res.status}`)
  }

  if (color) {
    await proppatch(name, `<a:calendar-color xmlns:a="http://apple.com/ns/ical/">${color}</a:calendar-color>`)
  }
}

async function proppatch(name: string, setPropXml: string): Promise<void> {
  const path = `${HOME}/${name}`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:">
  <d:set><d:prop>${setPropXml}</d:prop></d:set>
</d:propertyupdate>`
  await fetch(path, { method: 'PROPPATCH', headers: { 'Content-Type': 'application/xml' }, body })
}

async function setGroup(name: string, group: string): Promise<void> {
  await proppatch(name, `<cs:group xmlns:cs="${CS_NS}">${group}</cs:group>`)
}

async function putObject(collection: string, icsUid: string, ics: string): Promise<void> {
  const path = `${HOME}/${collection}/${icsUid}.ics`
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: ics,
  })
  if (!res.ok && res.status !== 412) {
    console.warn(`  PUT ${collection}/${icsUid}: ${res.status}`)
  }
}

async function deleteCollection(name: string): Promise<void> {
  await fetch(`${HOME}/${name}`, { method: 'DELETE' })
}

async function listCollections(): Promise<string[]> {
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`
  const res = await fetch(HOME, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body })
  const text = await res.text()
  const matches = [...text.matchAll(/<D:href>([^<]+)<\/D:href>/g)]
  return matches
    .map(m => m[1].replace(/\/$/, '').split('/').pop()!)
    .filter(n => n && n !== USER)
}

// ── Seed data ────────────────────────────────────────────────────────────────

const COLLECTIONS = [
  { name: 'work',     display: 'Work',            color: '#6366F1', group: 'Professional' },
  { name: 'learning', display: 'Learning',         color: '#8B5CF6', group: 'Professional' },
  { name: 'personal', display: 'Personal',         color: '#10B981', group: 'Life' },
  { name: 'health',   display: 'Health',            color: '#F59E0B', group: 'Life' },
  { name: 'home',     display: 'Home',             color: '#E35E5E', group: 'Life' },
]

const EVENTS: Array<{ collection: string; fields: Parameters<typeof vevent>[0] }> = [
  // ── Work events ──
  { collection: 'work', fields: { summary: 'Daily standup', start: dt(0, 9, 30), end: dt(0, 9, 45), location: 'Zoom' } },
  { collection: 'work', fields: { summary: 'Product review', start: dt(0, 14), end: dt(0, 15, 30), description: 'Q3 roadmap review with stakeholders', location: 'Conf Room B' } },
  { collection: 'work', fields: { summary: 'Sprint planning', start: dt(1, 10), end: dt(1, 12), description: 'Plan sprint 24 tasks and story points' } },
  { collection: 'work', fields: { summary: 'Daily standup', start: dt(1, 9, 30), end: dt(1, 9, 45), location: 'Zoom' } },
  { collection: 'work', fields: { summary: '1:1 with Sarah', start: dt(2, 11), end: dt(2, 11, 30), description: 'Bi-weekly check-in' } },
  { collection: 'work', fields: { summary: 'Daily standup', start: dt(2, 9, 30), end: dt(2, 9, 45), location: 'Zoom' } },
  { collection: 'work', fields: { summary: 'Architecture review', start: dt(3, 13), end: dt(3, 15), description: 'New microservices proposal for auth layer' } },
  { collection: 'work', fields: { summary: 'Team offsite', start: date(7), end: date(9), allDay: true, description: 'Q3 team strategy offsite in Barcelona' } },
  { collection: 'work', fields: { summary: 'Quarterly business review', start: dt(14, 9), end: dt(14, 17), location: 'HQ London', description: 'All-hands QBR — full day' } },
  { collection: 'work', fields: { summary: 'Code freeze', start: date(10), end: date(11), allDay: true } },
  { collection: 'work', fields: { summary: 'Daily standup', start: dt(-1, 9, 30), end: dt(-1, 9, 45) } },
  { collection: 'work', fields: { summary: 'Client demo — Acme Corp', start: dt(-2, 15), end: dt(-2, 16), status: 'CONFIRMED', location: 'Google Meet' } },
  { collection: 'work', fields: { summary: 'Retrospective', start: dt(-3, 14), end: dt(-3, 15), description: 'Sprint 23 retro' } },

  // ── Learning events ──
  { collection: 'learning', fields: { summary: 'Rust workshop: ownership & lifetimes', start: dt(0, 18), end: dt(0, 20) } },
  { collection: 'learning', fields: { summary: 'System design study group', start: dt(3, 19), end: dt(3, 20, 30), description: 'Chapter 7: Distributed caches' } },
  { collection: 'learning', fields: { summary: 'TypeScript deep dive — generics', start: dt(5, 19), end: dt(5, 21) } },
  { collection: 'learning', fields: { summary: 'Book club: Designing Data-Intensive Applications', start: dt(-4, 18), end: dt(-4, 19, 30) } },

  // ── Personal events ──
  { collection: 'personal', fields: { summary: "Anna's birthday dinner", start: dt(4, 19, 30), end: dt(4, 22), location: 'Casa Bonita, Shoreditch', description: 'Book a table — reservation confirmed' } },
  { collection: 'personal', fields: { summary: 'Weekend in Edinburgh', start: date(5), end: date(8), allDay: true } },
  { collection: 'personal', fields: { summary: 'Cinema — new Villeneuve film', start: dt(2, 20), end: dt(2, 22, 30), location: 'Curzon Soho' } },
  { collection: 'personal', fields: { summary: 'Dentist', start: dt(-1, 10, 30), end: dt(-1, 11), location: 'Smile Dental, EC1' } },
  { collection: 'personal', fields: { summary: 'Catch-up with James', start: dt(8, 12), end: dt(8, 13, 30), location: 'Flat Iron, Covent Garden' } },

  // ── Health events ──
  { collection: 'health', fields: { summary: 'Morning run', start: dt(0, 7), end: dt(0, 7, 45), description: '8km easy pace' } },
  { collection: 'health', fields: { summary: 'Strength training', start: dt(1, 7), end: dt(1, 8), location: 'PureGym London Bridge' } },
  { collection: 'health', fields: { summary: 'GP annual check-up', start: dt(6, 9, 30), end: dt(6, 10), location: 'Brunswick Health Centre' } },
  { collection: 'health', fields: { summary: 'Morning run', start: dt(-1, 7), end: dt(-1, 7, 40) } },
  { collection: 'health', fields: { summary: 'Physio session', start: dt(9, 11), end: dt(9, 12), location: 'City Physio, EC2' } },

  // ── Home events ──
  { collection: 'home', fields: { summary: 'Broadband engineer visit', start: dt(1, 8), end: dt(1, 12), description: 'BT engineer — stay home' } },
  { collection: 'home', fields: { summary: 'Landlord inspection', start: dt(13, 14), end: dt(13, 15) } },
]

const TODOS: Array<{ collection: string; fields: Parameters<typeof vtodo>[0] }> = [
  // ── Work todos ──
  { collection: 'work', fields: { summary: 'Write technical spec for auth refactor', priority: 1, due: date(3), description: 'Cover OAuth2 flows, token storage, and migration path' } },
  { collection: 'work', fields: { summary: 'Review 3 open PRs in queue', priority: 2, due: date(1) } },
  { collection: 'work', fields: { summary: 'Update API docs after v2 release', priority: 3, due: date(5) } },
  { collection: 'work', fields: { summary: 'Set up staging environment for new service', priority: 2, due: date(7) } },
  { collection: 'work', fields: { summary: 'Fix flaky integration test in CI', priority: 1, due: date(2) } },
  { collection: 'work', fields: { summary: 'Migrate legacy config to env vars', priority: 5 } },
  { collection: 'work', fields: { summary: 'Draft Q3 OKRs', priority: 2, due: date(4) } },
  { collection: 'work', fields: { summary: 'Respond to security audit findings', priority: 1, due: date(1), description: 'Items 3, 7, 12 need immediate response' } },
  { collection: 'work', fields: { summary: 'Archive old S3 buckets', priority: 9, status: 'IN-PROCESS' } },
  { collection: 'work', fields: { summary: 'Onboard new engineer — access provisioning', status: 'COMPLETED', priority: 2 } },
  { collection: 'work', fields: { summary: 'Update runbook for deploy process', status: 'COMPLETED', priority: 3 } },

  // ── Learning todos ──
  { collection: 'learning', fields: { summary: 'Finish Rust book chapters 10–12', priority: 2, due: date(10) } },
  { collection: 'learning', fields: { summary: 'Complete distributed systems course on Coursera', priority: 3 } },
  { collection: 'learning', fields: { summary: 'Read: "A Philosophy of Software Design"', priority: 5 } },
  { collection: 'learning', fields: { summary: 'Build a toy key-value store in Go', priority: 4 } },
  { collection: 'learning', fields: { summary: 'Write blog post on CalDAV spec', priority: 6, description: 'Cover PROPFIND, REPORT, and sync-collection' } },
  { collection: 'learning', fields: { summary: 'Watch SICP lecture series (first 6 lectures)', status: 'IN-PROCESS', priority: 3 } },
  { collection: 'learning', fields: { summary: 'Finish TypeScript generics course', status: 'COMPLETED', priority: 2 } },

  // ── Personal todos ──
  { collection: 'personal', fields: { summary: 'Book Edinburgh accommodation', priority: 1, due: date(2), description: 'Check Airbnb + hotels near Royal Mile' } },
  { collection: 'personal', fields: { summary: 'Renew passport', priority: 1, due: date(21), description: 'Need for October trip — allow 6 weeks' } },
  { collection: 'personal', fields: { summary: 'Call Mum back', priority: 2, due: date(0) } },
  { collection: 'personal', fields: { summary: 'Sort out contents insurance', priority: 3 } },
  { collection: 'personal', fields: { summary: "Get Anna's birthday present", priority: 1, due: date(3) } },
  { collection: 'personal', fields: { summary: 'Cancel free trial before renewal', priority: 2, due: date(5) } },
  { collection: 'personal', fields: { summary: 'Tax return', priority: 2, due: date(60) } },
  { collection: 'personal', fields: { summary: 'Pick up dry cleaning', status: 'COMPLETED', priority: 4 } },

  // ── Health todos ──
  { collection: 'health', fields: { summary: 'Book physio appointment', priority: 2, due: date(2), description: 'Left shoulder — ongoing issue' } },
  { collection: 'health', fields: { summary: 'Order repeat prescription', priority: 1, due: date(3) } },
  { collection: 'health', fields: { summary: 'Research half-marathon training plan', priority: 4 } },
  { collection: 'health', fields: { summary: 'Try new meal prep routine', priority: 6, status: 'IN-PROCESS' } },
  { collection: 'health', fields: { summary: 'Schedule eye test', priority: 3 } },

  // ── Home todos ──
  { collection: 'home', fields: { summary: 'Fix leaking kitchen tap', priority: 1, due: date(1) } },
  { collection: 'home', fields: { summary: 'Clean oven before inspection', priority: 2, due: date(12) } },
  { collection: 'home', fields: { summary: 'Buy new desk lamp', priority: 7 } },
  { collection: 'home', fields: { summary: 'Sort recycling', priority: 8, due: date(1) } },
  { collection: 'home', fields: { summary: 'Repot the monstera', priority: 9, status: 'IN-PROCESS' } },

  // ── Inbox / capture todos ──
  { collection: 'capture', fields: { summary: 'Look into Tailscale for home network', priority: 5 } },
  { collection: 'capture', fields: { summary: 'Idea: CLI tool for CalDAV from terminal', priority: 6 } },
  { collection: 'capture', fields: { summary: 'Check if Deno Deploy supports WebSockets now', priority: 4 } },
  { collection: 'capture', fields: { summary: 'Ask Tom about the hire decision', priority: 3 } },
  { collection: 'capture', fields: { summary: 'Follow up on freelance invoice #47', priority: 1, due: date(3) } },
]

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Seeding CalStakk dev data...\n')

// 1. Wipe existing collections except capture, so we start clean
const existing = await listCollections()
const toWipe = existing.filter(n => n !== 'capture')
console.log(`Wiping existing collections: ${toWipe.join(', ') || 'none'}`)
for (const name of toWipe) {
  await deleteCollection(name)
  console.log(`  Deleted: ${name}`)
}

// 2. Create collections
console.log('\nCreating collections...')
for (const col of COLLECTIONS) {
  await mkcalendar(col.name, col.display, col.color)
  await setGroup(col.name, col.group)
  console.log(`  ${col.display} [${col.group}]`)
}

// Also update existing personal's group if it was re-created above — done.

// 3. Seed events
console.log('\nSeeding events...')
for (const { collection, fields } of EVENTS) {
  const u = uid()
  const ics = vevent({ ...fields, uid: u })
  await putObject(collection, u, ics)
}
console.log(`  ${EVENTS.length} events created`)

// 4. Seed todos
console.log('\nSeeding todos...')
for (const { collection, fields } of TODOS) {
  const u = uid()
  const ics = vtodo({ ...fields, uid: u })
  await putObject(collection, u, ics)
}
console.log(`  ${TODOS.length} todos created`)

console.log('\nDone.')
