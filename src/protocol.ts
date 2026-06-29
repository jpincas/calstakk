// CalDAV / WebDAV HTTP handler.
// Routes requests to the appropriate handler based on method and path.

import {
  CALENDAR_HOME_PATH,
  collectionNameFromPath,
  HTTPError,
  objectUIDFromPath,
  parseDepth,
  PRINCIPAL_PATH,
  ResourceType,
  resourceTypeAtPath,
} from "./types.ts";

import {
  C,
  Cattr,
  type CalendarMultiget,
  type CalendarQuery,
  D,
  multiStatusXML,
  notFoundResponseXML,
  parsePropfind,
  parseProppatch,
  parseReport,
  type PropFindRequest,
  type PropstatEntry,
  responseXML,
  type SyncCollectionQuery,
} from "./xml.ts";

import type { Storage } from "./storage.ts";
import { extractUID, matchesFilter, validateCalendarObject, parseICS } from "./ical.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function respond(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(body || null, { status, headers });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function xmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

const DAV_HEADER = "1, calendar-access";
const ALLOW_HEADER =
  "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MKCALENDAR, REPORT";

// ─── createHandler ────────────────────────────────────────────────────────────

export function createHandler(storage: Storage): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await route(req, storage);
    } catch (err) {
      if (err instanceof HTTPError) {
        return textResponse(err.code, err.message);
      }
      console.error("Unhandled error:", err);
      return textResponse(500, "Internal Server Error");
    }
  };
}

async function route(req: Request, storage: Storage): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const method = req.method.toUpperCase();

  // SPA passthrough (serve static files at /app/)
  if (path.startsWith("/app/")) {
    return respond(404, "Not found");
  }

  // /.well-known/caldav redirect
  if (path === "/.well-known/caldav") {
    return respond(308, "", { Location: PRINCIPAL_PATH });
  }

  const resType = resourceTypeAtPath(path);

  switch (method) {
    case "OPTIONS":
      return handleOptions();
    case "GET":
      return await handleGet(path, resType, storage);
    case "HEAD":
      return await handleHead(path, resType, storage);
    case "PUT":
      return await handlePut(req, path, resType, storage);
    case "DELETE":
      return await handleDelete(path, resType, storage);
    case "PROPFIND":
      return await handlePropfind(req, path, resType, storage);
    case "PROPPATCH":
      return await handleProppatch(req, path, resType, storage);
    case "MKCOL":
      return await handleMkcol(path, resType, storage, false);
    case "MKCALENDAR":
      return await handleMkcol(path, resType, storage, true);
    case "REPORT":
      return await handleReport(req, path, resType, storage);
    case "COPY":
      return respond(501, "COPY not implemented");
    case "MOVE":
      return respond(501, "MOVE not implemented");
    default:
      return respond(405, "Method not allowed", { Allow: ALLOW_HEADER });
  }
}

// ─── OPTIONS ──────────────────────────────────────────────────────────────────

function handleOptions(): Response {
  return respond(200, "", {
    Allow: ALLOW_HEADER,
    DAV: DAV_HEADER,
    "Content-Length": "0",
  });
}

// ─── GET / HEAD ───────────────────────────────────────────────────────────────

async function handleGet(path: string, resType: ResourceType, storage: Storage): Promise<Response> {
  if (resType !== "object") {
    return respond(405, "Method not allowed");
  }
  const colName = collectionNameFromPath(path);
  const uid = objectUIDFromPath(path);
  const obj = await storage.getObject(colName, uid);
  if (!obj) return respond(404, "Not found");

  return new Response(obj.ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Length": String(obj.contentLength),
      ETag: obj.etag,
      "Last-Modified": obj.lastModified.toUTCString(),
    },
  });
}

async function handleHead(
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  if (resType !== "object") {
    return respond(405, "Method not allowed");
  }
  const colName = collectionNameFromPath(path);
  const uid = objectUIDFromPath(path);
  const obj = await storage.getObject(colName, uid);
  if (!obj) return respond(404, "Not found");

  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Length": String(obj.contentLength),
      ETag: obj.etag,
      "Last-Modified": obj.lastModified.toUTCString(),
    },
  });
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

