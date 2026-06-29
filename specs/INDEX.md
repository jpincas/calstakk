# CalDAV / iCalendar RFC Specifications

This directory contains the authoritative plain-text RFC specifications for CalDAV, iCalendar (VTODO), and related protocols, downloaded from https://www.rfc-editor.org/.

Status verified via https://datatracker.ietf.org/ on 2026-06-29.

---

## Core Specifications

| RFC | File | Title | Status | Published | Updated by | Obsoleted by | Relevance |
|-----|------|-------|--------|-----------|------------|--------------|-----------|
| [RFC 4918](rfc4918.txt) | `rfc4918.txt` | HTTP Extensions for Web Distributed Authoring and Versioning (WebDAV) | Standards Track | June 2007 | RFC 5689 | — | Foundation protocol that CalDAV (RFC 4791) is built on; defines PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, and multistatus responses |
| [RFC 4791](rfc4791.txt) | `rfc4791.txt` | Calendaring Extensions to WebDAV (CalDAV) | Standards Track | March 2007 | RFC 6638, RFC 6764, RFC 7809, RFC 7953, RFC 8996 | **NOT obsoleted** | The core CalDAV spec — defines calendar collections, REPORT requests (calendar-query, calendar-multiget, free-busy-query), scheduling, and VTODO/VEVENT storage over WebDAV |
| [RFC 5545](rfc5545.txt) | `rfc5545.txt` | Internet Calendaring and Scheduling Core Object Specification (iCalendar) | Standards Track | September 2009 | RFC 5546, RFC 6868, RFC 7529, RFC 7953, RFC 7986, RFC 9073, RFC 9074, RFC 9253 | **NOT obsoleted** | The iCalendar format spec; §3.6.2 defines VTODO in full — properties, recurrence, alarms, relationships, status values |
| [RFC 5546](rfc5546.txt) | `rfc5546.txt` | iCalendar Transport-Independent Interoperability Protocol (iTIP) | Standards Track | December 2009 | RFC 6638 | — | Defines the method property values (REQUEST, REPLY, CANCEL, etc.) used when calendar objects are exchanged between systems; updates RFC 5545 |

---

## CalDAV Extensions

| RFC | File | Title | Status | Published | Updated by | Obsoleted by | Relevance |
|-----|------|-------|--------|-----------|------------|--------------|-----------|
| [RFC 6638](rfc6638.txt) | `rfc6638.txt` | Scheduling Extensions to CalDAV | Standards Track | June 2012 | RFC 7953 | — | Adds server-side scheduling (inbox/outbox collections, iTIP delivery) to CalDAV; updates RFC 4791 and RFC 5546 |
| [RFC 6764](rfc6764.txt) | `rfc6764.txt` | Locating Services for Calendaring Extensions to WebDAV (CalDAV) and vCard Extensions to WebDAV (CardDAV) | Standards Track | February 2013 | — | — | Defines DNS SRV and TXT record discovery for CalDAV; how clients find the server — important for client interop |
| [RFC 7809](rfc7809.txt) | `rfc7809.txt` | Calendaring Extensions to WebDAV (CalDAV): Time Zones by Reference | Standards Track | March 2016 | — | — | Allows time zones to be referenced by ID rather than embedded as full VTIMEZONE components; reduces payload size and avoids stale TZ data |
| [RFC 8607](rfc8607.txt) | `rfc8607.txt` | Managed Attachments for Calendar Data in CalDAV | Informational | June 2019 | — | — | Defines how large binary attachments (e.g. meeting documents) are stored server-side and referenced via ATTACH URIs in calendar objects |

---

## iCalendar Extensions

| RFC | File | Title | Status | Published | Updated by | Obsoleted by | Relevance |
|-----|------|-------|--------|-----------|------------|--------------|-----------|
| [RFC 9253](rfc9253.txt) | `rfc9253.txt` | Support for iCalendar Relationships | Standards Track | August 2022 | — | — | Adds new RELTYPE values (PARENT, CHILD, SIBLING, CONCEPT, DEPENDS-ON, REFID, STRUCTURED-DATA, etc.) to RELATED-TO for rich task dependency modeling in VTODO |
| [RFC 7953](rfc7953.txt) | `rfc7953.txt` | Calendar Availability | Standards Track | August 2016 | — | — | Introduces the VAVAILABILITY component for expressing when a calendar user is available; updates RFC 4791, RFC 5545, and RFC 6638 |
| [RFC 6047](rfc6047.txt) | `rfc6047.txt` | iCalendar Message-Based Interoperability Protocol (iMIP) | Standards Track | December 2010 | — | — | Specifies how iTIP messages are transported via email (MIME encapsulation); critical for email-based calendar invitations and VTODO assignments |

---

## WebDAV Push / Sync

| RFC | File | Title | Status | Published | Updated by | Obsoleted by | Relevance |
|-----|------|-------|--------|-----------|------------|--------------|-----------|
| [RFC 6578](rfc6578.txt) | `rfc6578.txt` | Collection Synchronization for WebDAV | Standards Track | March 2012 | — | — | Defines the sync-collection REPORT and sync-token property for efficient incremental sync — clients only fetch changed resources since last sync |

---

## Key Dependencies and Relationships

```
RFC 4918 (WebDAV)
  └─ RFC 4791 (CalDAV) ─── updated by ──► RFC 6638 (Scheduling)
       │                                   RFC 6764 (Discovery)
       │                                   RFC 7809 (TZ by Ref)
       │                                   RFC 7953 (Availability)
       │
       └─ RFC 6578 (Sync) [WebDAV extension used by CalDAV clients]

RFC 5545 (iCalendar) ── updated by ──► RFC 5546 (iTIP)
       │                                RFC 7953 (VAVAILABILITY)
       │                                RFC 9253 (Relationships)
       │
       ├─ §3.6.2 ──► VTODO spec
       └─ RFC 6047 (iMIP — email transport for iTIP)
```

## Notes on Obsolete Status

- **RFC 4791**: NOT obsoleted. Active. Updated by RFC 6638, 6764, 7809, 7953, 8996.
- **RFC 5545**: NOT obsoleted. Active. Updated by RFC 5546, 6868, 7529, 7953, 7986, 9073, 9074, 9253.
- **RFC 4918** obsoletes RFC 2518 (original WebDAV spec). RFC 4918 itself is updated only by RFC 5689 (extended MKCOL), not obsoleted.
- **RFC 5546** obsoletes RFC 2446. Updated by RFC 6638.
- **RFC 6047** obsoletes RFC 2447.
