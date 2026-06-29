// Deno KV–backed storage implementation.
//
// Key schema:
//   ["cal", calName]                  → CalMeta
//   ["obj", calName, uid]             → StoredObj
//   ["ical", calName, icalUID]        → uid  (reverse index: ical UID → path uid)
//   ["log", calName, token: number]   → LogEntry
//
// Sync tokens are the stringified integer syncCounter stored in CalMeta.
// Atomic transactions (optimistic retry) ensure counter increments and
// object/log writes are consistent.
//
// Open with:
//   const kv = await Deno.openKv();           // dev: local SQLite
//   const kv = await Deno.openKv(path);       // explicit path
//   // On Deno Deploy, Deno.openKv() connects to the cloud KV automatically.

import type { Calendar, CalendarObject, Storage, SyncChange, SyncResult } from "./storage.ts";
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
  href: string; // full URL path, stored for efficiency
  etag: string;
  ics: string;
  lastModified: string; // ISO 8601
  contentLength: number;
}

interface LogEntry {
  uid: string;
  type: SyncChange["type"];
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function calKey(name: string): Deno.KvKey {
  return ["cal", name];
}

function objKey(calName: string, uid: string): Deno.KvKey {
  return ["obj", calName, uid];
}

function icalKey(calName: string, icalUID: string): Deno.KvKey {
  return ["ical", calName, icalUID];
}

function logKey(calName: string, token: number): Deno.KvKey {
  return ["log", calName, token];
}

function tokenStr(n: number): string {
  return String(n);
}

function toCalObj(s: StoredObj): CalendarObject {
  return {
    uid: s.uid,
    icalUID: s.icalUID,
    href: s.href,
    etag: s.etag,
    ics: s.ics,
    lastModified: new Date(s.lastModified),
    contentLength: s.contentLength,
  };
}

// ─── KVStorage ────────────────────────────────────────────────────────────────

export class KVStorage implements Storage {
  constructor(private readonly kv: Deno.Kv) {}

  // ── Calendars ──────────────────────────────────────────────────────────────

  async listCalendars(): Promise<Calendar[]> {
    const results: Calendar[] = [];
    for await (const entry of this.kv.list<CalMeta>({ prefix: ["cal"] })) {
      const name = entry.key[1] as string;
      results.push(calFromMeta(name, entry.value));
    }
    return results;
  }

  async getCalendar(name: string): Promise<Calendar | null> {
    const entry = await this.kv.get<CalMeta>(calKey(name));
    if (!entry.value) return null;
    return calFromMeta(name, entry.value);
  }

  async createCalendar(name: string, displayName: string): Promise<void> {
    const key = calKey(name);
    const existing = await this.kv.get(key);
    if (existing.value !== null) throw new Error(`Calendar ${name} already exists`);

    const meta: CalMeta = { displayName: displayName || name, customProps: {}, syncCounter: 0 };
    const res = await this.kv.atomic().check(existing).set(key, meta).commit();
    if (!res.ok) throw new Error(`Calendar ${name} already exists`);
  }

  async deleteCalendar(name: string): Promise<void> {
    // Sequential deletes — no atomicity needed for a destructive collection drop.
    // Deno KV atomic transactions cap at ~1000 mutations, so batching is required
    // for large collections; simple sequential deletes are safer here.
    for await (const entry of this.kv.list({ prefix: ["obj", name] })) {
      await this.kv.delete(entry.key);
    }
    for await (const entry of this.kv.list({ prefix: ["ical", name] })) {
      await this.kv.delete(entry.key);
    }
    for await (const entry of this.kv.list({ prefix: ["log", name] })) {
      await this.kv.delete(entry.key);
    }
    await this.kv.delete(calKey(name));
  }

  async updateCalendarDisplayName(name: string, displayName: string): Promise<void> {
    await this._patchMeta(name, (m) => ({ ...m, displayName }));
  }

  async updateCalendarProp(name: string, key: string, value: string): Promise<void> {
    await this._patchMeta(name, (m) => ({
      ...m,
      customProps: { ...m.customProps, [key]: value },
    }));
  }

  // ── Objects ────────────────────────────────────────────────────────────────

  async listObjects(calendarName: string): Promise<CalendarObject[]> {
    const results: CalendarObject[] = [];
    for await (const entry of this.kv.list<StoredObj>({ prefix: ["obj", calendarName] })) {
      results.push(toCalObj(entry.value));
    }
    return results;
  }

