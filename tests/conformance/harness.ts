// Conformance test harness — mirrors internal/conformance/harness.go.
//
// Each RFC test file boots a real in-process CalDAV server via Deno.serve,
// fires raw HTTP requests, and asserts wire-level behavior (status codes,
// response headers, XML bodies).

import { assertEquals } from "@std/assert";
import { createHandler } from "../../src/protocol.ts";
import { MemoryStorage } from "../../src/storage.ts";
import { hashPassword } from "../../src/auth.ts";
import { DEFAULT_CALENDAR_NAME } from "../../src/types.ts";
import type { Config } from "../../src/config.ts";
import { find, findAll, findDeep, parseXML } from "../../src/xmlparse.ts";

const NS_DAV = "DAV:";

// ─── Test owner credentials ───────────────────────────────────────────────────

// Owner acts as organizer in scheduling tests; email matches ORGANIZER: in ICS fixtures.
const OWNER_USERNAME = "owner";
const OWNER_PASSWORD = "ownerpass";
export const OWNER_EMAIL = "org@example.com";

// ─── CalDAV path constants ────────────────────────────────────────────────────

export const principalPath = `/principals/${OWNER_USERNAME}`;
export const calendarHomePath = `/calendars/${OWNER_USERNAME}`;

export function collectionPath(name: string): string {
  return `${calendarHomePath}/${name}`;
}

export function objectPath(collection: string, uid: string): string {
  return `${calendarHomePath}/${collection}/${uid}.ics`;
}

/** Build a calendar path for a non-owner user. */
export function userObjectPath(username: string, collection: string, uid: string): string {
  return `/calendars/${username}/${collection}/${uid}.ics`;
}

export function userCollectionPath(username: string, collection: string): string {
  return `/calendars/${username}/${collection}`;
}

export function userPrincipalPath(username: string): string {
  return `/principals/${username}`;
}

export function userInboxPath(username: string): string {
  return `/calendars/${username}/inbox`;
}

// ─── iCalendar fixture builders ───────────────────────────────────────────────

export const testDTSTAMP = "20260101T000000Z";
export const testDTSTART = "20260115T100000Z";
export const testDTEND = "20260115T110000Z";
export const testDUE = "20260120T120000Z";

/** Returns a minimal valid VTODO VCALENDAR string. */
export function vtodo(uid: string, ...extra: string[]): string {
  let s = "BEGIN:VCALENDAR\r\n";
  s += "VERSION:2.0\r\n";
  s += "PRODID:-//CalStakk//ConformanceTest//EN\r\n";
  s += "BEGIN:VTODO\r\n";
  s += `UID:${uid}\r\n`;
  s += `DTSTAMP:${testDTSTAMP}\r\n`;
  s += "SUMMARY:Test Todo\r\n";
  for (const line of extra) {
    s += line.replace(/\r?\n$/, "") + "\r\n";
  }
  s += "END:VTODO\r\n";
  s += "END:VCALENDAR\r\n";
  return s;
}

/** Returns a minimal valid VEVENT VCALENDAR string. Extra lines override defaults when they share the same property name. */
export function vevent(uid: string, ...extra: string[]): string {
  const hasOverride = (key: string) => extra.some((l) => l.toUpperCase().startsWith(`${key}:`));
  let s = "BEGIN:VCALENDAR\r\n";
  s += "VERSION:2.0\r\n";
  s += "PRODID:-//CalStakk//ConformanceTest//EN\r\n";
  s += "BEGIN:VEVENT\r\n";
  s += `UID:${uid}\r\n`;
  s += `DTSTAMP:${testDTSTAMP}\r\n`;
  if (!hasOverride("DTSTART")) s += `DTSTART:${testDTSTART}\r\n`;
  if (!hasOverride("DTEND")) s += `DTEND:${testDTEND}\r\n`;
  s += "SUMMARY:Test Event\r\n";
  for (const line of extra) {
    s += line.replace(/\r?\n$/, "") + "\r\n";
  }
  s += "END:VEVENT\r\n";
  s += "END:VCALENDAR\r\n";
  return s;
}

