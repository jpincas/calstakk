// Deno KV–backed storage implementation.
//
// Key schema:
//   ["user", username]                          → User
//   ["uemail", emailLower]                      → username  (email → username index)
//   ["cal", username, calName]                  → CalMeta
//   ["obj", username, calName, uid]             → StoredObj
//   ["ical", username, calName, icalUID]        → uid
//   ["log", username, calName, token: number]   → LogEntry
//   ["inbox", username, uid]                    → StoredInboxItem

import type { User } from "./types.ts";
import type { Calendar, CalendarObject, InboxItem, Storage, SyncChange, SyncResult } from "./storage.ts";
import { computeETag } from "./storage.ts";

// ─── Stored shapes ────────────────────────────────────────────────────────────

interface CalMeta {
  displayName: string;
  customProps: Record<string, string>;
  syncCounter: number;
}

interface StoredObj {
  uid: string;
  icalUID: string;
  href: string;
  etag: string;
  ics: string;
  lastModified: string; // ISO 8601
  contentLength: number;
  deadProps?: Record<string, string>;
}

interface StoredInboxItem {
  uid: string;
  ics: string;
  href: string;
  etag: string;
  lastModified: string;
  contentLength: number;
}

interface LogEntry {
  uid: string;
  type: SyncChange["type"];
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function userKey(username: string): Deno.KvKey { return ["user", username]; }
function uemailKey(email: string): Deno.KvKey { return ["uemail", email.toLowerCase()]; }
function calKey(username: string, name: string): Deno.KvKey { return ["cal", username, name]; }
function objKey(username: string, calName: string, uid: string): Deno.KvKey { return ["obj", username, calName, uid]; }
function icalKey(username: string, calName: string, icalUID: string): Deno.KvKey { return ["ical", username, calName, icalUID]; }
function logKey(username: string, calName: string, token: number): Deno.KvKey { return ["log", username, calName, token]; }
function inboxKey(username: string, uid: string): Deno.KvKey { return ["inbox", username, uid]; }

function tokenStr(n: number): string { return String(n); }

function toCalObj(s: StoredObj): CalendarObject {
  return {
    uid: s.uid,
    icalUID: s.icalUID,
    href: s.href,
    etag: s.etag,
    ics: s.ics,
    lastModified: new Date(s.lastModified),
    contentLength: s.contentLength,
    deadProps: s.deadProps ?? {},
  };
}

function toInboxItem(s: StoredInboxItem): InboxItem {
  return {
    uid: s.uid,
    ics: s.ics,
    href: s.href,
    etag: s.etag,
    lastModified: new Date(s.lastModified),
    contentLength: s.contentLength,
  };
}

// ─── KVStorage ────────────────────────────────────────────────────────────────

export class KVStorage implements Storage {
  constructor(private readonly kv: Deno.Kv) {}

  // ── User management ────────────────────────────────────────────────────────

  async getUser(username: string): Promise<User | null> {
    const entry = await this.kv.get<User>(userKey(username));
    return entry.value ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const idx = await this.kv.get<string>(uemailKey(email));
    if (!idx.value) return null;
    return this.getUser(idx.value);
  }

  async listUsers(): Promise<User[]> {
    const results: User[] = [];
    for await (const entry of this.kv.list<User>({ prefix: ["user"] })) {
      results.push(entry.value);
    }
    return results;
  }

  async createUser(user: User): Promise<void> {
    const key = userKey(user.username);
    const existing = await this.kv.get(key);
    if (existing.value !== null) throw new Error(`User ${user.username} already exists`);
    const txn = this.kv.atomic().check(existing).set(key, user);
    if (user.email) txn.set(uemailKey(user.email), user.username);
    const res = await txn.commit();
    if (!res.ok) throw new Error(`User ${user.username} already exists`);
  }

