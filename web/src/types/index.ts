export interface Collection {
  name: string
  display_name: string
  href: string
  color?: string
  description?: string
  order?: number
  group?: string
  /**
   * UI identifier, usable anywhere a collection name is accepted (routes,
   * query keys, caldav calls). Own collections: the plain name. Collections
   * shared by another user: `${owner}~${name}`.
   */
  ref: string
  /** Username of the owning principal. */
  owner: string
  /** True when the collection lives in another user's calendar home. */
  shared: boolean
  /** The current user's effective access on this collection. */
  myAccess: 'owner' | 'read-write' | 'read'
  /** Who this collection is shared with — populated for the owner only. */
  sharedWith?: Sharee[]
}

/** A user a collection is shared with, and their access level. */
export interface Sharee {
  username: string
  access: 'read' | 'read-write'
}

/** Identity of the authenticated user (from /api/me). */
export interface Me {
  username: string
  displayName: string
  email: string
  timezone: string
  isAdmin: boolean
}

/** A user account as managed via the admin API. */
export interface UserAccount {
  username: string
  displayName: string
  email: string
  timezone: string
  isAdmin: boolean
}

/** A principal found via principal search (for the share picker). */
export interface PrincipalMatch {
  username: string
  displayName: string
}

/**
 * Fields shared by a master VEVENT and a per-occurrence override VEVENT.
 * Datetime values are iCal compact strings (20260101T090000Z, 20260706).
 * The `_raw` carriers preserve foreign-client data byte-for-byte on round-trip;
 * the UI never reads them.
 */
export interface EventFields {
  summary: string
  description?: string
  start: string
  end?: string
  duration?: string
  all_day?: boolean
  location?: string
  /** TENTATIVE | CONFIRMED | CANCELLED (server-enforced). */
  status?: string
  /** OPAQUE (busy) | TRANSPARENT (free). */
  transp?: string
  categories?: string[]
  url?: string
  /** Simple reminder: TRIGGER value of the recognized DISPLAY alarm, e.g. "-PT15M". */
  reminder?: string
  /** Raw DTSTART/DTEND lines, kept only when the original carried params (TZID, VALUE=DATE). */
  start_raw?: string
  end_raw?: string
  /** Raw VALARM blocks, verbatim (unfolded lines joined with \n). */
  alarms_raw?: string[]
  /** Index into alarms_raw of the alarm `reminder` was derived from; undefined = reminder is new. */
  reminder_alarm_index?: number
  /** Verbatim unfolded lines of every property the UI doesn't model (CLASS, PRIORITY, GEO, X-*, …). */
  extra_lines?: string[]
}

/**
 * A per-occurrence override VEVENT (RECURRENCE-ID). Sparse: holds only the
 * properties the component actually carries; display resolution against the
 * master happens at expansion time (see lib/recur.ts).
 */
export interface EventOverride extends Partial<EventFields> {
  /** RECURRENCE-ID value naming the original occurrence start, in the master's DTSTART form. */
  recurrence_id: string
  /** Raw RECURRENCE-ID line when the original carried params (TZID, RANGE, …). */
  recurrence_id_raw?: string
}

/** One calendar object resource (.ics file): master VEVENT + any overrides. */
export interface CalEvent extends EventFields {
  uid: string
  rrule?: string
  /** Individual EXDATE values (comma-lists split), in the master's DTSTART form. */
  exdates?: string[]
  /** Raw EXDATE lines; re-emitted verbatim while the exdates list is untouched. */
  exdates_raw?: string[]
  overrides?: EventOverride[]
  /** Raw VTIMEZONE blocks from the resource, re-emitted verbatim on save. */
  vtimezones_raw?: string[]
  /** Entity tag from the last read; sent as If-Match on update to detect conflicts. */
  etag?: string
  href: string
}

export interface Todo {
  uid: string
  summary: string
  description?: string
  due?: string
  status?: string
  priority?: number
  related_to?: string
  /** Uid of a todo this one waits on (RELATED-TO;RELTYPE=DEPENDS-ON, RFC 9253). */
  depends_on?: string
  categories?: string[]
  url?: string
  x_sort_order?: number
  section_id?: string
  href: string
}

/** A named group of tasks within a collection. Persisted as X-SECTION-ID on each VTODO. */
export interface Section {
  id: string
  name: string
}

export type DataType = 'calendar' | 'todos'
export type ViewMode = 'home' | 'inbox' | 'today' | 'tasks' | 'waiting' | 'calendar'
