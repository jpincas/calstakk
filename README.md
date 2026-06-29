# CalStakk

A private, self-hosted CalDAV/VTODO server and web UI.

**Goal:** push the CalDAV (RFC 4791) and VTODO (RFC 5545) spec as far as possible, and achieve maximum interoperability with real-world CalDAV clients (Apple Reminders, Tasks.org, Thunderbird, etc.).

**Scope:** Calendar events (VEVENT) and tasks (VTODO) only.

## Status

Under active reconstruction. The demolition phase has stripped the codebase to Calendar + Todos only. The rebuild is informed by deep research into CalDAV/VTODO client support and protocol capabilities.

## Build

```
make check   # lint + build + test (gate)
make iterate # fast build only
```