  async getObject(calendarName: string, uid: string): Promise<CalendarObject | null> {
    const entry = await this.kv.get<StoredObj>(objKey(calendarName, uid));
    if (!entry.value) return null;
    return toCalObj(entry.value);
  }

  async findObjectByICalUID(calendarName: string, icalUID: string): Promise<string | null> {
    const entry = await this.kv.get<string>(icalKey(calendarName, icalUID));
    return entry.value ?? null;
  }

  async putObject(
    calendarName: string,
    uid: string,
    ics: string,
    icalUID: string,
  ): Promise<CalendarObject> {
    const etag = await computeETag(ics);
    const now = new Date();
    const href = `/calstakk/calendars/${calendarName}/${uid}.ics`;
    const stored: StoredObj = {
      uid,
      icalUID,
      href,
      etag,
      ics,
      lastModified: now.toISOString(),
      contentLength: new TextEncoder().encode(ics).length,
    };

    const cKey = calKey(calendarName);
    const oKey = objKey(calendarName, uid);

    // Optimistic retry loop: read-then-atomically-write.
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
        .set(icalKey(calendarName, icalUID), uid)
        .set(logKey(calendarName, newCounter), {
          uid,
          type: isNew ? "added" : "modified",
        } satisfies LogEntry);

      if (oldIcalUID && oldIcalUID !== icalUID) {
        txn.delete(icalKey(calendarName, oldIcalUID));
      }

      const res = await txn.commit();
      if (res.ok) return toCalObj(stored);
      // Another writer raced us — retry.
    }
  }

  async deleteObject(calendarName: string, uid: string): Promise<void> {
    const cKey = calKey(calendarName);
    const oKey = objKey(calendarName, uid);

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
        .delete(icalKey(calendarName, icalUID))
        .set(logKey(calendarName, newCounter), { uid, type: "deleted" } satisfies LogEntry)
        .commit();

      if (res.ok) return;
    }
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  async getSyncToken(calendarName: string): Promise<string> {
    const entry = await this.kv.get<CalMeta>(calKey(calendarName));
    return tokenStr(entry.value?.syncCounter ?? 0);
  }

  async getChanges(calendarName: string, sinceToken: string): Promise<SyncResult> {
    const metaEntry = await this.kv.get<CalMeta>(calKey(calendarName));
    if (!metaEntry.value) return { changes: [], newToken: "0" };

    const newToken = tokenStr(metaEntry.value.syncCounter);

    if (sinceToken === "") {
      return { changes: await this._allObjectsAsAdded(calendarName), newToken };
    }

    const since = parseInt(sinceToken, 10);
    if (isNaN(since)) {
      return { changes: [], newToken, invalidToken: true };
    }

    if (since === 0) {
      return { changes: await this._allObjectsAsAdded(calendarName), newToken };
    }

    // Incremental: scan the log and collect entries with token > since.
    const raw: LogEntry[] = [];
    for await (const entry of this.kv.list<LogEntry>({ prefix: ["log", calendarName] })) {
      const token = entry.key[2] as number;
      if (token > since) raw.push(entry.value);
    }

    // Deduplicate: keep only the latest change per uid (log is ordered by token asc).
    const seen = new Map<string, SyncChange>();
    for (const ch of raw) seen.set(ch.uid, ch);

    return { changes: Array.from(seen.values()), newToken };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _patchMeta(name: string, fn: (m: CalMeta) => CalMeta): Promise<void> {
    const key = calKey(name);
    while (true) {
      const entry = await this.kv.get<CalMeta>(key);
      if (!entry.value) throw new Error(`Calendar ${name} not found`);
      const res = await this.kv.atomic().check(entry).set(key, fn(entry.value)).commit();
      if (res.ok) return;
    }
  }

  private async _allObjectsAsAdded(calendarName: string): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];
    for await (const entry of this.kv.list<StoredObj>({ prefix: ["obj", calendarName] })) {
      changes.push({ uid: entry.value.uid, type: "added" });
    }
    return changes;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function calFromMeta(name: string, meta: CalMeta): Calendar {
  return {
    name,
    displayName: meta.displayName,
    customProps: meta.customProps,
    href: `/calstakk/calendars/${name}`,
  };
}
