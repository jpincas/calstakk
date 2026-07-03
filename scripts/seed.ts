/**
 * Dev data seed script. Run with:
 *   ~/.deno/bin/deno run --allow-net scripts/seed.ts
 *
 * Wipes all existing collections and creates a rich set of
 * collections, events, and todos for UI development.
 */

const BASE = 'http://localhost:5232'
const USER = Deno.env.get('CALSTAKK_USERNAME') || 'calstakk'
const PASSWORD = Deno.env.get('CALSTAKK_PASSWORD') || ''
const HOME = `${BASE}/calendars/${USER}`
const CS_NS = 'https://calstakk.dev/ns/'

// Owner credentials — only needed when the server enforces auth
const AUTH: Record<string, string> = PASSWORD
  ? { Authorization: 'Basic ' + btoa(`${USER}:${PASSWORD}`) }
  : {}

const homeOf = (username: string) => `${BASE}/calendars/${username}`

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
  priority?: number; description?: string; categories?: string[]
  section?: string; order?: number; dependsOn?: string
}): string {
  const u = fields.uid ?? uid()
  const s = stamp()
  const lines = ['BEGIN:VTODO', `UID:${u}`, `DTSTAMP:${s}`]
  lines.push(`SUMMARY:${fields.summary}`)
  if (fields.due) lines.push(`DUE:${fields.due}`)
  if (fields.status) lines.push(`STATUS:${fields.status}`)
  if (fields.priority !== undefined) lines.push(`PRIORITY:${fields.priority}`)
  if (fields.description) lines.push(`DESCRIPTION:${fields.description}`)
  for (const cat of fields.categories ?? []) lines.push(`CATEGORIES:${cat}`)
  if (fields.dependsOn) lines.push(`RELATED-TO;RELTYPE=DEPENDS-ON:${fields.dependsOn}`)
  if (fields.section) lines.push(`X-SECTION-ID:${fields.section}`)
  if (fields.order !== undefined) lines.push(`X-SORT-ORDER:${fields.order}`)
  lines.push('END:VTODO')
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//Seed//EN\r\n${lines.join('\r\n')}\r\nEND:VCALENDAR\r\n`
}

// ── CalDAV helpers ───────────────────────────────────────────────────────────

async function mkcalendar(name: string, displayName: string, color?: string, home = HOME): Promise<void> {
  const path = `${home}/${name}`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set><d:prop>
    <d:displayname>${displayName}</d:displayname>
  </d:prop></d:set>
</c:mkcalendar>`
  const res = await fetch(path, { method: 'MKCALENDAR', headers: { 'Content-Type': 'application/xml', ...AUTH }, body })
  if (res.status !== 201 && res.status !== 405) {
    console.warn(`  MKCALENDAR ${name}: ${res.status}`)
  }

  if (color) {
    await proppatch(name, `<a:calendar-color xmlns:a="http://apple.com/ns/ical/">${color}</a:calendar-color>`, home)
  }
}

async function proppatch(name: string, setPropXml: string, home = HOME): Promise<void> {
  const path = `${home}/${name}`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="DAV:">
  <d:set><d:prop>${setPropXml}</d:prop></d:set>
</d:propertyupdate>`
  await fetch(path, { method: 'PROPPATCH', headers: { 'Content-Type': 'application/xml', ...AUTH }, body })
}

async function setGroup(name: string, group: string): Promise<void> {
  await proppatch(name, `<cs:group xmlns:cs="${CS_NS}">${group}</cs:group>`)
}

/** Persist the ordered section registry (cs:sections JSON dead-property, as the web client does). */
async function setSections(name: string, sections: Array<{ id: string; name: string }>, home = HOME): Promise<void> {
  const json = JSON.stringify(sections)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  await proppatch(name, `<cs:sections xmlns:cs="${CS_NS}">${json}</cs:sections>`, home)
}

async function putObject(collection: string, icsUid: string, ics: string, home = HOME): Promise<void> {
  const path = `${home}/${collection}/${icsUid}.ics`
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar', 'If-None-Match': '*', ...AUTH },
    body: ics,
  })
  if (!res.ok && res.status !== 412) {
    console.warn(`  PUT ${collection}/${icsUid}: ${res.status}`)
  }
}

async function deleteCollection(name: string, home = HOME): Promise<void> {
  await fetch(`${home}/${name}`, { method: 'DELETE', headers: AUTH })
}