  async updateUser(
    username: string,
    updates: Partial<Pick<User, "passwordHash" | "displayName" | "email" | "timezone" | "isAdmin">>,
  ): Promise<void> {
    const key = userKey(username);
    while (true) {
      const entry = await this.kv.get<User>(key);
      if (!entry.value) throw new Error(`User ${username} not found`);
      const oldEmail = entry.value.email;
      const updated = { ...entry.value, ...updates };
      const txn = this.kv.atomic().check(entry).set(key, updated);
      if (updates.email && updates.email !== oldEmail) {
        if (oldEmail) txn.delete(uemailKey(oldEmail));
        txn.set(uemailKey(updates.email), username);
      }
      const res = await txn.commit();
      if (res.ok) return;
    }
  }

  async deleteUser(username: string): Promise<void> {
    const entry = await this.kv.get<User>(userKey(username));
    if (!entry.value) throw new Error(`User ${username} not found`);
    const email = entry.value.email;
    // Delete all user data
    for await (const e of this.kv.list({ prefix: ["cal", username] })) await this.kv.delete(e.key);
    for await (const e of this.kv.list({ prefix: ["obj", username] })) await this.kv.delete(e.key);
    for await (const e of this.kv.list({ prefix: ["ical", username] })) await this.kv.delete(e.key);
    for await (const e of this.kv.list({ prefix: ["log", username] })) await this.kv.delete(e.key);
    for await (const e of this.kv.list({ prefix: ["inbox", username] })) await this.kv.delete(e.key);
    if (email) await this.kv.delete(uemailKey(email));
    await this.kv.delete(userKey(username));
  }

  // ── Calendars ──────────────────────────────────────────────────────────────

  async listCalendars(username: string): Promise<Calendar[]> {
    const results: Calendar[] = [];
    for await (const entry of this.kv.list<CalMeta>({ prefix: ["cal", username] })) {
      const name = entry.key[2] as string;
      results.push(calFromMeta(username, name, entry.value));
    }
    return results;
  }

  async getCalendar(username: string, name: string): Promise<Calendar | null> {
    const entry = await this.kv.get<CalMeta>(calKey(username, name));
    if (!entry.value) return null;
    return calFromMeta(username, name, entry.value);
  }

  async createCalendar(username: string, name: string, displayName: string): Promise<void> {
    const key = calKey(username, name);
    const existing = await this.kv.get(key);
    if (existing.value !== null) throw new Error(`Calendar ${name} already exists`);
    const meta: CalMeta = { displayName: displayName || name, customProps: {}, syncCounter: 0 };
    const res = await this.kv.atomic().check(existing).set(key, meta).commit();
    if (!res.ok) throw new Error(`Calendar ${name} already exists`);
  }

  async deleteCalendar(username: string, name: string): Promise<void> {
    for await (const entry of this.kv.list({ prefix: ["obj", username, name] })) await this.kv.delete(entry.key);
    for await (const entry of this.kv.list({ prefix: ["ical", username, name] })) await this.kv.delete(entry.key);
    for await (const entry of this.kv.list({ prefix: ["log", username, name] })) await this.kv.delete(entry.key);
    await this.kv.delete(calKey(username, name));
  }

  async updateCalendarDisplayName(username: string, name: string, displayName: string): Promise<void> {
    await this._patchMeta(username, name, (m) => ({ ...m, displayName }));
  }

  async updateCalendarProp(username: string, name: string, key: string, value: string): Promise<void> {
    await this._patchMeta(username, name, (m) => ({
      ...m,
      customProps: { ...m.customProps, [key]: value },
    }));
  }

  // ── Objects ────────────────────────────────────────────────────────────────

  async listObjects(username: string, calendarName: string): Promise<CalendarObject[]> {
    const results: CalendarObject[] = [];
    for await (const entry of this.kv.list<StoredObj>({ prefix: ["obj", username, calendarName] })) {
      results.push(toCalObj(entry.value));
    }
    return results;
  }

  async getObject(username: string, calendarName: string, uid: string): Promise<CalendarObject | null> {
    const entry = await this.kv.get<StoredObj>(objKey(username, calendarName, uid));
    if (!entry.value) return null;
    return toCalObj(entry.value);
  }

