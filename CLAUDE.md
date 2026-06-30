# CalStakk

A private, self-hosted CalDAV/VTODO server + web UI. Goal: push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible and achieve maximum client interop. Scope is **Calendar (VEVENT) and Todos (VTODO) only**.

## Your Role

Deno/TypeScript engineer building a production-quality CalDAV/VTODO server. Explore, plan, implement, verify, commit. Drive features to completion.

## The Stack

- **Language** — TypeScript (Deno)
- **Protocol** — CalDAV (RFC 4791) over HTTP; WebDAV/CalDAV protocol logic in `src/protocol.ts` and `src/xml.ts`
- **iCalendar** — custom parser/validator in `src/ical.ts`
- **Storage** — Deno KV (local SQLite in dev, Deno Deploy KV in prod); no database, no SQL
- **Web UI** — React SPA served from `web/dist` at `/app/`
- **Deploy** — Deno Deploy (serverless, zero maintenance)

## Architecture

Single entry point: `server.ts` — runs the CalDAV HTTP server via `Deno.serve`.

Key source files:
- `src/protocol.ts` — all CalDAV/WebDAV HTTP routing and response logic
- `src/ical.ts` — iCalendar parser, validator, filter engine
- `src/xml.ts` — XML builders + PROPFIND/PROPPATCH/REPORT parsers
- `src/xmlparse.ts` — custom XML parser (namespace-aware)
- `src/storage.ts` — Storage interface + MemoryStorage (used in tests)
- `src/storage_kv.ts` — Deno KV backend
- `src/types.ts` — shared types and path helpers
- `src/config.ts` — env-var config loader

## Planning

Plan when work is multi-file. Trivial fixes skip to implementation.

- Wide searches → `Explore` agent (read-only).
- Non-trivial work → `EnterPlanMode`.

## Implementation

- `~/.deno/bin/deno check src/ tests/` after every edit (type-check gate)
- `~/.deno/bin/deno test --allow-net --allow-env tests/` is the gate — never bypass it
- `~/.deno/bin/deno lint` for linting
- `make web-build` after web UI changes
- Commit at coherent stopping points

## Test Suite

523 conformance tests across 12 RFC files in `tests/conformance/`. Tests are spec-first — written against the RFC text, not the implementation. Red tests are expected and mark unimplemented behaviour. Never soften or skip a test; fix the server instead.
