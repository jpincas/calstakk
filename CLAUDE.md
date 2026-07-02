# CalStakk

A private, self-hosted CalDAV/VTODO server + web UI. Goal: push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible and achieve maximum client interop. Scope is **Calendar (VEVENT) and Todos (VTODO) only**.

---

## Current State — Read This First

**The backend is complete and spec-locked.**
**The frontend CalDAV client is complete.**
**Ongoing work is UI only.**

| Layer | Status |
|---|---|
| CalDAV server (`src/`) | ✅ Spec-complete, incl. multi-user sharing (RFC 3744 subset) + admin API. 567/567 conformance/API tests passing. |
| JS/TS CalDAV client (`web/src/api/`) | ✅ Complete. Covers all operations the UI needs, incl. auth, sharing, admin. |
| MCP server (`mcp/`) | ✅ Complete. 29 tools covering the full surface (agents' entry point); reuses the CalDAV client. |
| Web UI (`web/src/`) | 🔨 Under active development. Multi-user (login, sharing, user admin) shipped. |

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

### Auth & multi-user
- No password set (default dev) → no credentials required, all requests are the owner.
- `CALSTAKK_PASSWORD` set → HTTP Basic Auth enforced; **all** users in storage can authenticate with their own passwords. To exercise the login flow / multi-user in dev, set `CALSTAKK_PASSWORD` in `.env.local`.
- Exactly one admin: the configured owner. Only the admin manages accounts (`/api/users` — create, delete, reset password). `/api/me` returns the authenticated identity.
- **Sharing** (RFC 3744 subset): owners grant `read` or `read+write` on a collection via the `ACL` method; grants surface through `DAV:owner`, `DAV:acl`, `DAV:current-user-privilege-set`, and sharees discover shared collections via extra hrefs in their `calendar-home-set`. Principal search: `principal-property-search` REPORT on `/principals`. Collection create/delete and ACL changes stay owner-only.

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

**Multi-user / sharing / admin operations:**
- `caldav.configure(creds | null)` — set/clear Basic auth credentials (used by the login flow; see `web/src/state/auth.ts`)
- `caldav.whoami()` → `Me` (`GET /api/me`; 401 = login required)
- `caldav.searchUsers(query)` → `PrincipalMatch[]` (RFC 3744 principal-property-search)
- `caldav.getSharees(ref)` / `caldav.setSharees(ref, sharees)` — read/replace a collection's grants (DAV:acl property / ACL method)
- `caldav.listUsers()` / `createUser` / `updateUser` / `deleteUser` — admin-only, `/api/users`

**Collection identity:** every collection has a `ref` — the plain `name` for own
collections, `owner~name` for collections shared by another user. All client
methods, routes (`/:collection`), and query keys use refs. `Collection.myAccess`
(`owner | read-write | read`) drives UI gating; `read` collections must not be
offered mutations.

**Types** — defined in `web/src/types/index.ts`:
- `Collection` — `name`, `display_name`, `href`, `ref`, `owner`, `shared`, `myAccess`, `sharedWith?`, `color?`, `description?`, `order?`, `group?`
- `CalEvent` — standard VEVENT fields (uid, summary, start, end, description, location, status, rrule, all_day, href)
- `Todo` — standard VTODO fields (uid, summary, description, due, status, priority, related_to, categories, href)
- `Me`, `UserAccount`, `Sharee`, `PrincipalMatch` — identity/sharing/admin types

All datetimes are iCal compact strings (`20260101T090000Z`). Use `web/src/lib/dates.ts` for display formatting.

---

## MCP Server

`mcp/` is a full-suite MCP server (stdio) exposing everything to AI agents — 29 tools:
identity, collections, events (recurrence-aware `update_event`/`delete_event` with
`scope: series | occurrence | this_and_future`), todos, sections, sync, free/busy,
sharing, and admin. See the README's *MCP server* section for env vars and registration.

Key facts:
- **It reuses the web CalDAV client** (`web/src/api/`) and recurrence engine
  (`web/src/lib/recur.ts`) — there is exactly one CalDAV implementation. Three runtime
  adapters make the browser-targeted client run under Deno: `@xmldom/xmldom` globals +
  a base-URL fetch wrapper (`mcp/shims.ts`), the `"@/": "./web/src/"` import-map entry,
  and `"unstable": ["sloppy-imports"]` (both in `deno.json`). In `mcp/` code itself,
  always import web files with explicit `.ts` extensions (lint enforces it).
- **Never `console.log` in `mcp/`** — stdout is the MCP protocol stream; use
  `console.error` for diagnostics.
- Recurrence edit orchestration mirrors `web/src/components/calendar/useEventMutations.ts`;
  keep the two in sync if edit semantics ever change.
- Gated like everything else: `deno lint` + `deno check mcp/main.ts` + integration tests
  (`tests/mcp_test.ts`, `tests/mcp_recurrence_test.ts`) all run inside `deno task check`.
  `deno task mcp` runs it locally.

---

## Web UI Structure

```
web/src/
  main.tsx                        ← React entry, routing
  pages/
    calendar.tsx                  ← Calendar/events page
    todos.tsx                     ← Inbox (capture) page
    today.tsx / tasks.tsx         ← Aggregate views
    project.tsx                   ← Per-collection page (rename, settings, share)
    login.tsx                     ← Sign-in (Basic auth)
    users.tsx                     ← Admin: user management
  components/
    TaskList.tsx                  ← Task list (readOnly-aware)
    ShareDialog.tsx               ← Collection sharing dialog (owner only)
    layout/
      AppShell.tsx                ← Root layout, auth gate, loads collections
      CollectionSidebar.tsx       ← Left sidebar, collections + shared-with-me + account footer
    ui/                           ← shadcn primitives (don't edit directly)
  api/                            ← CalDAV client (see above)
  lib/
    dates.ts                      ← Date formatting utilities
    colors.ts                     ← Colour utilities
    utils.ts                      ← Misc utilities
  state/
    collection.ts                 ← Collection UI state (per-user, cleared on user switch)
    auth.ts                       ← Session persistence (localStorage) + client wiring
  types/
    index.ts                      ← Shared TypeScript types
```

---

## Dev Workflow

### Develop the UI (hot reload) — the one command
```bash
~/.deno/bin/deno task dev          # backend :5232 + Vite HMR :5173, fixed ports
```
**Open the app at http://localhost:5173/app/** — that's the Vite dev server with
hot reload. It starts both processes on fixed ports, clears any stale servers
first (no zombies, no port drift), and tears both down on exit. Run it as a
background task. No auth in dev (no `CALSTAKK_PASSWORD` set) — the UI skips the
login screen. To exercise login/multi-user, set `CALSTAKK_PASSWORD` in `.env.local`
and re-run; `deno task seed` creates extra users `anna`/`anna` and `ben`/`ben`
plus shares in both directions.

Do **not** open **:5232/app/** for UI work — that's the backend serving the last
*built* bundle (`web/dist`), with no hot reload. That mode is `deno task start`,
for verifying the production-like build only. `deno task backend` runs just the
backend (watch) if you ever need it alone.

### Config / env
Vars are read from the environment by `src/config.ts`. `deno task start|backend|dev|seed`
load `.env.local` then `.env` (first wins; real shell env overrides both):
- **`.env`** — committed, non-secret defaults; the canonical list of every var.
- **`.env.local`** — gitignored, per-machine secrets (e.g. `CALSTAKK_PASSWORD`).

### The gate — run before committing
```bash
~/.deno/bin/deno task check        # deno lint + type-check + 571 tests, then web lint + build
```
`check` is the one complete gate — backend **and** frontend. The pre-commit hook
runs it; don't `--no-verify` past it. Fast inner loop: `deno task iterate`
(backend type-check only). Rebuild just the UI: `deno task web-build`.

---

## Deployment

Live on Deno Deploy — see `DEPLOY.md` for the CLI, config, and gotchas.

---

## Planning

- Wide searches → `Explore` agent (read-only).
- Non-trivial multi-file UI work → `EnterPlanMode`.
- Backend changes → stop, explain why, get user sign-off before touching `src/`.

---

## Test Suite

553 conformance tests across 13 RFC files in `tests/conformance/`. Tests are spec-first — written against RFC text, not implementation. **All 553 must stay green.** Never soften, skip, or delete a test. If a backend change is needed to fix a test, get user sign-off first.

## Rules

- **Quality.** Don't ship substandard, unchecked, or unfinished work. This is not
  an MVP or a prototype — no cut corners. Completion means full completion.
- **The gate is non-negotiable.** Every change passes `deno task check`; the
  pre-commit hook enforces it. Don't `--no-verify` past it — fix the failure.
- **Never soften a test to make it pass.** A red conformance test is a real
  regression: fix the code, or get sign-off to touch the backend (see *Backend —
  Hands Off*). Same for lint — fix it, don't `eslint-disable` it away.
- **Seed data stays rich.** Keep `scripts/seed.ts` at ≥ 5–10 varied rows per
  collection so the UI exercises real lists, filters, and edge cases.
- **Verify dispatched work.** Subagents don't self-gate here — read the diff and
  run the gate before accepting their output. A green gate only proves it compiles.
