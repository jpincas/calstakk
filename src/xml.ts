// XML utilities: namespace constants, element builders, multistatus responses,
// and request body parsing for PROPFIND / PROPPATCH / REPORT.

import { attr, find, findAll, findAllDeep, findDeep, parseXML, serializeXNode, type XNode } from "./xmlparse.ts";

export const NS_DAV = "DAV:";
export const NS_CALDAV = "urn:ietf:params:xml:ns:caldav";
export const NS_CS = "http://calendarserver.org/ns/";

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\r\n';

// ─── Character escaping ───────────────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Element builders ─────────────────────────────────────────────────────────

/** Build a DAV: namespaced element. */
export function D(tag: string, content = "", attrs: Record<string, string> = {}): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  if (!content) return `<D:${tag}${a}/>`;
  return `<D:${tag}${a}>${content}</D:${tag}>`;
}

/** Build a CalDAV: namespaced element. */
export function C(tag: string, content = "", attrs: Record<string, string> = {}): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  if (!content) return `<C:${tag}${a}/>`;
  return `<C:${tag}${a}>${content}</C:${tag}>`;
}

/** Build a self-closing element with a raw (already-escaped) attribute value. */
export function Dattr(tag: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<D:${tag}${a}/>`;
}

export function Cattr(tag: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<C:${tag}${a}/>`;
}

// ─── Multi-Status response builders ───────────────────────────────────────────

export interface PropstatEntry {
  props: string; // XML content of <D:prop>
  status: number;
}

export function multiStatusXML(responses: string[]): string {
  return (
    XML_HEADER +
    `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">` +
    responses.join("") +
    `</D:multistatus>`
  );
}

export function responseXML(href: string, propstats: PropstatEntry[]): string {
  const body =
    D("href", esc(href)) +
    propstats
      .map(
        (ps) =>
          D("propstat", D("prop", ps.props) + D("status", `HTTP/1.1 ${ps.status} ${statusText(ps.status)}`)),
      )
      .join("");
  return D("response", body);
}

/** Build a 404-status response (no props) for a missing resource. */
export function notFoundResponseXML(href: string): string {
  return D(
    "response",
    D("href", esc(href)) + D("status", "HTTP/1.1 404 Not Found"),
  );
}

function statusText(code: number): string {
  const texts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    207: "Multi-Status",
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    412: "Precondition Failed",
    424: "Failed Dependency",
    500: "Internal Server Error",
  };
  return texts[code] ?? "Unknown";
}

// ─── PropFind request parsing ─────────────────────────────────────────────────

export interface PropName {
  ns: string;
  local: string;
}

export type PropFindRequest =
  | { type: "allprop" }
  | { type: "propname" }
  | { type: "prop"; names: PropName[] };

export function parsePropfind(body: string): PropFindRequest {
  if (!body.trim()) return { type: "allprop" };

  const root = parseXML(body);
  if (!root) return { type: "allprop" };

  if (findDeep(root, NS_DAV, "allprop")) return { type: "allprop" };
  if (findDeep(root, NS_DAV, "propname")) return { type: "propname" };

  const propEl = findDeep(root, NS_DAV, "prop");
  if (propEl) {
    const names: PropName[] = propEl.children.map((c) => ({ ns: c.ns, local: c.local }));
    return { type: "prop", names };
  }

  return { type: "allprop" };
}

// ─── PROPPATCH request parsing ────────────────────────────────────────────────

export interface PropPatchOp {
  type: "set" | "remove";
  ns: string;
  local: string;
  value: string;
  rawXml: string; // full serialized XML element for the property
}

export function parseProppatch(body: string): PropPatchOp[] {
  const ops: PropPatchOp[] = [];
  const root = parseXML(body);
  if (!root) return ops;

  for (const setEl of findAllDeep(root, NS_DAV, "set")) {
    const propEl = find(setEl, NS_DAV, "prop");
    if (!propEl) continue;
    for (const child of propEl.children) {
      ops.push({ type: "set", ns: child.ns, local: child.local, value: child.text.trim(), rawXml: serializeXNode(child) });
    }
  }

  for (const removeEl of findAllDeep(root, NS_DAV, "remove")) {
    const propEl = find(removeEl, NS_DAV, "prop");
    if (!propEl) continue;
    for (const child of propEl.children) {
      ops.push({ type: "remove", ns: child.ns, local: child.local, value: "", rawXml: "" });
    }
  }

  return ops;
}

// ─── REPORT request parsing ───────────────────────────────────────────────────

export interface CompFilter {
  name: string;
  isNotDefined: boolean;
  start?: Date;
  end?: Date;
  comps: CompFilter[];
  props: PropFilter[];
}

export interface PropFilter {
  name: string;
  isNotDefined: boolean;
  start?: Date;
  end?: Date;
  textMatch?: TextMatch;
  paramFilters: ParamFilter[];
}

export interface ParamFilter {
  name: string;
  isNotDefined: boolean;
  textMatch?: TextMatch;
}

export interface TextMatch {
  text: string;
  negateCondition: boolean;
  collation?: string;
}

export interface CalendarQuery {
  requestedProps: PropName[];
  allProp: boolean;
  filter: CompFilter;
  timezoneId?: string;
}

export interface CalendarMultiget {
  requestedProps: PropName[];
  allProp: boolean;
  hrefs: string[];
}

export interface SyncCollectionQuery {
  syncToken: string;
  requestedProps: PropName[];
  allProp: boolean;
}

export type ReportRequest =
  | { type: "calendar-query"; query: CalendarQuery }
  | { type: "calendar-multiget"; multiget: CalendarMultiget }
  | { type: "sync-collection"; sync: SyncCollectionQuery }
  | { type: "free-busy-query"; start: string; end: string }
  | { type: "expand-property" }
  | { type: "unknown" };