async function handlePut(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  if (resType !== "object") {
    return respond(405, "Method not allowed");
  }

  // Content-Type check
  const ct = req.headers.get("Content-Type") ?? "";
  const mimeType = ct.split(";")[0].trim().toLowerCase();
  if (mimeType !== "text/calendar") {
    return respond(415, "Unsupported Media Type: expected text/calendar");
  }

  const ics = await req.text();

  // Parse and validate
  let cal;
  try {
    cal = parseICS(ics);
  } catch {
    return respond(400, "Invalid iCalendar data");
  }

  const validErr = validateCalendarObject(cal);
  if (validErr) {
    if (validErr.precondition) {
      return xmlResponse(
        validErr.code,
        buildPreconditionError(validErr.precondition),
      );
    }
    return respond(validErr.code, validErr.message);
  }

  const icalUID = extractUID(cal);
  const colName = collectionNameFromPath(path);
  const uid = objectUIDFromPath(path);

  // Check collection exists
  const col = await storage.getCalendar(colName);
  if (!col) {
    return respond(404, `Calendar collection not found: ${colName}`);
  }

  // ETag preconditions
  const ifNoneMatch = req.headers.get("If-None-Match");
  const ifMatch = req.headers.get("If-Match");
  const existing = await storage.getObject(colName, uid);

  if (ifNoneMatch === "*" && existing) {
    return respond(412, "Precondition Failed: resource already exists");
  }
  if (ifMatch && ifMatch !== "*") {
    if (!existing) {
      return respond(412, "Precondition Failed: resource does not exist");
    }
    if (existing.etag !== ifMatch) {
      return respond(412, "Precondition Failed: ETag mismatch");
    }
  }

  // UID conflict check: same icalUID at a different URL
  const existingUID = await storage.findObjectByICalUID(colName, icalUID);
  if (existingUID && existingUID !== uid) {
    return xmlResponse(409, buildPreconditionError("no-uid-conflict"));
  }

  const obj = await storage.putObject(colName, uid, ics, icalUID);

  return respond(existing ? 204 : 201, "", {
    ETag: obj.etag,
    "Last-Modified": obj.lastModified.toUTCString(),
  });
}

function buildPreconditionError(precondition: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    `<C:${precondition}/>` +
    "</D:error>"
  );
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

async function handleDelete(
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  if (resType === "object") {
    const colName = collectionNameFromPath(path);
    const uid = objectUIDFromPath(path);
    const obj = await storage.getObject(colName, uid);
    if (!obj) return respond(404, "Not found");
    try {
      await storage.deleteObject(colName, uid);
    } catch {
      return respond(404, "Not found");
    }
    return respond(204);
  }

  if (resType === "collection") {
    const colName = collectionNameFromPath(path);
    const col = await storage.getCalendar(colName);
    if (!col) return respond(404, "Not found");
    await storage.deleteCalendar(colName);
    return respond(204);
  }

  return respond(403, "Cannot delete this resource");
}

// ─── PROPFIND ─────────────────────────────────────────────────────────────────

async function handlePropfind(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const depth = parseDepth(req.headers.get("Depth"));
  const body = await req.text();
  const pfReq = parsePropfind(body);

  const responses: string[] = [];

  switch (resType) {
    case "root":
    case "principal":
      responses.push(buildPrincipalResponse(path, pfReq));
      if (depth !== "0") {
        responses.push(buildCalendarHomeResponse(CALENDAR_HOME_PATH, pfReq));
        if (depth === "infinity") {
          const cals = await storage.listCalendars();
          for (const cal of cals) {
            responses.push(buildCollectionResponse(cal.href, cal, pfReq));
          }
        }
      }
      break;

    case "calendarHome":
      responses.push(buildCalendarHomeResponse(path, pfReq));
      if (depth !== "0") {
        const cals = await storage.listCalendars();
        for (const cal of cals) {
          responses.push(buildCollectionResponse(cal.href, cal, pfReq));
          if (depth === "infinity") {
            const objs = await storage.listObjects(cal.name);
            for (const obj of objs) {
              responses.push(buildObjectResponse(obj.href, obj, pfReq));
            }
          }
        }
      }
      break;

    case "collection": {
      const colName = collectionNameFromPath(path);
      const col = await storage.getCalendar(colName);
      if (!col) return respond(404, "Not found");
      const syncToken = await storage.getSyncToken(colName);
      responses.push(buildCollectionResponse(path, col, pfReq, syncToken));
      if (depth !== "0") {
        const objs = await storage.listObjects(colName);
        for (const obj of objs) {
          responses.push(buildObjectResponse(obj.href, obj, pfReq));
        }
      }
      break;
    }

    case "object": {
      const colName = collectionNameFromPath(path);
      const uid = objectUIDFromPath(path);
      const obj = await storage.getObject(colName, uid);
      if (!obj) return respond(404, "Not found");
      responses.push(buildObjectResponse(path, obj, pfReq));
      break;
    }

    default:
      return respond(404, "Not found");
  }

  return xmlResponse(207, multiStatusXML(responses));
}

