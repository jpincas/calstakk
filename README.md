# CalStakk

A private, self-hosted CalDAV/VTODO server and web UI.

**Goal:** push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible, and achieve maximum interoperability with real-world CalDAV clients (Apple Reminders, Tasks.org, Thunderbird, etc.).

**Scope:** Calendar events (VEVENT) and tasks (VTODO) only.

## Status

Under active reconstruction. The demolition phase has stripped the codebase to Calendar + Todos only. The rebuild is informed by deep research into CalDAV/VTODO client support and protocol capabilities.

## Build

```
deno task check     # the gate: backend lint + type-check + tests, then web lint + build
deno task iterate   # fast backend type-check only
```

## MCP server

`mcp/` contains a full-suite [MCP](https://modelcontextprotocol.io) server (stdio transport) so
AI agents can drive CalStakk: collections, events (including recurrence editing with
series / single-occurrence / this-and-future scopes), todos, sections, sync tokens,
free/busy, sharing, and user administration — 29 tools in total. It reuses the web
CalDAV client (`web/src/api/`), so there is exactly one CalDAV implementation.

```
deno task mcp       # run against the server configured in .env / .env.local
```

Environment (loaded from `.env.local` / `.env` by the task):

| Var | Default | Purpose |
|---|---|---|
| `CALSTAKK_URL` | `http://127.0.0.1:5232` | Origin of the CalStakk server to talk to |
| `CALSTAKK_USERNAME` | `calstakk` | Acting user |
| `CALSTAKK_PASSWORD` | *(unset)* | Acting user's password; omit for a no-auth dev server |

Register with Claude Code (local stdio, e.g. for dev against localhost):

```
claude mcp add calstakk \
  --env CALSTAKK_URL=http://127.0.0.1:5232 \
  --env CALSTAKK_USERNAME=calstakk \
  --env CALSTAKK_PASSWORD=... \
  -- deno run --config /path/to/calstakk/deno.json --allow-net --allow-env \
     /path/to/calstakk/mcp/main.ts
```

### Remote endpoint

The server also hosts the same tools directly at **`/mcp`** (MCP streamable
HTTP, stateless, POST only) — no local checkout or Deno install needed on the
client side. Auth is the same HTTP Basic auth as every other route; each
request acts as the authenticated user. Register the deployed server with
Claude Code:

```
claude mcp add calstakk --transport http https://your-server/mcp \
  --header "Authorization: Basic $(echo -n 'user:password' | base64 -w0)"
```