/** Create a user via the admin API. 409 (already exists) is fine. */
async function ensureUser(user: { username: string; password: string; displayName: string; email: string }): Promise<void> {
  const res = await fetch(`${BASE}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify(user),
  })
  if (!res.ok && res.status !== 409) {
    console.warn(`  create user ${user.username}: ${res.status} ${await res.text()}`)
  } else {
    await res.body?.cancel()
  }
}

/** Share a collection with users via the ACL method (RFC 3744). Replaces the sharee set. */
async function share(
  home: string,
  collection: string,
  sharees: Array<{ username: string; access: 'read' | 'read-write' }>,
): Promise<void> {
  const aces = sharees.map((s) => {
    const write = s.access === 'read-write' ? '<d:privilege><d:write/></d:privilege>' : ''
    return `<d:ace><d:principal><d:href>/principals/${s.username}</d:href></d:principal>` +
      `<d:grant><d:privilege><d:read/></d:privilege>${write}</d:grant></d:ace>`
  }).join('')
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<d:acl xmlns:d="DAV:">${aces}</d:acl>`
  const res = await fetch(`${home}/${collection}`, {
    method: 'ACL',
    headers: { 'Content-Type': 'application/xml', ...AUTH },
    body,
  })
  if (!res.ok) console.warn(`  ACL ${collection}: ${res.status} ${await res.text()}`)
}

async function listCollections(): Promise<string[]> {
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`
  const res = await fetch(HOME, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml', ...AUTH }, body })
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

// Ordered section registries (drag-reorderable in the UI). Todos opt in via
// `section:` below; the rest render in the ungrouped area above the sections.
const SECTIONS: Record<string, Array<{ id: string; name: string }>> = {
  work: [
    { id: 'work-in-review',   name: 'In review' },
    { id: 'work-this-sprint', name: 'This sprint' },
    { id: 'work-backlog',     name: 'Backlog' },
  ],
  home: [
    { id: 'home-weekend', name: 'This weekend' },
    { id: 'home-someday', name: 'Someday' },
  ],
}

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
  { collection: 'health', fields: { summary: 'Strength training', start: dt(1, 7), end: dt(1, 8), location: 'PureGym London Bridge' } },
  { collection: 'health', fields: { summary: 'GP annual check-up', start: dt(6, 9, 30), end: dt(6, 10), location: 'Brunswick Health Centre' } },
  { collection: 'health', fields: { summary: 'Physio session', start: dt(9, 11), end: dt(9, 12), location: 'City Physio, EC2' } },

  // ── Home events ──
  { collection: 'home', fields: { summary: 'Broadband engineer visit', start: dt(1, 8), end: dt(1, 12), description: 'BT engineer — stay home' } },
  { collection: 'home', fields: { summary: 'Landlord inspection', start: dt(13, 14), end: dt(13, 15) } },
]

/**
 * Recurring and round-trip fixtures, written as raw component lines so the UI
 * exercises real-world shapes: RRULE series, EXDATEs, RECURRENCE-ID overrides
 * (moved and cancelled), VALARMs, and a TZID + X-prop round-trip canary.
 * Each entry's lines are wrapped in a VCALENDAR with the generated UID/DTSTAMP.
 */
const RAW_EVENTS: Array<{ collection: string; lines: (u: string, s: string) => string[] }> = [
  // Weekday standup: skips Fri 3 Jul (EXDATE), Mon 6 Jul moved to 10:00 (override), 5-min reminder.
  {
    collection: 'work',
    lines: (u, s) => [
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'DTSTART:20260615T083000Z', 'DTEND:20260615T084500Z',
      'SUMMARY:Daily standup', 'LOCATION:Meet',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'EXDATE:20260703T083000Z',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', 'DESCRIPTION:Standup in 5', 'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'RECURRENCE-ID:20260706T083000Z',
      'DTSTART:20260706T100000Z', 'DTEND:20260706T101500Z',
      'SUMMARY:Daily standup (moved — room clash)', 'LOCATION:Meet',
      'END:VEVENT',
    ],
  },
  // Mon/Wed/Fri run, open-ended.
  {
    collection: 'health',
    lines: (u, s) => [
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'DTSTART:20260601T060000Z', 'DTEND:20260601T064500Z',
      'SUMMARY:Morning run', 'DESCRIPTION:8km easy pace',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'END:VEVENT',
    ],
  },
  // All-day weekly series.
  {
    collection: 'home',
    lines: (u, s) => [
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'DTSTART;VALUE=DATE:20260607', 'DTEND;VALUE=DATE:20260608',
      'SUMMARY:Meal prep Sunday',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
    ],
  },
  // Fortnightly with an UNTIL bound and a cancelled occurrence.
  {
    collection: 'learning',
    lines: (u, s) => [
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'DTSTART:20260616T180000Z', 'DTEND:20260616T190000Z',
      'SUMMARY:Spanish conversation class', 'LOCATION:City Lit, Covent Garden',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261020T235959Z',
      'END:VEVENT',
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'RECURRENCE-ID:20260714T180000Z',
      'DTSTART:20260714T180000Z', 'DTEND:20260714T190000Z',
      'SUMMARY:Spanish conversation class', 'STATUS:CANCELLED',
      'END:VEVENT',
    ],
  },
  // Round-trip canary: TZID datetimes with embedded VTIMEZONE, CLASS, X-props,
  // and a parametered alarm — none of which the UI edits, all of which must survive a save.
  {
    collection: 'personal',
    lines: (u, s) => [
      'BEGIN:VTIMEZONE', 'TZID:Europe/Madrid',
      'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT', `UID:${u}`, `DTSTAMP:${s}`,
      'DTSTART;TZID=Europe/Madrid:20260707T160000',
      'DTEND;TZID=Europe/Madrid:20260707T170000',
      'SUMMARY:Madrid team call', 'LOCATION:Zoom',
      'CLASS:PRIVATE', 'X-SEED-CANARY:round-trip-check',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=START:-PT10M',
      'DESCRIPTION:Time to dial in', 'END:VALARM',
      'END:VEVENT',
    ],
  },
]

function rawVcal(lines: string[]): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//Seed//EN\r\n${lines.join('\r\n')}\r\nEND:VCALENDAR\r\n`
}

const TODOS: Array<{ collection: string; fields: Parameters<typeof vtodo>[0] }> = [
  // ── Work todos (sectioned: In review / This sprint / Backlog; two stay ungrouped) ──
  { collection: 'work', fields: { uid: 'seed-work-auth-spec', summary: 'Write technical spec for auth refactor', priority: 1, due: date(3), description: 'Cover OAuth2 flows, token storage, and migration path', section: 'work-this-sprint', order: 1000, categories: ['deep-work'] } },
  { collection: 'work', fields: { summary: 'Review 3 open PRs in queue', priority: 2, due: date(1), section: 'work-in-review', categories: ['quick-win'] } },
  { collection: 'work', fields: { summary: 'Update API docs after v2 release', priority: 3, due: date(5), section: 'work-backlog' } },
  // Waiting on the auth spec (RELATED-TO;RELTYPE=DEPENDS-ON) — greyed until it completes
  { collection: 'work', fields: { summary: 'Set up staging environment for new service', priority: 2, due: date(7), dependsOn: 'seed-work-auth-spec' } },
  { collection: 'work', fields: { summary: 'Fix flaky integration test in CI', priority: 1, due: date(2), section: 'work-this-sprint', order: 2000 } },
  { collection: 'work', fields: { summary: 'Migrate legacy config to env vars', priority: 5, section: 'work-backlog' } },
  { collection: 'work', fields: { summary: 'Draft Q3 OKRs', priority: 2, due: date(4), categories: ['deep-work'] } },
  { collection: 'work', fields: { summary: 'Respond to security audit findings', priority: 1, due: date(1), description: 'Items 3, 7, 12 need immediate response', section: 'work-this-sprint', order: 3000 } },
  { collection: 'work', fields: { summary: 'Archive old S3 buckets', priority: 9, status: 'IN-PROCESS', section: 'work-backlog' } },
  { collection: 'work', fields: { summary: 'Onboard new engineer — access provisioning', status: 'COMPLETED', priority: 2 } },
  { collection: 'work', fields: { summary: 'Update runbook for deploy process', status: 'COMPLETED', priority: 3 } },

  // ── Learning todos ──
  { collection: 'learning', fields: { summary: 'Finish Rust book chapters 10–12', priority: 2, due: date(10), categories: ['reading'] } },
  { collection: 'learning', fields: { summary: 'Complete distributed systems course on Coursera', priority: 3 } },
  { collection: 'learning', fields: { summary: 'Read: "A Philosophy of Software Design"', priority: 5, categories: ['reading'] } },
  { collection: 'learning', fields: { summary: 'Build a toy key-value store in Go', priority: 4 } },
  { collection: 'learning', fields: { summary: 'Write blog post on CalDAV spec', priority: 6, description: 'Cover PROPFIND, REPORT, and sync-collection' } },
  { collection: 'learning', fields: { summary: 'Watch SICP lecture series (first 6 lectures)', status: 'IN-PROCESS', priority: 3 } },
  { collection: 'learning', fields: { summary: 'Finish TypeScript generics course', status: 'COMPLETED', priority: 2 } },

  // ── Personal todos ──
  { collection: 'personal', fields: { uid: 'seed-personal-edinburgh', summary: 'Book Edinburgh accommodation', priority: 1, due: date(2), description: 'Check Airbnb + hotels near Royal Mile' } },
  { collection: 'personal', fields: { summary: 'Pack for Edinburgh trip', priority: 3, due: date(5), dependsOn: 'seed-personal-edinburgh' } },
  { collection: 'personal', fields: { summary: 'Renew passport', priority: 1, due: date(21), description: 'Need for October trip — allow 6 weeks' } },
  { collection: 'personal', fields: { summary: 'Call Mum back', priority: 2, due: date(0), categories: ['quick-win'] } },
  { collection: 'personal', fields: { summary: 'Sort out contents insurance', priority: 3, categories: ['finance'] } },
  { collection: 'personal', fields: { summary: "Get Anna's birthday present", priority: 1, due: date(3) } },
  { collection: 'personal', fields: { summary: 'Cancel free trial before renewal', priority: 2, due: date(5) } },
  { collection: 'personal', fields: { summary: 'Tax return', priority: 2, due: date(60), categories: ['finance'] } },
  { collection: 'personal', fields: { summary: 'Pick up dry cleaning', status: 'COMPLETED', priority: 4 } },

  // ── Health todos ──
  { collection: 'health', fields: { summary: 'Book physio appointment', priority: 2, due: date(2), description: 'Left shoulder — ongoing issue' } },
  { collection: 'health', fields: { summary: 'Order repeat prescription', priority: 1, due: date(3), categories: ['errand'] } },
  { collection: 'health', fields: { summary: 'Research half-marathon training plan', priority: 4 } },
  { collection: 'health', fields: { summary: 'Try new meal prep routine', priority: 6, status: 'IN-PROCESS' } },
  { collection: 'health', fields: { summary: 'Schedule eye test', priority: 3 } },

  // ── Home todos (sectioned: This weekend / Someday; one stays ungrouped) ──
  { collection: 'home', fields: { summary: 'Fix leaking kitchen tap', priority: 1, due: date(1), section: 'home-weekend' } },
  { collection: 'home', fields: { summary: 'Clean oven before inspection', priority: 2, due: date(12) } },
  { collection: 'home', fields: { summary: 'Buy new desk lamp', priority: 7, section: 'home-someday', categories: ['errand'] } },
  { collection: 'home', fields: { summary: 'Sort recycling', priority: 8, due: date(1), section: 'home-weekend' } },
  { collection: 'home', fields: { summary: 'Repot the monstera', priority: 9, status: 'IN-PROCESS', section: 'home-someday' } },

  // ── Inbox / capture todos ──
  { collection: 'capture', fields: { summary: 'Look into Tailscale for home network', priority: 5 } },
  { collection: 'capture', fields: { summary: 'Idea: CLI tool for CalDAV from terminal', priority: 6 } },
  { collection: 'capture', fields: { summary: 'Check if Deno Deploy supports WebSockets now', priority: 4 } },
  { collection: 'capture', fields: { summary: 'Ask Tom about the hire decision', priority: 3 } },
  { collection: 'capture', fields: { summary: 'Follow up on freelance invoice #47', priority: 1, due: date(3), categories: ['finance'] } },
]

// ── Multi-user seed data ─────────────────────────────────────────────────────

const EXTRA_USERS = [
  { username: 'anna', password: 'anna', displayName: 'Anna Torres', email: 'anna@example.com' },
  { username: 'ben',  password: 'ben',  displayName: 'Ben Okafor',  email: 'ben@example.com' },
]

// Anna owns a team calendar shared back to the owner (read-write) and Ben (read)
const ANNA_COLLECTION = { name: 'team', display: 'Team Projects', color: '#0891B2' }

const ANNA_EVENTS: Array<Parameters<typeof vevent>[0]> = [
  { summary: 'Team sync', start: dt(0, 10), end: dt(0, 10, 30), location: 'Meet' },
  { summary: 'Design review', start: dt(2, 15), end: dt(2, 16), description: 'New onboarding flow' },
  { summary: 'Release planning', start: dt(4, 11), end: dt(4, 12, 30) },
  { summary: 'Team lunch', start: dt(5, 12, 30), end: dt(5, 14), location: 'Dishoom' },
  { summary: 'Hack day', start: date(9), end: date(10), allDay: true },
]

// Sections on a shared collection: sharees see them too (read-only for `read` access)
const ANNA_SECTIONS = [
  { id: 'team-launch-prep', name: 'Launch prep' },
  { id: 'team-ongoing',     name: 'Ongoing' },
]

const ANNA_TODOS: Array<Parameters<typeof vtodo>[0]> = [
  { summary: 'Prepare demo environment', priority: 1, due: date(2), section: 'team-launch-prep' },
  { summary: 'Collect feedback from beta users', priority: 2, due: date(4), section: 'team-launch-prep' },
  { summary: 'Write release notes', priority: 3, due: date(6), section: 'team-launch-prep' },
  { summary: 'Triage open bugs', priority: 2, status: 'IN-PROCESS', section: 'team-ongoing' },
  { summary: 'Update team wiki', priority: 5, section: 'team-ongoing' },
  { summary: 'Order new monitors', priority: 4, status: 'COMPLETED' },
]

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Seeding CalStakk dev data...\n')

// 1. Wipe all existing collections, so we start clean. 'capture' (the inbox)
// is recreated below before its todos are seeded — leaving it out here made
// every seed run append another copy of the inbox todos.
const toWipe = await listCollections()
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
  const sections = SECTIONS[col.name]
  if (sections) await setSections(col.name, sections)
  console.log(`  ${col.display} [${col.group}]${sections ? ` — ${sections.length} sections` : ''}`)
}

