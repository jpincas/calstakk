// Storage layer — defines the Storage interface and provides MemoryStorage
// for tests and local development. KVStorage (Deno KV) lives in storage_kv.ts.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Calendar {
  name: string;
  displayName: string;
  href: string; // URL path
  customProps: Record<string, string>; // namespace:local → XML value
}

export interface CalendarObject {
  uid: string; // URL-path identifier (filename without .ics)
  icalUID: string; // UID property from the iCalendar data
  href: string;
  etag: string;
  ics: string;
  lastModified: Date;
  contentLength: number;
}

export interface SyncChange {
  uid: string; // object uid (not icalUID)
  type: "added" | "modified" | "deleted";
}

export interface SyncResult {
  changes: SyncChange[];
  newToken: string;
  invalidToken?: boolean;
}

// ─── Storage interface ────────────────────────────────────────────────────────

export interface Storage {
  // Calendars (collections)
  listCalendars(): Promise<Calendar[]>;
  getCalendar(name: string): Promise<Calendar | null>;
  createCalendar(name: string, displayName: string): Promise<void>;
  deleteCalendar(name: string): Promise<void>;
  updateCalendarDisplayName(name: string, displayName: string): Promise<void>;
  updateCalendarProp(name: string, key: string, value: string): Promise<void>;

  // Calendar objects
  listObjects(calendarName: string): Promise<CalendarObject[]>;
  getObject(calendarName: string, uid: string): Promise<CalendarObject | null>;
  /** Returns the existing object uid for a given ical UID, or null. */
  findObjectByICalUID(calendarName: string, icalUID: string): Promise<string | null>;
  putObject(calendarName: string, uid: string, ics: string, icalUID: string): Promise<CalendarObject>;
  deleteObject(calendarName: string, uid: string): Promise<void>;

  // Sync
  getSyncToken(calendarName: string): Promise<string>;
  getChanges(calendarName: string, sinceToken: string): Promise<SyncResult>;
}

// ─── ETag computation ─────────────────────────────────────────────────────────