// ─── Property maps ────────────────────────────────────────────────────────────

type PropMap = Map<string, string>; // key: "ns:local", value: XML string

function makeKey(ns: string, local: string): string {
  return `${ns}:${local}`;
}

function principalProps(): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + D("principal")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "CalStakk"));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-home-set"),
    C("calendar-home-set", D("href", CALENDAR_HOME_PATH)),
  );
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  return m;
}

function calendarHomeProps(syncToken: string): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Calendars"));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", syncToken));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  return m;
}

function collectionProps(name: string, displayName: string, syncToken: string): PropMap {
  const m = new Map<string, string>();
  m.set(
    makeKey("DAV:", "resourcetype"),
    D("resourcetype", D("collection") + C("calendar")),
  );
  m.set(makeKey("DAV:", "displayname"), D("displayname", displayName || name));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", syncToken));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-description"),
    C("calendar-description"),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-data"),
    C(
      "supported-calendar-data",
      Cattr("calendar-data", { "content-type": "text/calendar", version: "2.0" }),
    ),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-component-set"),
    C(
      "supported-calendar-component-set",
      Cattr("comp", { name: "VEVENT" }) + Cattr("comp", { name: "VTODO" }),
    ),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "max-resource-size"),
    C("max-resource-size", "10485760"),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "min-date-time"),
    C("min-date-time", "19700101T000000Z"),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "max-date-time"),
    C("max-date-time", "20991231T235959Z"),
  );
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "max-instances"), C("max-instances", "3000"));
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "max-attendees-per-instance"),
    C("max-attendees-per-instance", "100"),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone-id"),
    C("calendar-timezone-id", "UTC"),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-calendar-transp"),
    C("schedule-calendar-transp", C("opaque")),
  );
  return m;
}

function objectPropsMap(
  etag: string,
  lastModified: Date,
  contentLength: number,
  ics: string,
): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype")); // not a collection
  m.set(makeKey("DAV:", "getetag"), D("getetag", etag));
  m.set(
    makeKey("DAV:", "getcontenttype"),
    D("getcontenttype", "text/calendar; charset=utf-8"),
  );
  m.set(
    makeKey("DAV:", "getlastmodified"),
    D("getlastmodified", lastModified.toUTCString()),
  );
  m.set(makeKey("DAV:", "getcontentlength"), D("getcontentlength", String(contentLength)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", lastModified.toISOString()));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-data"),
    C("calendar-data", escapeXmlCDATA(ics)),
  );
  return m;
}