// Also update existing personal's group if it was re-created above — done.

// 3. Seed events
console.log('\nSeeding events...')
for (const { collection, fields } of EVENTS) {
  const u = uid()
  const ics = vevent({ ...fields, uid: u })
  await putObject(collection, u, ics)
}
for (const { collection, lines } of RAW_EVENTS) {
  const u = uid()
  await putObject(collection, u, rawVcal(lines(u, stamp())))
}
console.log(`  ${EVENTS.length + RAW_EVENTS.length} events created (${RAW_EVENTS.length} recurring/round-trip fixtures)`)

// 4. Seed todos (ensure the capture inbox exists first — the UI normally creates it)
await mkcalendar('capture', 'Inbox')
console.log('\nSeeding todos...')
for (const { collection, fields } of TODOS) {
  const u = uid()
  const ics = vtodo({ ...fields, uid: u })
  await putObject(collection, u, ics)
}
console.log(`  ${TODOS.length} todos created`)

// 5. Multi-user: accounts, a second user's calendar, and shares in both directions
console.log('\nCreating users...')
for (const u of EXTRA_USERS) {
  await ensureUser(u)
  console.log(`  ${u.displayName} (${u.username} / ${u.password})`)
}

console.log("\nSeeding anna's team calendar...")
const annaHome = homeOf('anna')
await deleteCollection(ANNA_COLLECTION.name, annaHome)
await mkcalendar(ANNA_COLLECTION.name, ANNA_COLLECTION.display, ANNA_COLLECTION.color, annaHome)
await setSections(ANNA_COLLECTION.name, ANNA_SECTIONS, annaHome)
for (const fields of ANNA_EVENTS) {
  const u = uid()
  await putObject(ANNA_COLLECTION.name, u, vevent({ ...fields, uid: u }), annaHome)
}
for (const fields of ANNA_TODOS) {
  const u = uid()
  await putObject(ANNA_COLLECTION.name, u, vtodo({ ...fields, uid: u }), annaHome)
}
console.log(`  ${ANNA_EVENTS.length} events, ${ANNA_TODOS.length} todos`)

console.log('\nSharing collections...')
await share(annaHome, ANNA_COLLECTION.name, [
  { username: USER, access: 'read-write' },
  { username: 'ben', access: 'read' },
])
console.log(`  anna/team → ${USER} (read-write), ben (read)`)
await share(HOME, 'work', [{ username: 'anna', access: 'read-write' }])
console.log('  work → anna (read-write)')
await share(HOME, 'home', [{ username: 'ben', access: 'read' }])
console.log('  home → ben (read)')

console.log('\nDone.')