export async function computeETag(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

// ─── MemoryStorage ────────────────────────────────────────────────────────────

interface StoredCalendar {
  name: string;
  displayName: string;
  customProps: Record<string, string>;
  objects: Map<string, CalendarObject>; // key: uid (url-path id)
  icalUIDIndex: Map<string, string>; // icalUID → uid
  syncCounter: number;
  syncLog: Array<SyncChange & { token: number }>;
}

function tokenString(n: number): string {
  return String(n);
}

export class MemoryStorage implements Storage {
  private calendars = new Map<string, StoredCalendar>();

  async listCalendars(): Promise<Calendar[]> {
    return Array.from(this.calendars.values()).map((c) => ({
      name: c.name,
      displayName: c.displayName,
      customProps: { ...c.customProps },
      href: `/calstakk/calendars/${c.name}`,
    }));
  }

  async getCalendar(name: string): Promise<Calendar | null> {
    const c = this.calendars.get(name);
    if (!c) return null;
    return {
      name: c.name,
      displayName: c.displayName,
      customProps: { ...c.customProps },
      href: `/calstakk/calendars/${c.name}`,
    };
  }

  async createCalendar(name: string, displayName: string): Promise<void> {
    if (this.calendars.has(name)) {
      throw new Error(`Calendar ${name} already exists`);
    }
    this.calendars.set(name, {
      name,
      displayName: displayName || name,
      customProps: {},
      objects: new Map(),
      icalUIDIndex: new Map(),
      syncCounter: 0,
      syncLog: [],
    });
  }

  async deleteCalendar(name: string): Promise<void> {
    if (!this.calendars.has(name)) {
      throw new Error(`Calendar ${name} not found`);
    }
    this.calendars.delete(name);
  }

  async updateCalendarDisplayName(name: string, displayName: string): Promise<void> {
    const c = this.calendars.get(name);
    if (!c) throw new Error(`Calendar ${name} not found`);
    c.displayName = displayName;
  }

  async updateCalendarProp(name: string, key: string, value: string): Promise<void> {
    const c = this.calendars.get(name);
    if (!c) throw new Error(`Calendar ${name} not found`);
    c.customProps[key] = value;
  }

  async listObjects(calendarName: string): Promise<CalendarObject[]> {
    const c = this.calendars.get(calendarName);
    if (!c) return [];
    return Array.from(c.objects.values());
  }

  async getObject(calendarName: string, uid: string): Promise<CalendarObject | null> {
    const c = this.calendars.get(calendarName);
    if (!c) return null;
    return c.objects.get(uid) ?? null;
  }

  async findObjectByICalUID(calendarName: string, icalUID: string): Promise<string | null> {
    const c = this.calendars.get(calendarName);
    if (!c) return null;
    return c.icalUIDIndex.get(icalUID) ?? null;
  }

  async putObject(
    calendarName: string,
    uid: string,
    ics: string,
    icalUID: string,
  ): Promise<CalendarObject> {
    const c = this.calendars.get(calendarName);
    if (!c) throw new Error(`Calendar ${calendarName} not found`);

    const etag = await computeETag(ics);
    const now = new Date();
    const obj: CalendarObject = {
      uid,
      icalUID,
      href: `/calstakk/calendars/${calendarName}/${uid}.ics`,
      etag,
      ics,
      lastModified: now,
      contentLength: new TextEncoder().encode(ics).length,
    };

    const isNew = !c.objects.has(uid);
    // Remove old icalUID index entry if updating
    const old = c.objects.get(uid);
    if (old && old.icalUID !== icalUID) {
      c.icalUIDIndex.delete(old.icalUID);
    }

    c.objects.set(uid, obj);
    c.icalUIDIndex.set(icalUID, uid);

    c.syncCounter++;
    c.syncLog.push({ uid, type: isNew ? "added" : "modified", token: c.syncCounter });

    return obj;
  }

  async deleteObject(calendarName: string, uid: string): Promise<void> {
    const c = this.calendars.get(calendarName);
    if (!c) throw new Error(`Calendar ${calendarName} not found`);
    const obj = c.objects.get(uid);
    if (!obj) throw new Error(`Object ${uid} not found`);
    if (obj.icalUID) c.icalUIDIndex.delete(obj.icalUID);
    c.objects.delete(uid);

    c.syncCounter++;
    c.syncLog.push({ uid, type: "deleted", token: c.syncCounter });
  }

  async getSyncToken(calendarName: string): Promise<string> {
    const c = this.calendars.get(calendarName);
    if (!c) return "0";
    return tokenString(c.syncCounter);
  }

  async getChanges(calendarName: string, sinceToken: string): Promise<SyncResult> {
    const c = this.calendars.get(calendarName);
    if (!c) return { changes: [], newToken: "0" };

    const newToken = tokenString(c.syncCounter);

    if (sinceToken === "") {
      // Initial full sync
      const changes: SyncChange[] = Array.from(c.objects.keys()).map((uid) => ({
        uid,
        type: "added",
      }));
      return { changes, newToken };
    }

    const since = parseInt(sinceToken, 10);
    if (isNaN(since)) {
      // Non-empty token that doesn't parse — invalid per RFC 6578 §7
      return { changes: [], newToken, invalidToken: true };
    }

    if (since === 0) {
      // Full sync: return all current objects as "added"
      const changes: SyncChange[] = Array.from(c.objects.keys()).map((uid) => ({
        uid,
        type: "added",
      }));
      return { changes, newToken };
    }

    // Incremental: return log entries since the token
    const changes: SyncChange[] = c.syncLog
      .filter((e) => e.token > since)
      .map(({ uid, type }) => ({ uid, type }));

    // Deduplicate: keep only the latest change per uid
    const seen = new Map<string, SyncChange>();
    for (const ch of changes) {
      seen.set(ch.uid, ch);
    }

    return { changes: Array.from(seen.values()), newToken };
  }
}