  async findObjectByICalUID(username: string, calendarName: string, icalUID: string): Promise<string | null> {
    const entry = await this.kv.get<string>(icalKey(username, calendarName, icalUID));
    return entry.value ?? null;
  }

  async findObjectByICalUIDGlobal(username: string, icalUID: string): Promise<{ calendarName: string; uid: string } | null> {
    const cals = await this.listCalendars(username);
    for (const cal of cals) {
      const uid = await this.findObjectByICalUID(username, cal.name, icalUID);
      if (uid) return { calendarName: cal.name, uid };
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
    const etag = await computeETag(ics);
    const now = new Date();
    const href = `/calendars/${username}/${calendarName}/${uid}.ics`;
    const stored: StoredObj = {
      uid,
      icalUID,
      href,
      etag,
      ics,
      lastModified: now.toISOString(),
      contentLength: new TextEncoder().encode(ics).length,
    };

    const cKey = calKey(username, calendarName);
    const oKey = objKey(username, calendarName, uid);

    while (true) {
      const [metaEntry, objEntry] = await this.kv.getMany<[CalMeta, StoredObj]>([cKey, oKey]);
      if (!metaEntry.value) throw new Error(`Calendar ${calendarName} not found`);

      const newCounter = metaEntry.value.syncCounter + 1;
      const isNew = objEntry.value === null;
      const oldIcalUID = objEntry.value?.icalUID;

      const txn = this.kv.atomic()
        .check(metaEntry)
        .check(objEntry)
        .set(cKey, { ...metaEntry.value, syncCounter: newCounter })
        .set(oKey, stored)
        .set(icalKey(username, calendarName, icalUID), uid)
        .set(logKey(username, calendarName, newCounter), {
          uid,
          type: isNew ? "added" : "modified",
        } satisfies LogEntry);

      if (oldIcalUID && oldIcalUID !== icalUID) {
        txn.delete(icalKey(username, calendarName, oldIcalUID));
      }

      const res = await txn.commit();
      if (res.ok) return toCalObj(stored);
    }
  }

  async deleteObject(username: string, calendarName: string, uid: string): Promise<void> {
    const cKey = calKey(username, calendarName);
    const oKey = objKey(username, calendarName, uid);

    while (true) {
      const [metaEntry, objEntry] = await this.kv.getMany<[CalMeta, StoredObj]>([cKey, oKey]);
      if (!metaEntry.value) throw new Error(`Calendar ${calendarName} not found`);
      if (!objEntry.value) throw new Error(`Object ${uid} not found`);

      const newCounter = metaEntry.value.syncCounter + 1;
      const icalUID = objEntry.value.icalUID;

      const res = await this.kv.atomic()
        .check(metaEntry)
        .check(objEntry)
        .set(cKey, { ...metaEntry.value, syncCounter: newCounter })
        .delete(oKey)
        .delete(icalKey(username, calendarName, icalUID))
        .set(logKey(username, calendarName, newCounter), { uid, type: "deleted" } satisfies LogEntry)
        .commit();

      if (res.ok) return;
    }
  }

  async updateObjectProp(username: string, calendarName: string, uid: string, key: string, rawXml: string): Promise<void> {
    const oKey = objKey(username, calendarName, uid);
    while (true) {
      const entry = await this.kv.get<StoredObj>(oKey);
      if (!entry.value) throw new Error(`Object ${uid} not found`);
      const updated: StoredObj = {
        ...entry.value,
        deadProps: { ...entry.value.deadProps, [key]: rawXml },
      };
      const res = await this.kv.atomic().check(entry).set(oKey, updated).commit();
      if (res.ok) return;
    }
  }

  async copyObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject> {
    const srcEntry = await this.kv.get<StoredObj>(objKey(username, srcCalName, srcUid));
    if (!srcEntry.value) throw new Error(`Source object ${srcUid} not found`);
    const src = srcEntry.value;
    const dst = await this.putObject(username, dstCalName, dstUid, src.ics, src.icalUID);
    if (src.deadProps && Object.keys(src.deadProps).length > 0) {
      for (const [k, v] of Object.entries(src.deadProps)) {
        await this.updateObjectProp(username, dstCalName, dstUid, k, v);
      }
    }
    return dst;
  }

  async moveObject(username: string, srcCalName: string, srcUid: string, dstCalName: string, dstUid: string): Promise<CalendarObject> {
    const dst = await this.copyObject(username, srcCalName, srcUid, dstCalName, dstUid);
    await this.deleteObject(username, srcCalName, srcUid);
    return dst;
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  async getSyncToken(username: string, calendarName: string): Promise<string> {
    const entry = await this.kv.get<CalMeta>(calKey(username, calendarName));
    return tokenStr(entry.value?.syncCounter ?? 0);
  }

  async getChanges(username: string, calendarName: string, sinceToken: string): Promise<SyncResult> {
    const metaEntry = await this.kv.get<CalMeta>(calKey(username, calendarName));
    if (!metaEntry.value) return { changes: [], newToken: "0" };

    const newToken = tokenStr(metaEntry.value.syncCounter);

    if (sinceToken === "") {
      return { changes: await this._allObjectsAsAdded(username, calendarName), newToken };
    }

    const since = parseInt(sinceToken, 10);
    if (isNaN(since)) return { changes: [], newToken, invalidToken: true };
    if (since === 0) return { changes: await this._allObjectsAsAdded(username, calendarName), newToken };

    const raw: LogEntry[] = [];
    for await (const entry of this.kv.list<LogEntry>({ prefix: ["log", username, calendarName] })) {
      const token = entry.key[3] as number;
      if (token > since) raw.push(entry.value);
    }

    const seen = new Map<string, SyncChange>();
    for (const ch of raw) seen.set(ch.uid, ch);

    return { changes: Array.from(seen.values()), newToken };
  }

  // ── Scheduling inbox ───────────────────────────────────────────────────────

  async listInboxItems(username: string): Promise<InboxItem[]> {
    const results: InboxItem[] = [];
    for await (const entry of this.kv.list<StoredInboxItem>({ prefix: ["inbox", username] })) {
      results.push(toInboxItem(entry.value));
    }
    return results;
  }

  async putInboxItem(username: string, uid: string, ics: string): Promise<InboxItem> {
    const etag = await computeETag(ics);
    const now = new Date();
    const stored: StoredInboxItem = {
      uid,
      ics,
      href: `/calendars/${username}/inbox/${uid}.ics`,
      etag,
      lastModified: now.toISOString(),
      contentLength: new TextEncoder().encode(ics).length,
    };
    await this.kv.set(inboxKey(username, uid), stored);
    return toInboxItem(stored);
  }

  async deleteInboxItem(username: string, uid: string): Promise<void> {
    const key = inboxKey(username, uid);
    const entry = await this.kv.get(key);
    if (!entry.value) throw new Error(`Inbox item ${uid} not found`);
    await this.kv.delete(key);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _patchMeta(username: string, name: string, fn: (m: CalMeta) => CalMeta): Promise<void> {
    const key = calKey(username, name);
    while (true) {
      const entry = await this.kv.get<CalMeta>(key);
      if (!entry.value) throw new Error(`Calendar ${name} not found`);
      const res = await this.kv.atomic().check(entry).set(key, fn(entry.value)).commit();
      if (res.ok) return;
    }
  }

  private async _allObjectsAsAdded(username: string, calendarName: string): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];
    for await (const entry of this.kv.list<StoredObj>({ prefix: ["obj", username, calendarName] })) {
      changes.push({ uid: entry.value.uid, type: "added" });
    }
    return changes;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function calFromMeta(username: string, name: string, meta: CalMeta): Calendar {
  return {
    name,
    displayName: meta.displayName,
    customProps: meta.customProps,
    href: `/calendars/${username}/${name}`,
  };
}