// ─── PROPFIND / REPORT XML body builders ──────────────────────────────────────

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function propfindAllprop(): string {
  return XML_HEADER + '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
}

export function propfindPropname(): string {
  return XML_HEADER + '<D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>';
}

export const nsDAV = "DAV:";
export const nsCalDAV = "urn:ietf:params:xml:ns:caldav";

/**
 * Build a PROPFIND body for specific properties.
 * Provide pairs of [namespace, local-name].
 */
export function propfindProps(...pairs: string[]): string {
  let inner = "";
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const [ns, local] = [pairs[i], pairs[i + 1]];
    if (ns === nsDAV) inner += `<D:${local}/>`;
    else if (ns === nsCalDAV) inner += `<C:${local}/>`;
    else inner += `<X:${local} xmlns:X="${ns}"/>`;
  }
  return (
    XML_HEADER +
    `<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop>${inner}</D:prop></D:propfind>`
  );
}

export function calendarQueryByComp(compName: string): string {
  return (
    XML_HEADER +
    `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
    `<C:filter><C:comp-filter name="VCALENDAR">` +
    `<C:comp-filter name="${compName}"/>` +
    `</C:comp-filter></C:filter>` +
    `</C:calendar-query>`
  );
}

export function calendarQueryByTimeRange(
  compName: string,
  start: string,
  end: string,
): string {
  return (
    XML_HEADER +
    `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
    `<C:filter><C:comp-filter name="VCALENDAR">` +
    `<C:comp-filter name="${compName}">` +
    `<C:time-range start="${start}" end="${end}"/>` +
    `</C:comp-filter>` +
    `</C:comp-filter></C:filter>` +
    `</C:calendar-query>`
  );
}

