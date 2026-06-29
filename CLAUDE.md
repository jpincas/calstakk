# CalStakk

A private, self-hosted CalDAV/VTODO server + web UI. Goal: push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible and achieve maximum client interop. Scope is **Calendar (VEVENT) and Todos (VTODO) only**.

## Your Role

Go engineer building a production-quality CalDAV/VTODO server. Explore, plan, implement, verify, commit. Drive features to completion.

## The Stack

- **Language** — Go
- **Protocol** — CalDAV (RFC 4791) over HTTP, powered by `github.com/emersion/go-webdav`
- **iCalendar** — `github.com/emersion/go-ical` + `github.com/teambition/rrule-go` for recurrence
- **Storage** — `.ics` files on disk per collection; no database
- **CLI** — agent-friendly; speaks CalDAV to the server over HTTP; fully non-interactive; JSON output by default
- **Web UI** — React SPA served from `web/dist` at `/app/`

## Architecture

Single binary, two modes:

- `calstakk serve` — runs the CalDAV HTTP server (+ web UI if `--web-dir` set)
- `calstakk <command>` — CLI mode; speaks CalDAV to the server

## Planning

Plan when work is multi-file. Trivial fixes skip to implementation.

- Wide searches → `Explore` agent (read-only).
- Non-trivial work → `EnterPlanMode`.

## Implementation

- `make iterate` after every Go edit (`go build ./cmd/calstakk`)
- `make check` is the gate (lint + build + test) — never bypass it
- `make web-build` after web UI changes
- Commit at coherent stopping points