function parseRequestedPropsX(root: XNode): { names: PropName[]; allProp: boolean } {
  const propEl = findDeep(root, NS_DAV, "prop");
  if (!propEl) return { names: [], allProp: true };
  const names: PropName[] = propEl.children.map((c) => ({ ns: c.ns, local: c.local }));
  return { names, allProp: false };
}

function parseCompFilterX(el: XNode): CompFilter {
  const name = attr(el, "name") ?? "VCALENDAR";
  const isNotDefined = find(el, NS_CALDAV, "is-not-defined") !== undefined;
  let start: Date | undefined;
  let end: Date | undefined;

  const timeRange = find(el, NS_CALDAV, "time-range");
  if (timeRange) {
    const s = attr(timeRange, "start");
    const e = attr(timeRange, "end");
    if (s) start = parseICalDateTime(s);
    if (e) end = parseICalDateTime(e);
  }

  const comps = findAll(el, NS_CALDAV, "comp-filter").map(parseCompFilterX);
  const props = findAll(el, NS_CALDAV, "prop-filter").map(parsePropFilterX);

  return { name, isNotDefined, start, end, comps, props };
}

function parsePropFilterX(el: XNode): PropFilter {
  const name = attr(el, "name") ?? "";
  const isNotDefined = find(el, NS_CALDAV, "is-not-defined") !== undefined;
  let start: Date | undefined;
  let end: Date | undefined;
  let textMatch: TextMatch | undefined;

  const timeRange = find(el, NS_CALDAV, "time-range");
  if (timeRange) {
    const s = attr(timeRange, "start");
    const e = attr(timeRange, "end");
    if (s) start = parseICalDateTime(s);
    if (e) end = parseICalDateTime(e);
  }

  const textMatchEl = find(el, NS_CALDAV, "text-match");
  if (textMatchEl) {
    textMatch = {
      text: textMatchEl.text.trim(),
      negateCondition: attr(textMatchEl, "negate-condition") === "yes",
      collation: attr(textMatchEl, "collation") ?? undefined,
    };
  }

  const paramFilters: ParamFilter[] = findAll(el, NS_CALDAV, "param-filter").map((pf) => {
    const pfName = attr(pf, "name") ?? "";
    const pfNotDefined = find(pf, NS_CALDAV, "is-not-defined") !== undefined;
    const pfTm = find(pf, NS_CALDAV, "text-match");
    const pfTextMatch: TextMatch | undefined = pfTm
      ? {
        text: pfTm.text.trim(),
        negateCondition: attr(pfTm, "negate-condition") === "yes",
        collation: attr(pfTm, "collation") ?? undefined,
      }
      : undefined;
    return { name: pfName, isNotDefined: pfNotDefined, textMatch: pfTextMatch };
  });

  return { name, isNotDefined, start, end, textMatch, paramFilters };
}

export function parseReport(body: string): ReportRequest {
  const root = parseXML(body);
  if (!root) return { type: "unknown" };

  if (root.local === "calendar-query") {
    const filterEl = findDeep(root, NS_CALDAV, "filter");
    if (!filterEl) return { type: "unknown" };
    const compFilterEl = find(filterEl, NS_CALDAV, "comp-filter");
    if (!compFilterEl) return { type: "unknown" };
    const cf = parseCompFilterX(compFilterEl);
    const { names, allProp } = parseRequestedPropsX(root);
    const tzIdEl = findDeep(root, NS_CALDAV, "timezone-id");
    const timezoneId = tzIdEl?.text.trim() || undefined;
    return { type: "calendar-query", query: { requestedProps: names, allProp, filter: cf, timezoneId } };
  }

  if (root.local === "calendar-multiget") {
    const { names, allProp } = parseRequestedPropsX(root);
    const hrefs = findAllDeep(root, NS_DAV, "href")
      .map((h) => h.text.trim())
      .filter(Boolean);
    return { type: "calendar-multiget", multiget: { requestedProps: names, allProp, hrefs } };
  }

  if (root.local === "sync-collection") {
    const tokenEl = findDeep(root, NS_DAV, "sync-token");
    const syncToken = tokenEl?.text.trim() ?? "";
    const { names, allProp } = parseRequestedPropsX(root);
    return { type: "sync-collection", sync: { syncToken, requestedProps: names, allProp } };
  }

  if (root.local === "free-busy-query") {
    const trEl = findDeep(root, NS_CALDAV, "time-range");
    const start = trEl ? (attr(trEl, "start") ?? "") : "";
    const end = trEl ? (attr(trEl, "end") ?? "") : "";
    return { type: "free-busy-query", start, end };
  }

  if (root.local === "expand-property") {
    return { type: "expand-property" };
  }

  return { type: "unknown" };
}

// ─── iCalendar datetime parsing ───────────────────────────────────────────────

/** Parse iCalendar datetime string (e.g. "20260115T100000Z") to Date. */
export function parseICalDateTime(s: string): Date {
  if (s.length === 8) {
    return new Date(
      Date.UTC(
        parseInt(s.slice(0, 4)),
        parseInt(s.slice(4, 6)) - 1,
        parseInt(s.slice(6, 8)),
      ),
    );
  }
  if (s.length >= 15) {
    return new Date(
      Date.UTC(
        parseInt(s.slice(0, 4)),
        parseInt(s.slice(4, 6)) - 1,
        parseInt(s.slice(6, 8)),
        parseInt(s.slice(9, 11)),
        parseInt(s.slice(11, 13)),
        parseInt(s.slice(13, 15)),
      ),
    );
  }
  return new Date(s);
}