export function calendarMultiget(...hrefs: string[]): string {
  const hrefXML = hrefs.map((h) => `<D:href>${h}</D:href>`).join("");
  return (
    XML_HEADER +
    `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
    hrefXML +
    `</C:calendar-multiget>`
  );
}

export function syncCollectionReport(syncToken: string): string {
  return (
    XML_HEADER +
    `<D:sync-collection xmlns:D="DAV:">` +
    `<D:sync-token>${syncToken}</D:sync-token>` +
    `<D:sync-level>1</D:sync-level>` +
    `<D:prop><D:getetag/></D:prop>` +
    `</D:sync-collection>`
  );
}

// ─── Header helpers ───────────────────────────────────────────────────────────

export function depthHeader(d: string): Record<string, string> {
  return { Depth: d };
}

export function xmlContentType(): Record<string, string> {
  return { "Content-Type": "application/xml; charset=utf-8" };
}

export function calContentType(): Record<string, string> {
  return { "Content-Type": "text/calendar; charset=utf-8" };
}

export function withHeaders(...maps: Record<string, string>[]): Record<string, string> {
  return Object.assign({}, ...maps);
}

// ─── Multistatus XML parsing ──────────────────────────────────────────────────

import type { XNode } from "../../src/xmlparse.ts";

/** Collect all text from a node and its descendants (depth-first). */
function allText(node: XNode): string {
  let t = node.text;
  for (const c of node.children) t += allText(c);
  return t;
}

export class MSProp {
  constructor(
    public readonly status: number,
    private readonly _text: string,
    private readonly _children: string[],
  ) {}

  text(): string {
    return this._text;
  }

  hasChild(local: string): boolean {
    return this._children.includes(local);
  }
}

export class MSResponse {
  constructor(
    public readonly href: string,
    private readonly props: Map<string, MSProp>,
  ) {}

  prop(local: string): MSProp | undefined {
    // Search by local name across all namespaces
    for (const [key, val] of this.props) {
      if (key === local || key.endsWith(`:${local}`) || key.endsWith(`}${local}`)) {
        return val;
      }
    }
    return undefined;
  }

  propStatus(local: string): number {
    return this.prop(local)?.status ?? 0;
  }
}

export class Multistatus {
  constructor(private readonly responses: MSResponse[]) {}

  response(href: string): MSResponse | undefined {
    return this.responses.find((r) => r.href === href);
  }

  len(): number {
    return this.responses.length;
  }
}

export function parseMultistatus(body: string): Multistatus {
  const root = parseXML(body);
  if (!root) return new Multistatus([]);

  const responses: MSResponse[] = [];
  const responseEls = findAll(root, NS_DAV, "response");

  for (const responseEl of responseEls) {
    const hrefEl = find(responseEl, NS_DAV, "href");
    const href = hrefEl?.text.trim() ?? "";

    const props = new Map<string, MSProp>();
    const propstatEls = findAll(responseEl, NS_DAV, "propstat");

    for (const propstatEl of propstatEls) {
      const statusEl = find(propstatEl, NS_DAV, "status");
      const code = parseStatusCode(statusEl?.text.trim() ?? "");

      const propEl = find(propstatEl, NS_DAV, "prop");
      if (!propEl) continue;

      for (const child of propEl.children) {
        const childNames = child.children.map((c) => c.local);
        const msProp = new MSProp(code, allText(child).trim(), childNames);
        props.set(`${child.ns}:${child.local}`, msProp);
        props.set(child.local, msProp); // index by local name too
      }
    }

    // Response-level status (used for 404 in multiget with no propstat)
    if (propstatEls.length === 0) {
      const statusEl = find(responseEl, NS_DAV, "status");
      if (statusEl) {
        const code = parseStatusCode(statusEl.text.trim());
        props.set("__status__", new MSProp(code, "", []));
      }
    }

    responses.push(new MSResponse(href, props));
  }

  return new Multistatus(responses);
}

/** Extract the sync-token value from a multistatus XML body. */
export function extractSyncToken(body: string): string {
  const root = parseXML(body);
  if (!root) return "";
  return findDeep(root, NS_DAV, "sync-token")?.text.trim() ?? "";
}

function parseStatusCode(statusLine: string): number {
  const parts = statusLine.split(" ");
  if (parts.length < 2) return 0;
  return parseInt(parts[1]) || 0;
}

// ─── Test server ──────────────────────────────────────────────────────────────

interface RawResponse {
  status: number;
  headers: Headers;
  body: string;
}

export class TestServer {
  private readonly baseURL: string;
  private readonly server: Deno.HttpServer<Deno.NetAddr>;
  private readonly controller: AbortController;
  private readonly storage: MemoryStorage;

  private constructor(
    baseURL: string,
    server: Deno.HttpServer<Deno.NetAddr>,
    controller: AbortController,
    storage: MemoryStorage,
  ) {
    this.baseURL = baseURL;
    this.server = server;
    this.controller = controller;
    this.storage = storage;
  }

  static async create(): Promise<TestServer> {
    const storage = new MemoryStorage();

    // Pre-create owner user with hashed password and default calendar.
    const ownerHash = await hashPassword(OWNER_PASSWORD);
    await storage.createUser({
      username: OWNER_USERNAME,
      passwordHash: ownerHash,
      displayName: "Test Owner",
      email: OWNER_EMAIL,
      timezone: "UTC",
      isAdmin: true,
    });
    await storage.createCalendar(OWNER_USERNAME, DEFAULT_CALENDAR_NAME, "Default Calendar");

    const testConfig: Config = {
      server: { host: "localhost", port: 0, kvPath: undefined, webDir: undefined },
      user: {
        username: OWNER_USERNAME,
        password: OWNER_PASSWORD,
        displayName: "Test Owner",
        email: OWNER_EMAIL,
        timezone: "UTC",
      },
    };

    const handler = createHandler(storage, testConfig);
    const controller = new AbortController();
    const server = Deno.serve(
      {
        port: 0,
        signal: controller.signal,
        onListen: () => {}, // suppress startup log
      },
      handler,
    );
    const port = server.addr.port;
    return new TestServer(`http://localhost:${port}`, server, controller, storage);
  }

  async shutdown(): Promise<void> {
    this.controller.abort();
    await this.server.finished;
  }

  /** Create a secondary user (non-owner) in the server's storage. */
  async createUser(username: string, email: string, password = "testpass"): Promise<void> {
    const hash = await hashPassword(password);
    await this.storage.createUser({
      username,
      passwordHash: hash,
      displayName: username,
      email,
      timezone: "UTC",
      isAdmin: false,
    });
    await this.storage.createCalendar(username, DEFAULT_CALENDAR_NAME, "Default Calendar");
  }

  /** Issue an HTTP request as the owner. Redirects are followed. */
  async do(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<RawResponse> {
    const ownerAuth = "Basic " + btoa(`${OWNER_USERNAME}:${OWNER_PASSWORD}`);
    const resp = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: { Authorization: ownerAuth, ...headers },
      body: body ?? undefined,
      redirect: "follow",
    });
    return { status: resp.status, headers: resp.headers, body: await resp.text() };
  }

  /** Issue an HTTP request as a specific user. Redirects are followed. */
  async doAs(
    username: string,
    password: string,
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<RawResponse> {
    const authHeader = "Basic " + btoa(`${username}:${password}`);
    const resp = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: { Authorization: authHeader, ...headers },
      body: body ?? undefined,
      redirect: "follow",
    });
    return { status: resp.status, headers: resp.headers, body: await resp.text() };
  }

  /** Issue an HTTP request WITHOUT following redirects and WITHOUT auth (for 401 tests). */
  async doNoRedirect(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<RawResponse> {
    const resp = await fetch(`${this.baseURL}${path}`, {
      method,
      headers,
      body: body ?? undefined,
      redirect: "manual",
    });
    return { status: resp.status, headers: resp.headers, body: await resp.text() };
  }

  /** Create a calendar collection (MKCOL) for owner and assert 201. */
  async mkcol(name: string): Promise<string> {
    const path = collectionPath(name);
    const resp = await this.do("MKCOL", path);
    assertEquals(resp.status, 201, `MKCOL ${path} failed: ${resp.body}`);
    return path;
  }

  /** Create a MKCALENDAR collection for a specific user. */
  async mkcalAs(username: string, password: string, colName: string): Promise<string> {
    const path = userCollectionPath(username, colName);
    const resp = await this.doAs(username, password, "MKCALENDAR", path);
    assertEquals(resp.status, 201, `MKCALENDAR ${path} failed: ${resp.body}`);
    return path;
  }

  /** PUT a calendar object and assert 201. Returns ETag. */
  async putObject(path: string, body: string): Promise<string> {
    const resp = await this.do(
      "PUT",
      path,
      { "Content-Type": "text/calendar; charset=utf-8" },
      body,
    );
    assertEquals(
      resp.status,
      201,
      `PUT ${path} failed (${resp.status}): ${resp.body}`,
    );
    return resp.headers.get("ETag") ?? "";
  }

  /** PUT a VTODO and return the ETag. */
  putTodo(collection: string, uid: string, ...extra: string[]): Promise<string> {
    return this.putObject(objectPath(collection, uid), vtodo(uid, ...extra));
  }

  /** PUT a VEVENT and return the ETag. */
  putEvent(collection: string, uid: string, ...extra: string[]): Promise<string> {
    return this.putObject(objectPath(collection, uid), vevent(uid, ...extra));
  }

  get base(): string {
    return this.baseURL;
  }
}

/** Convenience wrapper: create a server, run fn, then shut down. */
export async function withServer(
  fn: (s: TestServer) => Promise<void>,
): Promise<void> {
  const s = await TestServer.create();
  try {
    await fn(s);
  } finally {
    await s.shutdown();
  }
}
