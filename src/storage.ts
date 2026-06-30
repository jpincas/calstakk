// Storage layer — defines the Storage interface and provides MemoryStorage
// for tests and local development. KVStorage (Deno KV) lives in storage_kv.ts.

import type { User } from "./types.ts";

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
  deadProps: Record<string, string>; // "ns\x00local" → raw XML element
}

export interface InboxItem {
  uid: string;
  ics: string;
  href: string;
  etag: string;
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
  // ── User management ────────────────────────────────────────────────────────
  getUser(username: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(user: User): Promise<void>;
  updateUser(username: string, updates: Partial<Pick<User, "passwordHash" | "displayName" | "email" | "timezone" | "isAdmin">>): Promise<void>;
  deleteUser(username: string): Promise<void>;

  // ── Calendars (all user-scoped) ────────────────────────────────────────────
  listCalendars(username: string): Promise<Calendar[]>;
  getCalendar(username: string, name: string): Promise<Calendar | null>;
  createCalendar(username: string, name: string, displayName: string): Promise<void>;
  deleteCalendar(username: string, name: string): Promise<void>;
  updateCalendarDisplayName(username: string, name: string, displayName: string): Promise<void>;
  updateCalendarProp(username: string, name: string, key: string, value: string): Promise<void>;

  // ── Calendar objects ───────────────────────────────────────────────────────
  listObjects(username: string, calendarName: string): Promise<CalendarObject[]>;
  getObject(username: string, calendarName: string, uid: string): Promise<CalendarObject | null>;
  /** Returns the existing object uid for a given ical UID, or null. */
  findObjectByICalUID(username: string, calendarName: string, icalUID: string): Promise<string | null>;
  /** Find an object with the given ical UID in any calendar of the user. Returns { calendarName, uid } or null. */
  findObjectByICalUIDGlobal(username: string, icalUID: string): Promise<{ calendarName: string; uid: string } | null>;
  putObject(username: string, calendarName: string, uid: string, ics: string, icalUID: string): Promise<CalendarObject>;
  deleteObject(username: string, calendarName: string, uid: string): Promise<void>;
  updateObjectProp(username: string, calendarName: string, uid: string, key: string, rawXml: string): Promise<void>;
  copyObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject>;
  moveObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject>;

  // ── Sync ───────────────────────────────────────────────────────────────────
  getSyncToken(username: string, calendarName: string): Promise<string>;
  getChanges(username: string, calendarName: string, sinceToken: string): Promise<SyncResult>;

  // ── Scheduling inbox ───────────────────────────────────────────────────────
  listInboxItems(username: string): Promise<InboxItem[]>;
  putInboxItem(username: string, uid: string, ics: string): Promise<InboxItem>;
  deleteInboxItem(username: string, uid: string): Promise<void>;
}

// ─── ETag computation ─────────────────────────────────────────────────────────

export async function computeETag(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `"${b64}"`;
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
  private users = new Map<string, User>();
  private emailIndex = new Map<string, string>(); // email → username
  // Per-user calendars: username → calName → StoredCalendar
  private userCalendars = new Map<string, Map<string, StoredCalendar>>();
  // Per-user inbox items: username → uid → InboxItem
  private userInbox = new Map<string, Map<string, InboxItem>>();

  // ── User management ────────────────────────────────────────────────────────

  async getUser(username: string): Promise<User | null> {
    return this.users.get(username) ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const username = this.emailIndex.get(email.toLowerCase());
    if (!username) return null;
    return this.users.get(username) ?? null;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(user: User): Promise<void> {
    if (this.users.has(user.username)) throw new Error(`User ${user.username} already exists`);
    this.users.set(user.username, user);
    if (user.email) this.emailIndex.set(user.email.toLowerCase(), user.username);
    this.userCalendars.set(user.username, new Map());
    this.userInbox.set(user.username, new Map());
  }

  async updateUser(
    username: string,
    updates: Partial<Pick<User, "passwordHash" | "displayName" | "email" | "timezone" | "isAdmin">>,
  ): Promise<void> {
    const user = this.users.get(username);
    if (!user) throw new Error(`User ${username} not found`);
    if (updates.email && updates.email !== user.email) {
      if (user.email) this.emailIndex.delete(user.email.toLowerCase());
      this.emailIndex.set(updates.email.toLowerCase(), username);
    }
    Object.assign(user, updates);
  }

  async deleteUser(username: string): Promise<void> {
    const user = this.users.get(username);
    if (!user) throw new Error(`User ${username} not found`);
    if (user.email) this.emailIndex.delete(user.email.toLowerCase());
    this.users.delete(username);
    this.userCalendars.delete(username);
    this.userInbox.delete(username);
  }

  // ── Calendars ──────────────────────────────────────────────────────────────

  private _cals(username: string): Map<string, StoredCalendar> {
    let m = this.userCalendars.get(username);
    if (!m) { m = new Map(); this.userCalendars.set(username, m); }
    return m;
  }

  async listCalendars(username: string): Promise<Calendar[]> {
    return Array.from(this._cals(username).values()).map((c) => calView(username, c));
  }

  async getCalendar(username: string, name: string): Promise<Calendar | null> {
    const c = this._cals(username).get(name);
    if (!c) return null;
    return calView(username, c);
  }

  async createCalendar(username: string, name: string, displayName: string): Promise<void> {
    const cals = this._cals(username);
    if (cals.has(name)) throw new Error(`Calendar ${name} already exists`);
    cals.set(name, {
      name,
      displayName: displayName || name,
      customProps: {},
      objects: new Map(),
      icalUIDIndex: new Map(),
      syncCounter: 0,
      syncLog: [],
    });
  }

  async deleteCalendar(username: string, name: string): Promise<void> {
    const cals = this._cals(username);
    if (!cals.has(name)) throw new Error(`Calendar ${name} not found`);
    cals.delete(name);
  }

  async updateCalendarDisplayName(username: string, name: string, displayName: string): Promise<void> {
    const c = this._cals(username).get(name);
    if (!c) throw new Error(`Calendar ${name} not found`);
    c.displayName = displayName;
  }

  async updateCalendarProp(username: string, name: string, key: string, value: string): Promise<void> {
    const c = this._cals(username).get(name);
    if (!c) throw new Error(`Calendar ${name} not found`);
    c.customProps[key] = value;
  }

  // ── Objects ────────────────────────────────────────────────────────────────

  async listObjects(username: string, calendarName: string): Promise<CalendarObject[]> {
    const c = this._cals(username).get(calendarName);
    if (!c) return [];
    return Array.from(c.objects.values());
  }

  async getObject(username: string, calendarName: string, uid: string): Promise<CalendarObject | null> {
    const c = this._cals(username).get(calendarName);
    if (!c) return null;
    return c.objects.get(uid) ?? null;
  }

  async findObjectByICalUID(username: string, calendarName: string, icalUID: string): Promise<string | null> {
    const c = this._cals(username).get(calendarName);
    if (!c) return null;
    return c.icalUIDIndex.get(icalUID) ?? null;
  }

  async findObjectByICalUIDGlobal(username: string, icalUID: string): Promise<{ calendarName: string; uid: string } | null> {
    for (const [calendarName, cal] of this._cals(username)) {
      const uid = cal.icalUIDIndex.get(icalUID);
      if (uid) return { calendarName, uid };
    }
    return null;
  }

  async putObject(
    username: string,
    calendarName: string,
    uid: string,
    ics: string,
    icalUID: string,
  ): Promise<CalendarObject> {
    const c = this._cals(username).get(calendarName);
    if (!c) throw new Error(`Calendar ${calendarName} not found`);

    const existing = c.objects.get(uid);
    const etag = await computeETag(ics);
    const now = new Date();
    const obj: CalendarObject = {
      uid,
      icalUID,
      href: `/calendars/${username}/${calendarName}/${uid}.ics`,
      etag,
      ics,
      lastModified: now,
      contentLength: new TextEncoder().encode(ics).length,
      deadProps: existing?.deadProps ?? {},
    };

    const isNew = !c.objects.has(uid);
    const old = c.objects.get(uid);
    if (old && old.icalUID !== icalUID) c.icalUIDIndex.delete(old.icalUID);

    c.objects.set(uid, obj);
    c.icalUIDIndex.set(icalUID, uid);
    c.syncCounter++;
    c.syncLog.push({ uid, type: isNew ? "added" : "modified", token: c.syncCounter });

    return obj;
  }

  async deleteObject(username: string, calendarName: string, uid: string): Promise<void> {
    const c = this._cals(username).get(calendarName);
    if (!c) throw new Error(`Calendar ${calendarName} not found`);
    const obj = c.objects.get(uid);
    if (!obj) throw new Error(`Object ${uid} not found`);
    if (obj.icalUID) c.icalUIDIndex.delete(obj.icalUID);
    c.objects.delete(uid);
    c.syncCounter++;
    c.syncLog.push({ uid, type: "deleted", token: c.syncCounter });
  }

  async updateObjectProp(username: string, calendarName: string, uid: string, key: string, rawXml: string): Promise<void> {
    const c = this._cals(username).get(calendarName);
    if (!c) throw new Error(`Calendar ${calendarName} not found`);
    const obj = c.objects.get(uid);
    if (!obj) throw new Error(`Object ${uid} not found`);
    obj.deadProps[key] = rawXml;
  }

  async copyObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject> {
    const cals = this._cals(username);
    const srcCal = cals.get(srcCalName);
    if (!srcCal) throw new Error(`Source calendar ${srcCalName} not found`);
    const src = srcCal.objects.get(srcUid);
    if (!src) throw new Error(`Source object ${srcUid} not found`);

    const dstCal = cals.get(dstCalName);
    if (!dstCal) throw new Error(`Destination calendar ${dstCalName} not found`);

    const now = new Date();
    const dst: CalendarObject = {
      ...src,
      uid: dstUid,
      href: `/calendars/${username}/${dstCalName}/${dstUid}.ics`,
      lastModified: now,
      deadProps: { ...src.deadProps },
    };

    const isNew = !dstCal.objects.has(dstUid);
    const oldDst = dstCal.objects.get(dstUid);
    if (oldDst && oldDst.icalUID !== dst.icalUID) dstCal.icalUIDIndex.delete(oldDst.icalUID);
    dstCal.objects.set(dstUid, dst);
    dstCal.icalUIDIndex.set(dst.icalUID, dstUid);
    dstCal.syncCounter++;
    dstCal.syncLog.push({ uid: dstUid, type: isNew ? "added" : "modified", token: dstCal.syncCounter });

    return dst;
  }

  async moveObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject> {
    const dst = await this.copyObject(username, srcCalName, srcUid, dstCalName, dstUid);
    await this.deleteObject(username, srcCalName, srcUid);
    return dst;
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  async getSyncToken(username: string, calendarName: string): Promise<string> {
    const c = this._cals(username).get(calendarName);
    if (!c) return "0";
    return tokenString(c.syncCounter);
  }

  async getChanges(username: string, calendarName: string, sinceToken: string): Promise<SyncResult> {
    const c = this._cals(username).get(calendarName);
    if (!c) return { changes: [], newToken: "0" };

    const newToken = tokenString(c.syncCounter);

    if (sinceToken === "") {
      const changes: SyncChange[] = Array.from(c.objects.keys()).map((uid) => ({
        uid,
        type: "added",
      }));
      return { changes, newToken };
    }

    const since = parseInt(sinceToken, 10);
    if (isNaN(since)) return { changes: [], newToken, invalidToken: true };

    const changes: SyncChange[] = c.syncLog
      .filter((e) => e.token > since)
      .map(({ uid, type }) => ({ uid, type }));

    const seen = new Map<string, SyncChange>();
    for (const ch of changes) seen.set(ch.uid, ch);

    return { changes: Array.from(seen.values()), newToken };
  }

  // ── Scheduling inbox ───────────────────────────────────────────────────────

  private _inbox(username: string): Map<string, InboxItem> {
    let m = this.userInbox.get(username);
    if (!m) { m = new Map(); this.userInbox.set(username, m); }
    return m;
  }

  async listInboxItems(username: string): Promise<InboxItem[]> {
    return Array.from(this._inbox(username).values());
  }

  async putInboxItem(username: string, uid: string, ics: string): Promise<InboxItem> {
    const etag = await computeETag(ics);
    const item: InboxItem = {
      uid,
      ics,
      href: `/calendars/${username}/inbox/${uid}.ics`,
      etag,
      lastModified: new Date(),
      contentLength: new TextEncoder().encode(ics).length,
    };
    this._inbox(username).set(uid, item);
    return item;
  }

  async deleteInboxItem(username: string, uid: string): Promise<void> {
    const inbox = this._inbox(username);
    if (!inbox.has(uid)) throw new Error(`Inbox item ${uid} not found`);
    inbox.delete(uid);
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function calView(username: string, c: StoredCalendar): Calendar {
  return {
    name: c.name,
    displayName: c.displayName,
    customProps: { ...c.customProps },
    href: `/calendars/${username}/${c.name}`,
  };
}
