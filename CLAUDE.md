# CalStakk

A private, self-hosted CalDAV/VTODO server + web UI. Goal: push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible and achieve maximum client interop. Scope is **Calendar (VEVENT) and Todos (VTODO) only**.

---

## Current State — Read This First

**The backend is complete and spec-locked.**
**The frontend CalDAV client is complete.**
**Ongoing work is UI only.**

| Layer | Status |
|---|---|
| CalDAV server (`src/`) | ✅ Spec-complete. 523/523 conformance tests passing. |
| JS/TS CalDAV client (`web/src/api/`) | ✅ Complete. Covers all operations the UI needs. |
| Web UI (`web/src/`) | 🔨 Under active development. |

---

## Your Role

React/TypeScript UI engineer. Build the web UI. Consume the CalDAV client. Do not touch the backend unless you have a very specific reason and explicit sign-off from the user.

---

## The Stack

- **Backend language** — TypeScript (Deno)
- **Protocol** — CalDAV (RFC 4791) over HTTP
- **Storage** — Deno KV (SQLite locally, Deno Deploy KV in prod)
- **Web UI** — React SPA (`web/`) served from `web/dist` at `/app/`
- **Deploy** — Deno Deploy (serverless, zero maintenance)

---

## Backend — Hands Off

The CalDAV server in `src/` is spec-complete. **Do not modify `src/` without explicit user sign-off.** Any need to change the backend signals either a missed spec area or a regression — both require the user to review and decide.

Key source files (for reference only):
- `src/protocol.ts` — all CalDAV/WebDAV HTTP routing and response logic
- `src/ical.ts` — iCalendar parser, validator, filter engine
- `src/xml.ts` — XML builders + PROPFIND/PROPPATCH/REPORT parsers
- `src/xmlparse.ts` — custom XML parser (namespace-aware)
- `src/storage.ts` — Storage interface + MemoryStorage (used in tests)
- `src/storage_kv.ts` — Deno KV backend
- `src/types.ts` — shared types and path helpers
- `src/config.ts` — env-var config loader

### Server paths (username defaults to `calstakk`)
- Well-known: `/.well-known/caldav` → redirects to principal
- Principal: `/principals/{username}`
- Calendar home: `/calendars/{username}`
- Collection: `/calendars/{username}/{name}`
- Object: `/calendars/{username}/{name}/{uid}.ics`
- Inbox/Outbox: `/calendars/{username}/inbox`, `/calendars/{username}/outbox`

### Auth
- No password set (default dev) → no credentials required, all requests are the owner.
- `CALSTAKK_PASSWORD` set → HTTP Basic Auth enforced.

---

## Frontend CalDAV Client

The client in `web/src/api/` is complete. **This is the only thing the UI should talk to — never issue CalDAV/XML requests directly from UI components.**

```
web/src/api/
  index.ts      ← exports pre-configured singleton: `caldav`
  client.ts     ← CalDAVClient class with all methods
  ical.ts       ← internal iCal parse/serialize (not for UI use)
  xml.ts        ← internal XML helpers (not for UI use)
  types.ts      ← CalDAVError, SyncResult, FreeBusySlot
  caldav.ts     ← legacy shim (re-exports via caldav singleton)
  collections.ts← legacy shim (re-exports via caldav singleton)
```

**Import pattern:**
```ts
import { caldav } from '@/api'
const collections = await caldav.listCollections()
```

**Available operations:**
- `caldav.listCollections()` → `Collection[]`
- `caldav.createCollection(name, props)` → `void`
- `caldav.deleteCollection(name)` → `void`
- `caldav.getCollectionProps(name)` → `Collection`
- `caldav.updateCollectionProps(name, props)` → `void`
- `caldav.listEvents(collection, opts?)` → `CalEvent[]`
- `caldav.getEvent(collection, uid)` → `CalEvent`
- `caldav.createEvent(collection, event)` → `void`
- `caldav.updateEvent(collection, event)` → `void`
- `caldav.deleteEvent(collection, uid)` → `void`
- `caldav.listTodos(collection, opts?)` → `Todo[]`
- `caldav.getTodo(collection, uid)` → `Todo`
- `caldav.createTodo(collection, todo)` → `void`
- `caldav.updateTodo(collection, todo)` → `void`
- `caldav.deleteTodo(collection, uid)` → `void`
- `caldav.syncCollection(collection, syncToken?)` → `SyncResult<T>`
- `caldav.queryFreeBusy(from, to)` → `FreeBusySlot[]`

**Types** — defined in `web/src/types/index.ts`:
- `Collection` — `name`, `displayName`, `href`, `color?`, `description?`
- `CalEvent` — standard VEVENT fields (uid, summary, start, end, description, location, status, rrule, all_day, href)
- `Todo` — standard VTODO fields (uid, summary, description, due, status, priority, related_to, categories, href)

All datetimes are iCal compact strings (`20260101T090000Z`). Use `web/src/lib/dates.ts` for display formatting.

---

## Web UI Structure

```
web/src/
  main.tsx                        ← React entry, routing
  pages/
    calendar.tsx                  ← Calendar/events page
    todos.tsx                     ← Todos page
  components/
    layout/
      AppShell.tsx                ← Root layout, loads collections
      CollectionSidebar.tsx       ← Left sidebar, collection list
      DataTypeTabs.tsx            ← Calendar / Todos tab switcher
    ui/                           ← shadcn primitives (don't edit directly)
  api/                            ← CalDAV client (see above)
  lib/
    dates.ts                      ← Date formatting utilities
    colors.ts                     ← Colour utilities
    utils.ts                      ← Misc utilities
  state/
    collection.ts                 ← Collection state
  types/
    index.ts                      ← Shared TypeScript types
```

---

## Dev Workflow

### Run the server
```bash
~/.deno/bin/deno task dev          # CalDAV server on http://localhost:5232
# Web UI at http://localhost:5232/app/
# No auth in dev (no CALSTAKK_PASSWORD set)
```

### Run the web UI dev server (hot reload)
```bash
cd web && npm run dev              # Vite dev server on http://localhost:5173
# Note: CalDAV requests proxy to :5232 — check web/vite.config.ts for proxy config
```

### Gates — run these before committing
```bash
~/.deno/bin/deno check src/ tests/        # Backend type-check
~/.deno/bin/deno lint                     # Lint (excludes web/)
~/.deno/bin/deno test --allow-net --allow-env tests/  # 523 conformance tests — must stay green
cd web && npm run build                   # Web UI type-check + build
```

### After web UI changes
```bash
~/.deno/bin/deno task web-build    # Rebuild web/dist (served by the CalDAV server)
```

---

## Planning

- Wide searches → `Explore` agent (read-only).
- Non-trivial multi-file UI work → `EnterPlanMode`.
- Backend changes → stop, explain why, get user sign-off before touching `src/`.

---

## Test Suite

523 conformance tests across 12 RFC files in `tests/conformance/`. Tests are spec-first — written against RFC text, not implementation. **All 523 must stay green.** Never soften, skip, or delete a test. If a backend change is needed to fix a test, get user sign-off first.