function escapeXmlCDATA(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Response builders ────────────────────────────────────────────────────────

function buildPropsResponse(href: string, props: PropMap, pfReq: PropFindRequest): string {
  if (pfReq.type === "allprop") {
    const allProps = Array.from(props.values()).join("");
    return responseXML(href, [{ props: allProps, status: 200 }]);
  }

  if (pfReq.type === "propname") {
    // Return property names with empty values
    const names = Array.from(props.keys())
      .map((k) => {
        const [ns, local] = splitKey(k);
        return buildEmptyProp(ns, local);
      })
      .join("");
    return responseXML(href, [{ props: names, status: 200 }]);
  }

  // type === "prop": return requested props, 404 for missing
  const found: string[] = [];
  const notFound: string[] = [];

  for (const { ns, local } of pfReq.names) {
    const key = makeKey(ns, local);
    const val = props.get(key);
    if (val !== undefined) {
      found.push(val);
    } else {
      notFound.push(buildEmptyProp(ns, local));
    }
  }

  const propstats: PropstatEntry[] = [];
  if (found.length > 0) propstats.push({ props: found.join(""), status: 200 });
  if (notFound.length > 0) propstats.push({ props: notFound.join(""), status: 404 });

  return responseXML(href, propstats);
}

function splitKey(key: string): [string, string] {
  const idx = key.lastIndexOf(":");
  if (idx < 0) return ["", key];
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function buildEmptyProp(ns: string, local: string): string {
  if (ns === "DAV:") return `<D:${local}/>`;
  if (ns === "urn:ietf:params:xml:ns:caldav") return `<C:${local}/>`;
  return `<X:${local} xmlns:X="${ns}"/>`;
}

function buildPrincipalResponse(href: string, pfReq: PropFindRequest): string {
  return buildPropsResponse(href, principalProps(), pfReq);
}

function buildCalendarHomeResponse(href: string, pfReq: PropFindRequest): string {
  // Use a placeholder sync token for the home
  return buildPropsResponse(href, calendarHomeProps("0"), pfReq);
}

function buildCollectionResponse(
  href: string,
  col: { name: string; displayName: string },
  pfReq: PropFindRequest,
  syncToken = "0",
): string {
  return buildPropsResponse(href, collectionProps(col.name, col.displayName, syncToken), pfReq);
}

function buildObjectResponse(
  href: string,
  obj: { etag: string; lastModified: Date; contentLength: number; ics: string },
  pfReq: PropFindRequest,
): string {
  return buildPropsResponse(
    href,
    objectPropsMap(obj.etag, obj.lastModified, obj.contentLength, obj.ics),
    pfReq,
  );
}

// ─── PROPPATCH ────────────────────────────────────────────────────────────────

async function handleProppatch(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  // Reject PROPPATCH on non-existent resources
  if (resType === "collection") {
    const colName = collectionNameFromPath(path);
    const col = await storage.getCalendar(colName);
    if (!col) return respond(404, "Not found");
  } else if (resType === "object") {
    const colName = collectionNameFromPath(path);
    const uid = objectUIDFromPath(path);
    const obj = await storage.getObject(colName, uid);
    if (!obj) return respond(404, "Not found");
  } else if (resType === "unknown") {
    return respond(404, "Not found");
  }

  const body = await req.text();
  const ops = parseProppatch(body);

  // Handle displayname update for collections
  if (resType === "collection") {
    const colName = collectionNameFromPath(path);
    for (const op of ops) {
      if (op.local === "displayname" && op.type === "set") {
        await storage.updateCalendarDisplayName(colName, op.value);
      }
    }
  }

  // Return 207 accepting all property updates
  const propstats = ops.map((op) => {
    const el = buildEmptyProp(op.ns, op.local);
    return `<D:propstat><D:prop>${el}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;
  });

  const respBody =
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response>` +
    D("href", path) +
    propstats.join("") +
    `</D:response></D:multistatus>`;

  return xmlResponse(207, respBody);
}

// ─── MKCOL / MKCALENDAR ───────────────────────────────────────────────────────

async function handleMkcol(
  path: string,
  resType: ResourceType,
  storage: Storage,
  _isMkcalendar: boolean,
): Promise<Response> {
  // Only allow creating at depth 3 (calendar collection level)
  if (resType !== "collection") {
    if (resType === "unknown" || resType === "object") {
      // Nested path — intermediate resource does not exist
      return respond(409, "Conflict: intermediate resource does not exist");
    }
    return respond(403, "Forbidden: can only create calendar collections");
  }

  const colName = collectionNameFromPath(path);
  if (!colName || colName.includes("/")) {
    return respond(409, "Conflict: nested collections not supported");
  }

  // Check if already exists
  const existing = await storage.getCalendar(colName);
  if (existing) {
    return respond(405, "Method Not Allowed: collection already exists");
  }

  await storage.createCalendar(colName, colName);
  return respond(201);
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

async function handleReport(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const body = await req.text();
  const report = parseReport(body);

  switch (report.type) {
    case "calendar-query":
      return await handleCalendarQuery(path, resType, report.query, storage);
    case "calendar-multiget":
      return await handleCalendarMultiget(report.multiget, storage);
    case "sync-collection":
      return await handleSyncCollection(path, resType, report.sync, storage);
    case "free-busy-query":
      return handleFreeBusyQuery();
    default:
      return respond(400, "Unknown REPORT type");
  }
}

async function handleCalendarQuery(
  path: string,
  resType: ResourceType,
  query: CalendarQuery,
  storage: Storage,
): Promise<Response> {
  // calendar-query must target a collection
  if (resType === "object") {
    // RFC 4791 §7.8: REPORT on a non-collection — return just this object if it matches
    const colName = collectionNameFromPath(path);
    const uid = objectUIDFromPath(path);
    const obj = await storage.getObject(colName, uid);
    if (!obj) return respond(404, "Not found");
    const pfReq: PropFindRequest = { type: "prop", names: query.requestedProps };
    const responses: string[] = [];
    if (matchesFilter(obj.ics, query.filter)) {
      responses.push(buildObjectResponse(obj.href, obj, pfReq));
    }
    return xmlResponse(207, multiStatusXML(responses));
  }

  if (resType !== "collection") {
    return respond(403, "calendar-query must target a calendar collection");
  }

  const colName = collectionNameFromPath(path);
  const col = await storage.getCalendar(colName);
  if (!col) return respond(404, "Not found");

  const objs = await storage.listObjects(colName);
  const pfReq: PropFindRequest = query.allProp
    ? { type: "allprop" }
    : { type: "prop", names: query.requestedProps };

  const responses: string[] = [];
  for (const obj of objs) {
    if (matchesFilter(obj.ics, query.filter)) {
      responses.push(buildObjectResponse(obj.href, obj, pfReq));
    }
  }

  return xmlResponse(207, multiStatusXML(responses));
}

async function handleCalendarMultiget(
  multiget: CalendarMultiget,
  storage: Storage,
): Promise<Response> {
  const pfReq: PropFindRequest = multiget.allProp
    ? { type: "allprop" }
    : { type: "prop", names: multiget.requestedProps };

  const responses: string[] = [];

  for (const href of multiget.hrefs) {
    // Extract collection and uid from href
    const resType = resourceTypeAtPath(href);
    if (resType !== "object") {
      responses.push(notFoundResponseXML(href));
      continue;
    }
    const colName = collectionNameFromPath(href);
    const uid = objectUIDFromPath(href);
    const obj = await storage.getObject(colName, uid);
    if (!obj) {
      // Return 404 propstat for missing objects
      const ps: PropstatEntry[] = [
        {
          props: pfReq.type === "prop"
            ? pfReq.names.map((n) => buildEmptyProp(n.ns, n.local)).join("")
            : "",
          status: 404,
        },
      ];
      responses.push(responseXML(href, ps));
      continue;
    }
    responses.push(buildObjectResponse(href, obj, pfReq));
  }

  return xmlResponse(207, multiStatusXML(responses));
}

async function handleSyncCollection(
  path: string,
  resType: ResourceType,
  sync: SyncCollectionQuery,
  storage: Storage,
): Promise<Response> {
  if (resType !== "collection") {
    return respond(403, "sync-collection must target a calendar collection");
  }

  const colName = collectionNameFromPath(path);
  const col = await storage.getCalendar(colName);
  if (!col) return respond(404, "Not found");

  const pfReq: PropFindRequest = sync.allProp
    ? { type: "allprop" }
    : { type: "prop", names: sync.requestedProps };

  const syncResult = await storage.getChanges(colName, sync.syncToken);
  const responses: string[] = [];

  for (const change of syncResult.changes) {
    const href = `/calstakk/calendars/${colName}/${change.uid}.ics`;
    if (change.type === "deleted") {
      responses.push(notFoundResponseXML(href));
    } else {
      const obj = await storage.getObject(colName, change.uid);
      if (obj) {
        responses.push(buildObjectResponse(href, obj, pfReq));
      }
    }
  }

  // Include sync-token in the response
  const syncTokenXML = D("sync-token", syncResult.newToken);
  const respBody =
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    responses.join("") +
    D("response", D("href", path) + D("propstat", D("prop", syncTokenXML) + D("status", "HTTP/1.1 200 OK"))) +
    `</D:multistatus>`;

  return xmlResponse(207, respBody);
}

function handleFreeBusyQuery(): Response {
  // Return a minimal VFREEBUSY response
  const freebusy =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//CalDAV Server//EN\r\n" +
    "BEGIN:VFREEBUSY\r\nDTSTAMP:" +
    new Date().toISOString().replace(/[-:]/g, "").split(".")[0] +
    "Z\r\nEND:VFREEBUSY\r\nEND:VCALENDAR\r\n";

  return new Response(freebusy, {
    status: 200,
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
}
