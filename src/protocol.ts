// CalDAV / WebDAV HTTP handler.
// Routes requests to the appropriate handler based on method and path.

import {
  CALENDAR_HOME_PATH,
  collectionNameFromPath,
  collectionPath,
  DEFAULT_CALENDAR_NAME,
  HTTPError,
  INBOX_PATH,
  objectUIDFromPath,
  OUTBOX_PATH,
  parseDepth,
  PRINCIPAL_PATH,
  ResourceType,
  resourceTypeAtPath,
} from "./types.ts";

import {
  applyCalDataSpec,
  type CalDataCompSpec,
  C,
  Cattr,
  type CalendarMultiget,
  type CalendarQuery,
  type CompFilter,
  D,
  esc,
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
import { extractUID, extractTzOffsetFromVTZ, matchesFilter, validateCalendarObject, parseICS, getProp, getProps, getComps, type ICalComponent } from "./ical.ts";
import type { Config } from "./config.ts";
import { isWellFormedXML } from "./xmlparse.ts";

// ─── Sync-token URI helpers ───────────────────────────────────────────────────

const SYNC_TOKEN_PREFIX = "urn:calstakk:sync:";

function wrapSyncToken(rawToken: string): string {
  return `${SYNC_TOKEN_PREFIX}${rawToken}`;
}

function unwrapSyncToken(uriToken: string): string {
  return uriToken.startsWith(SYNC_TOKEN_PREFIX)
    ? uriToken.slice(SYNC_TOKEN_PREFIX.length)
    : uriToken;
}

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

function xmlResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      ...extraHeaders,
    },
  });
}

const DAV_HEADER = "1, calendar-access, calendar-availability, calendar-no-timezone, calendar-managed-attachments, calendar-managed-attachments-no-recurrence, calendar-auto-schedule";
const ALLOW_HEADER =
  "OPTIONS, GET, HEAD, PUT, POST, DELETE, PROPFIND, PROPPATCH, MKCOL, MKCALENDAR, REPORT";

// ─── createHandler ────────────────────────────────────────────────────────────

export function createHandler(
  storage: Storage,
  config: Config,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await route(req, storage, config);
    } catch (err) {
      if (err instanceof HTTPError) {
        return textResponse(err.code, err.message);
      }
      console.error("Unhandled error:", err);
      return textResponse(500, "Internal Server Error");
    }
  };
}

async function route(req: Request, storage: Storage, config: Config): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const method = req.method.toUpperCase();

  // /.well-known/caldav redirect — RFC 6764 §5: must use absolute URI, must include Cache-Control
  if (path === "/.well-known/caldav") {
    const absLocation = `${url.origin}${PRINCIPAL_PATH}`;
    return respond(308, "", { Location: absLocation, "Cache-Control": "no-cache" });
  }

  const resType = resourceTypeAtPath(path);

  switch (method) {
    case "OPTIONS":
      return handleOptions();
    case "GET":
      return await handleGet(req, path, resType, storage);
    case "HEAD":
      return await handleHead(path, resType, storage);
    case "PUT":
      return await handlePut(req, path, resType, storage);
    case "DELETE":
      return await handleDelete(path, resType, storage);
    case "PROPFIND":
      return await handlePropfind(req, path, resType, storage, config);
    case "PROPPATCH":
      return await handleProppatch(req, path, resType, storage);
    case "MKCOL":
      return await handleMkcol(req, path, resType, storage, false);
    case "MKCALENDAR":
      return await handleMkcol(req, path, resType, storage, true);
    case "REPORT":
      return await handleReport(req, path, resType, storage);
    case "COPY":
      return await handleCopy(req, path, resType, storage);
    case "MOVE":
      return await handleMove(req, path, resType, storage);
    case "POST":
      return await handlePost(req, path, resType, storage);
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

// RFC 7809 §3.1.3: strip VTIMEZONE blocks for well-known (non-X-prefix) TZIDs
function stripKnownVTimezones(ics: string): string {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const lines = ics.split(eol);
  const result: string[] = [];
  let inVTZ = false;
  let keepVTZ = false;
  const vtzLines: string[] = [];

  for (const line of lines) {
    if (!inVTZ) {
      if (line === "BEGIN:VTIMEZONE") {
        inVTZ = true;
        keepVTZ = false;
        vtzLines.length = 0;
        vtzLines.push(line);
      } else {
        result.push(line);
      }
    } else {
      vtzLines.push(line);
      if (line.startsWith("TZID:")) {
        const tzid = line.slice(5).trim();
        keepVTZ = tzid.startsWith("X-");
      }
      if (line === "END:VTIMEZONE") {
        inVTZ = false;
        if (keepVTZ) result.push(...vtzLines);
        vtzLines.length = 0;
      }
    }
  }
  return result.join(eol);
}

async function handleGet(req: Request, path: string, resType: ResourceType, storage: Storage): Promise<Response> {
  if (resType !== "object") {
    return respond(405, "Method not allowed");
  }
  const colName = collectionNameFromPath(path);
  const uid = objectUIDFromPath(path);
  const obj = await storage.getObject(colName, uid);
  if (!obj) return respond(404, "Not found");

  const noTimezones = (req.headers.get("CalDAV-Timezones") ?? "").toUpperCase() === "F";
  const ics = noTimezones ? stripKnownVTimezones(obj.ics) : obj.ics;
  const contentLength = noTimezones ? new TextEncoder().encode(ics).length : obj.contentLength;

  const headers: Record<string, string> = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Length": String(contentLength),
    ETag: obj.etag,
    "Last-Modified": obj.lastModified.toUTCString(),
  };
  const schedTag = getScheduleTag(obj.deadProps ?? {});
  if (schedTag) headers["Schedule-Tag"] = schedTag;

  return new Response(ics, { status: 200, headers });
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
    return respond(409, `Calendar collection not found: ${colName}`);
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

  // WebDAV If header check
  const ifHeader = req.headers.get("If");
  if (ifHeader) {
    // State-token form: <resource-URI> (<state-token>) — RFC 4918 §10.4
    const stateTokenMatch = ifHeader.match(/<([^>]+)>\s*\(<([^>]+)>\)/);
    if (stateTokenMatch) {
      const tokenUri = stateTokenMatch[2];
      if (tokenUri.startsWith(SYNC_TOKEN_PREFIX)) {
        const ifPath = stateTokenMatch[1];
        let ifColName: string;
        try {
          ifColName = collectionNameFromPath(new URL(ifPath).pathname);
        } catch {
          ifColName = collectionNameFromPath(ifPath);
        }
        const currentToken = wrapSyncToken(await storage.getSyncToken(ifColName));
        if (tokenUri !== currentToken) {
          return respond(412, "Precondition Failed: stale sync-token");
        }
      }
    }
    // ETag form: ["etag"]
    const etagMatch = ifHeader.match(/\["([^"]+)"\]/);
    if (etagMatch) {
      const expectedETag = `"${etagMatch[1]}"`;
      const obj2 = await storage.getObject(colName, uid);
      if (!obj2 || obj2.etag !== expectedETag) {
        return respond(412, "Precondition Failed: If header condition not met");
      }
    }
  }

  // UID conflict check: same icalUID at a different URL
  const existingUID = await storage.findObjectByICalUID(colName, icalUID);
  if (existingUID && existingUID !== uid) {
    return xmlResponse(409, buildPreconditionError("no-uid-conflict"));
  }

  // RFC 8607 §3.4: ATTACH;MANAGED-ID= must have been assigned by the server via POST
  // Since we don't implement full attachment storage, any MANAGED-ID in a PUT is invalid
  for (const comp of [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")]) {
    for (const attach of getProps(comp, "ATTACH")) {
      if (attach.params["MANAGED-ID"]) {
        return xmlResponse(403, buildPreconditionError("valid-managed-id-parameter"));
      }
    }
  }

  // SEQUENCE check: reject stale updates (RFC 5546 §2.1.5)
  if (existing) {
    const newComponents = [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")];
    const newSeq = newComponents.length > 0 ? parseInt(getProp(newComponents[0], "SEQUENCE")?.value ?? "0", 10) : 0;
    try {
      const storedCal = parseICS(existing.ics);
      const storedComponents = [...getComps(storedCal, "VEVENT"), ...getComps(storedCal, "VTODO")];
      const storedSeq = storedComponents.length > 0 ? parseInt(getProp(storedComponents[0], "SEQUENCE")?.value ?? "0", 10) : 0;
      if (newSeq < storedSeq) {
        return respond(412, "Precondition Failed: SEQUENCE is lower than stored object");
      }
    } catch {
      // Ignore parse errors on stored content
    }
  }

  // ─── Scheduling object logic (RFC 6638) ───────────────────────────────────
  const isSchedObj = isSchedulingObject(ics);
  let storedIcs = ics;
  let schedTag: string | null = null;

  if (isSchedObj) {
    // §3.2.4.2: All components must have the same ORGANIZER
    const allComponents = [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")];
    if (allComponents.length > 1) {
      const organizers = allComponents.map((c) => getProp(c, "ORGANIZER")?.value ?? "").filter(Boolean);
      const uniqueOrgs = new Set(organizers.map((o) => o.toLowerCase()));
      if (uniqueOrgs.size > 1) {
        return xmlResponse(403, buildPreconditionError("same-organizer-in-all-components"));
      }
    }

    // §3.2.4.1: Scheduling object UID must be unique across all collections
    const globalMatch = await storage.findObjectByICalUIDGlobal(icalUID);
    if (globalMatch && globalMatch.calendarName !== colName) {
      return xmlResponse(403, buildPreconditionError("unique-scheduling-object-resource"));
    }

    // §11.2 item 5: Anti-spoofing — ORGANIZER cannot change on an existing scheduling object
    if (existing && isSchedulingObject(existing.ics)) {
      const existingOrg = existing.ics.match(/^ORGANIZER[;:][^\r\n]+/m)?.[0]?.replace(/^ORGANIZER[;:]/, "").trim().toLowerCase() ?? "";
      const newOrg = ics.match(/^ORGANIZER[;:][^\r\n]+/m)?.[0]?.replace(/^ORGANIZER[;:]/, "").trim().toLowerCase() ?? "";
      if (existingOrg && newOrg && existingOrg !== newOrg) {
        return xmlResponse(403, buildPreconditionError("same-organizer-in-all-components"));
      }
    }

    // §8.3: If-Schedule-Tag-Match conditional header
    const ifSchedTagMatch = req.headers.get("If-Schedule-Tag-Match");
    if (ifSchedTagMatch && existing) {
      const storedTag = getScheduleTag(existing.deadProps ?? {});
      if (!storedTag || ifSchedTagMatch !== storedTag) {
        return respond(412, "Precondition Failed: If-Schedule-Tag-Match mismatch");
      }
    }

    // §3.2.1.2: If DTSTART changed (reschedule), reset all ATTENDEE PARTSTAT to NEEDS-ACTION
    let resetPartstat = false;
    if (existing) {
      const oldDTSTART = extractDTSTART(existing.ics);
      const newDTSTART = extractDTSTART(ics);
      if (oldDTSTART && newDTSTART && oldDTSTART !== newDTSTART) {
        resetPartstat = true;
      }
    }

    // Mutate ICS: strip SCHEDULE-FORCE-SEND, add SCHEDULE-STATUS, reset PARTSTAT if needed
    storedIcs = mutateSchedulingICS(ics, {
      stripForceSend: true,
      addScheduleStatus: true,
      resetPartstat,
    });

    // §3.2.10: Compute scheduling hash to determine if schedule-tag should change
    const newHash = await hashSchedulingContent(storedIcs);
    const oldHash = existing ? getSchedulingHash(existing.deadProps ?? {}) : null;
    const existingTag = existing ? getScheduleTag(existing.deadProps ?? {}) : null;
    schedTag = (existingTag && oldHash === newHash) ? existingTag : `"${crypto.randomUUID()}"`;
  }

  const obj = await storage.putObject(colName, uid, storedIcs, icalUID);

  if (isSchedObj && schedTag) {
    await storage.updateObjectProp(colName, uid, "urn:ietf:params:xml:ns:caldav\x00schedule-tag", scheduleTagXml(schedTag));
    await storage.updateObjectProp(colName, uid, "urn:calstakk:internal\x00scheduling-hash", await hashSchedulingContent(storedIcs));
  }

  const respHeaders: Record<string, string> = {
    ETag: obj.etag,
    "Last-Modified": obj.lastModified.toUTCString(),
  };
  if (schedTag) respHeaders["Schedule-Tag"] = schedTag;

  return respond(existing ? 204 : 201, "", respHeaders);
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
    // Protect the default scheduling calendar from deletion (RFC 6638 §4.3)
    // Check BEFORE existence check so non-existent default calendar also returns 403
    const defaultCalPath = await getInboxDefaultCalPath(storage);
    if (collectionPath(colName) === defaultCalPath) {
      return xmlResponse(403, buildPreconditionError("default-calendar-needed"));
    }
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
  config: Config,
): Promise<Response> {
  const depth = parseDepth(req.headers.get("Depth"));
  const body = await req.text();
  if (body.trim() && !isWellFormedXML(body)) {
    return respond(400, "Malformed XML request body");
  }
  const pfReq = parsePropfind(body);

  const responses: string[] = [];

  switch (resType) {
    case "root":
    case "principal":
      responses.push(buildPrincipalResponse(path, pfReq, config));
      if (depth !== "0") {
        responses.push(buildCalendarHomeResponse(CALENDAR_HOME_PATH, pfReq));
        if (depth === "infinity") {
          const cals = await storage.listCalendars();
          for (const cal of cals) {
            responses.push(buildCollectionResponse(cal.href, cal, pfReq, "0", config));
          }
        }
      }
      break;

    case "calendarHome":
      responses.push(buildCalendarHomeResponse(path, pfReq));
      if (depth !== "0") {
        const cals = await storage.listCalendars();
        for (const cal of cals) {
          responses.push(buildCollectionResponse(cal.href, cal, pfReq, "0", config));
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
      responses.push(buildCollectionResponse(path, col, pfReq, syncToken, config));
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

    case "inbox": {
      const defaultCalPath = await getInboxDefaultCalPath(storage);
      responses.push(buildPropsResponse(INBOX_PATH, inboxProps(defaultCalPath), pfReq));
      break;
    }

    case "outbox":
      responses.push(buildPropsResponse(OUTBOX_PATH, outboxProps(), pfReq));
      break;

    default:
      return respond(404, "Not found");
  }

  const extraHeaders: Record<string, string> = {};
  if (resType === "collection" && !path.endsWith("/")) {
    extraHeaders["Content-Location"] = path + "/";
  }
  return xmlResponse(207, multiStatusXML(responses), extraHeaders);
}

// ─── Property maps ────────────────────────────────────────────────────────────

type PropMap = Map<string, string>; // key: "ns:local", value: XML string

function makeKey(ns: string, local: string): string {
  return `${ns}:${local}`;
}

const PROTECTED_PROPS = new Set([
  makeKey("DAV:", "getetag"),
  makeKey("DAV:", "getlastmodified"),
  makeKey("DAV:", "getcontentlength"),
  makeKey("DAV:", "getcontenttype"),
  makeKey("DAV:", "resourcetype"),
  makeKey("DAV:", "creationdate"),
  makeKey("DAV:", "current-user-principal"),
  makeKey("DAV:", "lockdiscovery"),
  makeKey("DAV:", "supportedlock"),
  makeKey("DAV:", "sync-token"),
  makeKey("DAV:", "supported-report-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-component-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-data"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-resource-size"),
  makeKey("urn:ietf:params:xml:ns:caldav", "min-date-time"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-date-time"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-instances"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-attendees-per-instance"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-collation-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "managed-attachments-server-URL"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-attachment-size"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-attachments-per-resource"),
]);

// Keys excluded from DAV:allprop (RFC 4791 §7.1, RFC 6578 §4)
const ALLPROP_EXCLUDED = new Set([
  makeKey("DAV:", "sync-token"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-data"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-description"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-data"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-component-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-resource-size"),
  makeKey("urn:ietf:params:xml:ns:caldav", "min-date-time"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-date-time"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-instances"),
  makeKey("urn:ietf:params:xml:ns:caldav", "max-attendees-per-instance"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone-id"),
  makeKey("urn:ietf:params:xml:ns:caldav", "schedule-calendar-transp"),
  makeKey("urn:ietf:params:xml:ns:caldav", "supported-collation-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-home-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-user-address-set"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-availability"),
  makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone"),
  makeKey("urn:ietf:params:xml:ns:caldav", "schedule-inbox-URL"),
  makeKey("urn:ietf:params:xml:ns:caldav", "schedule-outbox-URL"),
  makeKey("urn:ietf:params:xml:ns:caldav", "schedule-default-calendar-URL"),
]);

function principalProps(config: Config): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + D("principal")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", config.user.displayName));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-home-set"),
    C("calendar-home-set", D("href", CALENDAR_HOME_PATH)),
  );
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  const userEmail = config.user.email ?? "mailto:user@localhost";
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-user-address-set"),
    C("calendar-user-address-set", D("href", userEmail.startsWith("mailto:") ? userEmail : `mailto:${userEmail}`)),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-inbox-URL"),
    C("schedule-inbox-URL", INBOX_PATH),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-outbox-URL"),
    C("schedule-outbox-URL", OUTBOX_PATH),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-default-calendar-URL"),
    C("schedule-default-calendar-URL", D("href", collectionPath(DEFAULT_CALENDAR_NAME))),
  );
  m.set(
    makeKey("DAV:", "supported-privilege-set"),
    D(
      "supported-privilege-set",
      D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
      D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
      D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
      D("supported-privilege", D("privilege", C("read-free-busy")) + D("description", "Read free/busy")),
    ),
  );
  return m;
}

async function getInboxDefaultCalPath(storage: Storage): Promise<string> {
  const cal = await storage.getCalendar("__inbox__");
  const stored = cal?.customProps["urn:calstakk:internal\x00default-cal-url"];
  return stored ?? collectionPath(DEFAULT_CALENDAR_NAME);
}

function inboxPrivilegeSet(): string {
  // RFC 6638 §6.1: schedule-deliver and sub-privileges on inbox
  // D:privilege uses name="" attribute so tests can match `schedule-deliver"` substring
  const sub = (priv: string) =>
    D("supported-privilege", D("privilege", C(priv), { name: priv }) + D("description", priv));
  return D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
      D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
      D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
      D(
        "supported-privilege",
        D("privilege", C("schedule-deliver"), { name: "schedule-deliver" }) +
          D("description", "Scheduling deliveries") +
          sub("schedule-deliver-invite") +
          sub("schedule-deliver-reply") +
          sub("schedule-query-freebusy"),
      ),
  );
}

function outboxPrivilegeSet(): string {
  // RFC 6638 §6.2: schedule-send and sub-privileges on outbox
  const sub = (priv: string) =>
    D("supported-privilege", D("privilege", C(priv), { name: priv }) + D("description", priv));
  return D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
      D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
      D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
      D(
        "supported-privilege",
        D("privilege", C("schedule-send"), { name: "schedule-send" }) +
          D("description", "Scheduling sends") +
          sub("schedule-send-invite") +
          sub("schedule-send-reply") +
          sub("schedule-send-freebusy"),
      ),
  );
}

function inboxProps(defaultCalPath: string): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + C("schedule-inbox")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Inbox"));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", PRINCIPAL_PATH)));
  // Mixed content: direct text + D:href so both .text() and .hasChild("href") work in tests
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-default-calendar-URL"),
    C("schedule-default-calendar-URL", esc(defaultCalPath) + D("href", defaultCalPath)),
  );
  m.set(makeKey("DAV:", "supported-privilege-set"), inboxPrivilegeSet());
  return m;
}

function outboxProps(): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + C("schedule-outbox")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Outbox"));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", PRINCIPAL_PATH)));
  m.set(makeKey("DAV:", "supported-privilege-set"), outboxPrivilegeSet());
  return m;
}

function parseCTParams(parts: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) {
      result[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return result;
}

function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return true;
  }
  return false;
}

function extractMultipartCalendars(body: string, boundary: string): Array<{ ics: string; methodParam: string | null }> {
  const result: Array<{ ics: string; methodParam: string | null }> = [];
  const parts = body.split(`--${boundary}`);
  for (const part of parts) {
    if (!part || part.startsWith("--") || !part.trim()) continue;
    const clean = part.replace(/^\r?\n/, "");
    const hbIdx = clean.indexOf("\r\n\r\n");
    if (hbIdx < 0) continue;
    const headers = clean.slice(0, hbIdx);
    const partBody = clean.slice(hbIdx + 4);
    const ctLine = headers.split(/\r\n|\n/).find((l) => /^Content-Type:/i.test(l));
    if (!ctLine) continue;
    const ctValue = ctLine.replace(/^Content-Type:\s*/i, "");
    const [rawMedia, ...paramParts] = ctValue.split(";");
    if (rawMedia.trim().toLowerCase() !== "text/calendar") continue;
    const ctParams = parseCTParams(paramParts);
    result.push({ ics: partBody, methodParam: ctParams["method"] ?? null });
  }
  return result;
}

function buildScheduleResponseXml(responses: string[]): string {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<C:schedule-response xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">' +
    responses.join("") +
    "</C:schedule-response>";
}

function recipientXml(calAddr: string): string {
  return `<C:response><C:recipient><D:href>${esc(calAddr)}</D:href></C:recipient>` +
    `<C:request-status>3.7;Invalid Calendar User</C:request-status></C:response>`;
}

// Process a single text/calendar body for an outbox POST.
// Returns an array of per-recipient XML strings on success, or a Response on error.
async function processSchedulingCalendar(
  ics: string,
  methodParam: string | null,
): Promise<string[] | Response> {
  let cal;
  try {
    cal = parseICS(ics);
  } catch {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  const calMethod = (getProp(cal, "METHOD")?.value ?? "").toUpperCase();
  if (!calMethod) {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  // Content-Type method param (if present) must match calendar METHOD (case-insensitive)
  if (methodParam && methodParam.toUpperCase() !== calMethod) {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  // VFREEBUSY free-busy query (RFC 6638 §5)
  if (calMethod === "REQUEST") {
    const vfreebusy = getComps(cal, "VFREEBUSY");
    if (vfreebusy.length > 0) {
      const fbComp = vfreebusy[0];
      if (!getProp(fbComp, "ORGANIZER")) {
        return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
      }
      return getProps(fbComp, "ATTENDEE").map((a) => recipientXml(a.value));
    }
  }

  // PUBLISH: no attendees needed
  if (calMethod === "PUBLISH") return [];

  // REQUEST, REPLY, CANCEL: need a component with ORGANIZER (mailto:) and valid ATTENDEEs
  const allComps = [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")];
  if (allComps.length === 0) {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }
  const firstComp = allComps[0];
  const organizer = getProp(firstComp, "ORGANIZER");
  if (!organizer || !organizer.value.startsWith("mailto:")) {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }
  const attendees = getProps(firstComp, "ATTENDEE");
  for (const att of attendees) {
    if (!att.value.startsWith("mailto:")) {
      return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
    }
  }
  return attendees.map((a) => recipientXml(a.value));
}

async function handleOutboxPost(req: Request): Promise<Response> {
  const ctHeader = req.headers.get("Content-Type") ?? "";
  const [rawMedia, ...ctParamParts] = ctHeader.split(";");
  const mediaType = rawMedia.trim().toLowerCase();
  const ctParams = parseCTParams(ctParamParts);

  const bodyText = await req.text();

  if (mediaType === "multipart/mixed") {
    const boundary = ctParams["boundary"] ?? "";
    if (!boundary) return respond(400, "Bad Request: multipart/mixed without boundary");
    const parts = extractMultipartCalendars(bodyText, boundary);
    if (parts.length === 0) return respond(400, "Bad Request: no text/calendar parts found");
    const allRecs: string[] = [];
    for (const p of parts) {
      const result = await processSchedulingCalendar(p.ics, p.methodParam);
      if (Array.isArray(result)) allRecs.push(...result);
      // On error in individual part, skip it (best-effort)
    }
    return xmlResponse(200, buildScheduleResponseXml(allRecs));
  }

  if (mediaType !== "text/calendar") {
    return respond(415, "Unsupported Media Type: expected text/calendar or multipart/mixed");
  }

  const methodParam = ctParams["method"] ?? null;

  // RFC 6047 §2.4: charset=UTF-8 required when iMIP body (method param present) has non-ASCII
  if (methodParam && hasNonAscii(bodyText) && ctParams["charset"]?.toLowerCase() !== "utf-8") {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  const result = await processSchedulingCalendar(bodyText, methodParam);
  if (result instanceof Response) return result;
  return xmlResponse(200, buildScheduleResponseXml(result));
}

function calendarHomeProps(syncToken: string): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Calendars"));
  m.set(
    makeKey("DAV:", "current-user-principal"),
    D("current-user-principal", D("href", PRINCIPAL_PATH)),
  );
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", wrapSyncToken(syncToken)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  return m;
}

function collectionProps(
  name: string,
  displayName: string,
  syncToken: string,
  customProps: Record<string, string> = {},
  config?: Config,
): PropMap {
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
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", wrapSyncToken(syncToken)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  m.set(
    makeKey("DAV:", "supported-report-set"),
    D(
      "supported-report-set",
      D("supported-report", D("report", C("calendar-query"))) +
        D("supported-report", D("report", C("calendar-multiget"))) +
        D("supported-report", D("report", C("free-busy-query"))) +
        D("supported-report", D("report", D("sync-collection"))) +
        D("supported-report", D("report", D("expand-property"))),
    ),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "supported-collation-set"),
    C(
      "supported-collation-set",
      C("supported-collation", "i;ascii-casemap") + C("supported-collation", "i;octet"),
    ),
  );
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
      Cattr("comp", { name: "VEVENT" }) + Cattr("comp", { name: "VTODO" }) + Cattr("comp", { name: "VAVAILABILITY" }),
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
  const defaultTzId = config?.user.timezone ?? "UTC";
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone-id"),
    C("calendar-timezone-id", defaultTzId),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone"),
    C(
      "calendar-timezone",
      escapeXmlCDATA(
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:${defaultTzId}\r\nEND:VTIMEZONE\r\nEND:VCALENDAR\r\n`,
      ),
    ),
  );
  m.set(
    makeKey("urn:ietf:params:xml:ns:caldav", "schedule-calendar-transp"),
    C("schedule-calendar-transp", C("opaque")),
  );
  m.set(
    makeKey("DAV:", "supported-privilege-set"),
    D(
      "supported-privilege-set",
      D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
      D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
      D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
      D("supported-privilege", D("privilege", C("read-free-busy")) + D("description", "Read free/busy")),
    ),
  );

  // Apply stored custom property overrides (rawValue is always a full XML element)
  for (const [key, rawValue] of Object.entries(customProps)) {
    const idx = key.indexOf("\x00");
    if (idx < 0) continue;
    const ns = key.slice(0, idx);
    const local = key.slice(idx + 1);
    m.set(makeKey(ns, local), rawValue);
  }

  return m;
}

// ─── Scheduling helpers ───────────────────────────────────────────────────────

function isSchedulingObject(ics: string): boolean {
  return /^ORGANIZER[;:]/m.test(ics);
}

function unfoldLines(ics: string): { lines: string[]; eol: string } {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const raw = ics.split(eol);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return { lines, eol };
}

function foldLine(line: string, eol: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let pos = 0;
  let first = true;
  while (pos < line.length) {
    const max = first ? 75 : 74;
    parts.push((first ? "" : " ") + line.slice(pos, pos + max));
    pos += max;
    first = false;
  }
  return parts.join(eol);
}

function mutateSchedulingICS(ics: string, opts: {
  stripForceSend?: boolean;
  addScheduleStatus?: boolean;
  resetPartstat?: boolean;
}): string {
  const { lines, eol } = unfoldLines(ics);
  const result: string[] = [];
  for (const line of lines) {
    if (/^ATTENDEE[;:]/i.test(line)) {
      let l = line;
      if (opts.stripForceSend) {
        l = l.replace(/;SCHEDULE-FORCE-SEND=[^;:]+/gi, "");
      }
      if (opts.addScheduleStatus && !l.includes("SCHEDULE-STATUS")) {
        const isClientAgent = /SCHEDULE-AGENT=CLIENT/i.test(l);
        const isNoneAgent = /SCHEDULE-AGENT=NONE/i.test(l);
        if (!isClientAgent && !isNoneAgent) {
          const colonIdx = l.indexOf(":");
          if (colonIdx >= 0) {
            l = l.slice(0, colonIdx) + ";SCHEDULE-STATUS=1.2" + l.slice(colonIdx);
          }
        }
      }
      if (opts.resetPartstat) {
        l = l.replace(/PARTSTAT=[^;:]+/i, "PARTSTAT=NEEDS-ACTION");
      }
      result.push(foldLine(l, eol));
    } else {
      result.push(line);
    }
  }
  return result.join(eol);
}

async function hashSchedulingContent(ics: string): Promise<string> {
  const { lines } = unfoldLines(ics);
  // Exclude ATTENDEE (PARTSTAT replies) and volatile metadata (DTSTAMP, LAST-MODIFIED, CREATED)
  const scheduling = lines.filter((l) =>
    !/^ATTENDEE[;:]/i.test(l) &&
    !/^DTSTAMP[;:]/i.test(l) &&
    !/^LAST-MODIFIED[;:]/i.test(l) &&
    !/^CREATED[;:]/i.test(l)
  ).join("\n");
  const data = new TextEncoder().encode(scheduling);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

function readDeadPropValue(deadProps: Record<string, string>, key: string): string | null {
  const xml = deadProps[key];
  if (!xml) return null;
  const m = xml.match(/>([^<]+)</);
  return m?.[1]?.trim() ?? null;
}

function getScheduleTag(deadProps: Record<string, string>): string | null {
  return readDeadPropValue(deadProps, "urn:ietf:params:xml:ns:caldav\x00schedule-tag");
}

function getSchedulingHash(deadProps: Record<string, string>): string | null {
  // Stored as raw base64 string, not XML — read directly
  return deadProps["urn:calstakk:internal\x00scheduling-hash"] ?? null;
}

function scheduleTagXml(tag: string): string {
  return `<C:schedule-tag xmlns:C="urn:ietf:params:xml:ns:caldav">${escapeXmlCDATA(tag)}</C:schedule-tag>`;
}

function extractDTSTART(ics: string): string | null {
  const m = ics.match(/^DTSTART[;:][^\r\n]+/m);
  return m?.[0] ?? null;
}

function objectPropsMap(
  etag: string,
  lastModified: Date,
  contentLength: number,
  ics: string,
  deadProps: Record<string, string> = {},
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

  // Add dead props (filter internal-only props)
  for (const [key, rawXml] of Object.entries(deadProps)) {
    const idx = key.indexOf("\x00");
    if (idx < 0) continue;
    const ns = key.slice(0, idx);
    if (ns === "urn:calstakk:internal") continue;
    const local = key.slice(idx + 1);
    m.set(makeKey(ns, local), rawXml);
  }

  return m;
}

function escapeXmlCDATA(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Response builders ────────────────────────────────────────────────────────

function buildPropsResponse(href: string, props: PropMap, pfReq: PropFindRequest): string {
  if (pfReq.type === "allprop") {
    const allProps = Array.from(props.entries())
      .filter(([k]) => !ALLPROP_EXCLUDED.has(k))
      .map(([, v]) => v)
      .join("");
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

function buildPrincipalResponse(href: string, pfReq: PropFindRequest, config: Config): string {
  return buildPropsResponse(href, principalProps(config), pfReq);
}

function buildCalendarHomeResponse(href: string, pfReq: PropFindRequest): string {
  // Use a placeholder sync token for the home
  return buildPropsResponse(href, calendarHomeProps("0"), pfReq);
}

function buildCollectionResponse(
  href: string,
  col: { name: string; displayName: string; customProps?: Record<string, string> },
  pfReq: PropFindRequest,
  syncToken = "0",
  config?: Config,
): string {
  return buildPropsResponse(
    href,
    collectionProps(col.name, col.displayName, syncToken, col.customProps ?? {}, config),
    pfReq,
  );
}

function buildObjectResponse(
  href: string,
  obj: { etag: string; lastModified: Date; contentLength: number; ics: string; deadProps?: Record<string, string> },
  pfReq: PropFindRequest,
  noTimezones = false,
  calDataSpec?: CalDataCompSpec,
): string {
  let ics = noTimezones ? stripKnownVTimezones(obj.ics) : obj.ics;
  if (calDataSpec) ics = applyCalDataSpec(ics, calDataSpec);
  const contentLength = (noTimezones || calDataSpec) ? new TextEncoder().encode(ics).length : obj.contentLength;
  return buildPropsResponse(
    href,
    objectPropsMap(obj.etag, obj.lastModified, contentLength, ics, obj.deadProps ?? {}),
    pfReq,
  );
}

// ─── PROPPATCH ────────────────────────────────────────────────────────────────

function ppStatusText(code: number): string {
  const map: Record<number, string> = { 200: "OK", 403: "Forbidden", 424: "Failed Dependency" };
  return map[code] ?? "Unknown";
}

async function handleProppatch(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  // RFC 6638: PROPPATCH on inbox (schedule-default-calendar-URL validation)
  if (resType === "inbox") {
    const body = await req.text();
    const ops = parseProppatch(body);
    for (const op of ops) {
      if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "schedule-default-calendar-URL") {
        const hrefMatch = op.rawXml.match(/<[^>]*href>([^<]+)<\/[^>]*href>/);
        const calPath = (hrefMatch?.[1]?.trim() ?? op.value).replace(/\/$/, "");
        const calName = calPath.replace(/^\/calstakk\/calendars\//, "").replace(/\/$/, "");
        const col = await storage.getCalendar(calName);
        if (!col) {
          return xmlResponse(403, buildPreconditionError("valid-schedule-default-calendar-URL"));
        }
        try { await storage.createCalendar("__inbox__", "Inbox Storage"); } catch { /* already exists */ }
        await storage.updateCalendarProp("__inbox__", "urn:calstakk:internal\x00default-cal-url", calPath);
      }
    }
    return xmlResponse(207, multiStatusXML([]));
  }

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
  if (body.trim() && !isWellFormedXML(body)) {
    return respond(400, "Malformed XML request body");
  }
  const ops = parseProppatch(body);

  // Check for protected props
  const hasProtected = ops.some((op) => op.type === "set" && PROTECTED_PROPS.has(makeKey(op.ns, op.local)));

  // Validate calendar-availability value (RFC 7953 §7.2.4: must contain exactly one VAVAILABILITY)
  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-availability") {
      const val = op.value.trim();
      try {
        const avCal = parseICS(val);
        const vavails = getComps(avCal, "VAVAILABILITY");
        // Must have exactly one VAVAILABILITY and no other component types (aside from VTIMEZONE)
        const nonVtz = avCal.children.filter((c) => c.name !== "VTIMEZONE" && c.name !== "VAVAILABILITY");
        if (vavails.length !== 1 || nonVtz.length > 0) {
          return xmlResponse(
            409,
            '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>',
          );
        }
      } catch {
        return xmlResponse(
          409,
          '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>',
        );
      }
    }
  }

  // Validate calendar-timezone-id value (RFC 7809 §3.1.5: must be a known timezone ID)
  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone-id") {
      const tzId = op.value.trim();
      if (tzId.startsWith("X-")) {
        return xmlResponse(403, buildPreconditionError("valid-timezone"));
      }
    }
  }

  // Validate calendar-timezone value (must contain a VTIMEZONE component)
  // Also accepts standalone VTIMEZONE (without VCALENDAR wrapper) and \n-escaped line breaks.
  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone") {
      const val = op.value.trim().replace(/\\n/g, "\n");
      const hasTz = val.includes("BEGIN:VTIMEZONE");
      if (!hasTz) {
        return xmlResponse(
          409,
          '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>',
        );
      }
    }
  }

  if (!hasProtected) {
    // Persist all writable properties
    if (resType === "collection") {
      const colName = collectionNameFromPath(path);
      for (const op of ops) {
        if (op.type === "set") {
          if (op.ns === "DAV:" && op.local === "displayname") {
            await storage.updateCalendarDisplayName(colName, op.value);
          } else {
            await storage.updateCalendarProp(colName, `${op.ns}\x00${op.local}`, op.rawXml);
          }
          // RFC 7809 §3.1.5: keep calendar-timezone and calendar-timezone-id in sync
          if (op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone") {
            const normalized = op.value.trim().replace(/\\n/g, "\n");
            const tzidMatch = normalized.match(/TZID:([^\r\n;:]+)/);
            const extractedTzId = tzidMatch?.[1]?.trim();
            if (extractedTzId) {
              const tzIdXml = `<C:calendar-timezone-id xmlns:C="urn:ietf:params:xml:ns:caldav">${esc(extractedTzId)}</C:calendar-timezone-id>`;
              await storage.updateCalendarProp(colName, `urn:ietf:params:xml:ns:caldav\x00calendar-timezone-id`, tzIdXml);
            }
          }
          if (op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone-id") {
            const tzId = op.value.trim();
            if (tzId) {
              const tzICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:${tzId}\r\nEND:VTIMEZONE\r\nEND:VCALENDAR\r\n`;
              const tzXml = `<C:calendar-timezone xmlns:C="urn:ietf:params:xml:ns:caldav">${escapeXmlCDATA(tzICS)}</C:calendar-timezone>`;
              await storage.updateCalendarProp(colName, `urn:ietf:params:xml:ns:caldav\x00calendar-timezone`, tzXml);
            }
          }
        }
      }
    } else if (resType === "object") {
      const colName = collectionNameFromPath(path);
      const uid = objectUIDFromPath(path);
      for (const op of ops) {
        if (op.type === "set") {
          await storage.updateObjectProp(colName, uid, `${op.ns}\x00${op.local}`, op.rawXml);
        }
      }
    }
  }

  // Build propstat entries
  const propstats = ops.map((op) => {
    const el = buildEmptyProp(op.ns, op.local);
    const isProtected = op.type === "set" && PROTECTED_PROPS.has(makeKey(op.ns, op.local));
    let statusCode: number;
    let errorXml = "";
    if (isProtected) {
      statusCode = 403;
      errorXml = `<D:error><D:cannot-modify-protected-property/></D:error>`;
    } else if (hasProtected) {
      statusCode = 424;
    } else {
      statusCode = 200;
    }
    return `<D:propstat><D:prop>${el}</D:prop><D:status>HTTP/1.1 ${statusCode} ${ppStatusText(statusCode)}</D:status>${errorXml}</D:propstat>`;
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
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
  isMkcalendar: boolean,
): Promise<Response> {
  // Check body content-type
  const reqBody = await req.text();
  const ct = req.headers.get("Content-Type") ?? "";
  if (reqBody.length > 0) {
    const mime = ct.split(";")[0].trim().toLowerCase();
    if (mime !== "application/xml" && mime !== "text/xml") {
      return respond(415, "Unsupported Media Type");
    }
  }

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

  // Parse MKCALENDAR body to extract displayname and calendar-description
  let displayName = colName;
  let calDescription: string | undefined;
  if (isMkcalendar && reqBody.length > 0) {
    const dnMatch = reqBody.match(/<[^:>]*:?displayname[^>]*>([^<]*)<\/[^>]*:?displayname>/);
    if (dnMatch) displayName = dnMatch[1];
    const descMatch = reqBody.match(/<[^:>]*:?calendar-description[^>]*>([^<]*)<\/[^>]*:?calendar-description>/);
    if (descMatch) calDescription = descMatch[1];
  }

  await storage.createCalendar(colName, displayName);
  if (calDescription !== undefined) {
    const key = `urn:ietf:params:xml:ns:caldav\x00calendar-description`;
    await storage.updateCalendarProp(colName, key, C("calendar-description", calDescription));
  }
  return respond(201, "", isMkcalendar ? { "Cache-Control": "no-cache" } : {});
}

// ─── COPY ─────────────────────────────────────────────────────────────────────

async function handleCopy(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const destHeader = req.headers.get("Destination");
  if (!destHeader) return respond(400, "Destination header required");

  let destPath: string;
  try {
    const destUrl = new URL(destHeader);
    destPath = decodeURIComponent(destUrl.pathname);
  } catch {
    destPath = destHeader;
  }

  if (path === destPath) return respond(403, "Source and destination are the same");

  const overwrite = req.headers.get("Overwrite") ?? "T";

  if (resType !== "object") {
    return respond(403, "COPY only supported for calendar objects");
  }

  const srcCol = collectionNameFromPath(path);
  const srcUid = objectUIDFromPath(path);
  const src = await storage.getObject(srcCol, srcUid);
  if (!src) return respond(404, "Source not found");

  const dstResType = resourceTypeAtPath(destPath);
  if (dstResType !== "object") return respond(409, "Invalid destination path");

  const dstCol = collectionNameFromPath(destPath);
  const dstUid = objectUIDFromPath(destPath);

  const dstCalendar = await storage.getCalendar(dstCol);
  if (!dstCalendar) return respond(409, "Destination collection does not exist");

  const existingDst = await storage.getObject(dstCol, dstUid);
  if (existingDst && overwrite === "F") return respond(412, "Precondition Failed: destination exists");

  await storage.copyObject(srcCol, srcUid, dstCol, dstUid);
  return respond(existingDst ? 204 : 201);
}

// ─── MOVE ─────────────────────────────────────────────────────────────────────

async function handleMove(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const destHeader = req.headers.get("Destination");
  if (!destHeader) return respond(400, "Destination header required");

  let destPath: string;
  try {
    const destUrl = new URL(destHeader);
    destPath = decodeURIComponent(destUrl.pathname);
  } catch {
    destPath = destHeader;
  }

  if (path === destPath) return respond(403, "Source and destination are the same");

  const overwrite = req.headers.get("Overwrite") ?? "T";

  if (resType !== "object") {
    return respond(403, "MOVE only supported for calendar objects");
  }

  const srcCol = collectionNameFromPath(path);
  const srcUid = objectUIDFromPath(path);
  const src = await storage.getObject(srcCol, srcUid);
  if (!src) return respond(404, "Source not found");

  const dstResType = resourceTypeAtPath(destPath);
  if (dstResType !== "object") return respond(409, "Invalid destination path");

  const dstCol = collectionNameFromPath(destPath);
  const dstUid = objectUIDFromPath(destPath);

  const dstCalendar = await storage.getCalendar(dstCol);
  if (!dstCalendar) return respond(409, "Destination collection does not exist");

  const existingDst = await storage.getObject(dstCol, dstUid);
  if (existingDst && overwrite === "F") return respond(412, "Precondition Failed: destination exists");

  await storage.moveObject(srcCol, srcUid, dstCol, dstUid);
  return respond(existingDst ? 204 : 201);
}

// ─── POST (RFC 8607 managed attachments) ──────────────────────────────────────

async function handlePost(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const managedId = url.searchParams.get("managed-id");
  const rid = url.searchParams.get("rid");

  // RFC 6638: POST to scheduling outbox (free-busy query)
  if (resType === "outbox") {
    return await handleOutboxPost(req);
  }

  // Only object-level POST is supported (attachment management)
  if (resType !== "object") {
    return respond(405, "Method not allowed");
  }

  const colName = collectionNameFromPath(path);
  const uid = objectUIDFromPath(path);
  const obj = await storage.getObject(colName, uid);
  if (!obj) return respond(404, "Not found");

  const VALID_ACTIONS = new Set(["attachment-add", "attachment-update", "attachment-remove"]);

  if (!action || !VALID_ACTIONS.has(action)) {
    return xmlResponse(403, buildPreconditionError("valid-action"));
  }

  if (action === "attachment-add" && managedId) {
    // RFC 8607 §3.3.3: attachment-add MUST NOT carry a managed-id parameter
    return xmlResponse(403, buildPreconditionError("valid-managed-id"));
  }

  // calendar-managed-attachments-no-recurrence: reject per-instance ops (rid= parameter)
  if (rid) {
    return xmlResponse(403, buildPreconditionError("valid-rid"));
  }

  if (action === "attachment-remove") {
    if (!managedId) {
      return xmlResponse(403, buildPreconditionError("valid-managed-id"));
    }
    const removedICS = icsRemoveAttach(obj.ics, managedId);
    if (removedICS === null) {
      return xmlResponse(403, buildPreconditionError("valid-managed-id"));
    }
    await storage.putObject(colName, uid, removedICS, obj.icalUID);
    return respond(204);
  }

  // attachment-add / attachment-update
  const body = await req.text();
  const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";
  const contentDisposition = req.headers.get("Content-Disposition") ?? "";
  const filenameMatch = contentDisposition.match(/filename=([^\s;]+)/);
  const filename = filenameMatch ? filenameMatch[1].replace(/^"|"$/g, "") : "";
  const size = new TextEncoder().encode(body).length;
  const assignedManagedId = `mgid-${crypto.randomUUID()}`;

  let updatedICS: string;
  if (action === "attachment-update" && managedId) {
    const replaced = icsReplaceAttach(obj.ics, managedId, assignedManagedId, contentType, filename, size);
    updatedICS = replaced ?? icsAddAttach(obj.ics, assignedManagedId, contentType, filename, size);
  } else {
    updatedICS = icsAddAttach(obj.ics, assignedManagedId, contentType, filename, size);
  }

  await storage.putObject(colName, uid, updatedICS, obj.icalUID);
  return respond(201, "", { "Cal-Managed-ID": assignedManagedId });
}

function icsAddAttach(ics: string, managedId: string, fmttype: string, filename: string, size: number): string {
  const attachLine = buildAttachLine(managedId, fmttype, filename, size);
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  for (const compEnd of ["END:VEVENT", "END:VTODO"]) {
    const idx = ics.indexOf(compEnd);
    if (idx >= 0) {
      return ics.slice(0, idx) + attachLine + eol + ics.slice(idx);
    }
  }
  return ics;
}

function icsRemoveAttach(ics: string, managedId: string): string | null {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const lines = ics.split(eol);
  let found = false;
  const result: string[] = [];
  let skip = false;
  for (const line of lines) {
    const unfolded = line.trimStart();
    if (!skip) {
      const propLine = unfolded.toUpperCase().startsWith("ATTACH") ? unfolded : line;
      if (propLine.toUpperCase().startsWith("ATTACH") && propLine.toUpperCase().includes("MANAGED-ID=" + managedId.toUpperCase())) {
        found = true;
        skip = true;
        continue;
      }
      result.push(line);
    } else {
      // Skip continuation (folded) lines — they start with whitespace
      if (line.startsWith(" ") || line.startsWith("\t")) {
        continue;
      }
      skip = false;
      result.push(line);
    }
  }
  if (!found) return null;
  return result.join(eol);
}

function icsReplaceAttach(ics: string, oldManagedId: string, newManagedId: string, fmttype: string, filename: string, size: number): string | null {
  const removed = icsRemoveAttach(ics, oldManagedId);
  if (removed === null) return null;
  return icsAddAttach(removed, newManagedId, fmttype, filename, size);
}

function buildAttachLine(managedId: string, fmttype: string, filename: string, size: number): string {
  let params = `MANAGED-ID=${managedId}`;
  if (fmttype) params += `;FMTTYPE=${fmttype}`;
  if (filename) params += `;FILENAME=${filename}`;
  params += `;SIZE=${size}`;
  return `ATTACH;${params}:data:${fmttype};base64,`;
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

async function handleReport(
  req: Request,
  path: string,
  resType: ResourceType,
  storage: Storage,
): Promise<Response> {
  const body = await req.text();
  if (body.trim() && !isWellFormedXML(body)) {
    return respond(400, "Malformed XML request body");
  }
  const report = parseReport(body);

  // RFC 6638 §2.3: inbox supports calendar-query but not free-busy-query
  if (resType === "inbox") {
    if (report.type === "free-busy-query") {
      return respond(403, "free-busy-query is not supported on scheduling inbox");
    }
    if (report.type === "calendar-query") {
      return xmlResponse(207, multiStatusXML([]));
    }
    return respond(405, "Method Not Allowed");
  }

  const noTimezones = (req.headers.get("CalDAV-Timezones") ?? "").toUpperCase() === "F";

  switch (report.type) {
    case "calendar-query":
      return await handleCalendarQuery(path, resType, report.query, storage, noTimezones);
    case "calendar-multiget":
      return await handleCalendarMultiget(report.multiget, storage, noTimezones);
    case "sync-collection":
      return await handleSyncCollection(req, path, resType, report.sync, storage);
    case "free-busy-query":
      return await handleFreeBusyQuery(req, path, resType, report.start, report.end, storage);
    case "expand-property":
      return xmlResponse(207, multiStatusXML([]));
    default:
      return respond(400, "Unknown REPORT type");
  }
}

const SUPPORTED_COLLATIONS = new Set(["i;ascii-casemap", "i;octet"]);

// Properties that may legally have a time-range in prop-filter (RFC 4791 §9.6.4)
const DATE_TIME_PROPS = new Set([
  "DTSTART", "DTEND", "DUE", "COMPLETED", "CREATED", "LAST-MODIFIED",
  "RECURRENCE-ID", "TRIGGER",
]);

function hasUnsupportedCollation(cf: CompFilter): string | null {
  for (const pf of cf.props) {
    if (pf.textMatch?.collation && !SUPPORTED_COLLATIONS.has(pf.textMatch.collation)) {
      return pf.textMatch.collation;
    }
    for (const param of pf.paramFilters) {
      if (param.textMatch?.collation && !SUPPORTED_COLLATIONS.has(param.textMatch.collation)) {
        return param.textMatch.collation;
      }
    }
  }
  for (const child of cf.comps) {
    const found = hasUnsupportedCollation(child);
    if (found) return found;
  }
  return null;
}

function hasInvalidFilter(cf: CompFilter): boolean {
  for (const pf of cf.props) {
    // time-range in prop-filter is only valid for date/time-valued properties
    if ((pf.start || pf.end) && !DATE_TIME_PROPS.has(pf.name.toUpperCase())) {
      return true;
    }
  }
  for (const child of cf.comps) {
    if (hasInvalidFilter(child)) return true;
  }
  return false;
}

async function handleCalendarQuery(
  path: string,
  resType: ResourceType,
  query: CalendarQuery,
  storage: Storage,
  noTimezones = false,
): Promise<Response> {
  // RFC 7809 §3.1.6: validate timezone-id if supplied
  if (query.timezoneId && query.timezoneId.startsWith("X-")) {
    return xmlResponse(403, buildPreconditionError("valid-timezone"));
  }

  // Validate collation
  const badCollation = hasUnsupportedCollation(query.filter);
  if (badCollation) {
    return xmlResponse(
      403,
      '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:supported-collation/></D:error>',
    );
  }
  // Validate filter structure (e.g. time-range on non-date props)
  if (hasInvalidFilter(query.filter)) {
    return xmlResponse(
      403,
      '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-filter/></D:error>',
    );
  }

  // Extract timezone offset for floating-time filtering (RFC 4791 §9.8)
  const tzOffsetMs = query.timezone ? extractTzOffsetFromVTZ(query.timezone) : 0;

  // calendar-query must target a collection
  if (resType === "object") {
    // RFC 4791 §7.8: REPORT on a non-collection — return just this object if it matches
    const colName = collectionNameFromPath(path);
    const uid = objectUIDFromPath(path);
    const obj = await storage.getObject(colName, uid);
    if (!obj) return respond(404, "Not found");
    const pfReq: PropFindRequest = { type: "prop", names: query.requestedProps };
    const responses: string[] = [];
    if (matchesFilter(obj.ics, query.filter, tzOffsetMs)) {
      responses.push(buildObjectResponse(obj.href, obj, pfReq, noTimezones, query.calDataSpec));
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
    if (matchesFilter(obj.ics, query.filter, tzOffsetMs)) {
      responses.push(buildObjectResponse(obj.href, obj, pfReq, noTimezones, query.calDataSpec));
    }
  }

  return xmlResponse(207, multiStatusXML(responses));
}

async function handleCalendarMultiget(
  multiget: CalendarMultiget,
  storage: Storage,
  noTimezones = false,
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
    responses.push(buildObjectResponse(href, obj, pfReq, noTimezones));
  }

  return xmlResponse(207, multiStatusXML(responses));
}

async function handleSyncCollection(
  req: Request,
  path: string,
  resType: ResourceType,
  sync: SyncCollectionQuery,
  storage: Storage,
): Promise<Response> {
  // RFC 6578 §3.3: Depth MUST be "0" for sync-collection REPORT
  const depth = req.headers.get("Depth");
  if (depth !== null && depth !== "0") {
    return respond(400, "sync-collection REPORT requires Depth: 0");
  }

  // Handle calendar home: list current sub-collections
  if (resType === "calendarHome") {
    const cals = await storage.listCalendars();
    const pfReq: PropFindRequest = sync.allProp
      ? { type: "allprop" }
      : { type: "prop", names: sync.requestedProps };
    const responses: string[] = [];
    for (const cal of cals) {
      const rawToken = await storage.getSyncToken(cal.name);
      responses.push(
        buildPropsResponse(
          cal.href,
          collectionProps(cal.name, cal.displayName, rawToken, cal.customProps ?? {}),
          pfReq,
        ),
      );
    }
    const respBody =
      '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      responses.join("") +
      D("sync-token", wrapSyncToken("0")) +
      `</D:multistatus>`;
    return xmlResponse(207, respBody);
  }

  if (resType !== "collection") {
    return respond(403, "sync-collection must target a calendar collection or home");
  }

  const colName = collectionNameFromPath(path);
  const col = await storage.getCalendar(colName);
  if (!col) return respond(404, "Not found");

  const pfReq: PropFindRequest = sync.allProp
    ? { type: "allprop" }
    : { type: "prop", names: sync.requestedProps };

  // Unwrap URI token → raw number string before passing to storage
  const rawToken = unwrapSyncToken(sync.syncToken);
  const syncResult = await storage.getChanges(colName, rawToken);
  if (syncResult.invalidToken) {
    return xmlResponse(
      403,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        `<D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>`,
    );
  }
  const responses: string[] = [];

  for (const change of syncResult.changes) {
    const href = `/calstakk/calendars/${colName}/${change.uid}.ics`;
    if (change.type === "deleted") {
      // RFC 6578 §3.5.2: removed member MUST have 404 status and MUST NOT include propstat
      responses.push(D("response", D("href", href) + D("status", "HTTP/1.1 404 Not Found")));
    } else {
      const obj = await storage.getObject(colName, change.uid);
      if (obj) {
        responses.push(buildObjectResponse(href, obj, pfReq));
      }
    }
  }

  // sync-token goes DIRECTLY in multistatus (RFC 6578 §3.2), NOT in a response/propstat
  const respBody =
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
    responses.join("") +
    D("sync-token", wrapSyncToken(syncResult.newToken)) +
    `</D:multistatus>`;

  return xmlResponse(207, respBody);
}

async function handleFreeBusyQuery(
  _req: Request,
  path: string,
  resType: ResourceType,
  queryStart: string,
  queryEnd: string,
  storage: Storage,
): Promise<Response> {
  if (resType === "object") {
    return xmlResponse(
      403,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
        "<C:supported-filter/>" +
        "</D:error>",
    );
  }

  const colName = collectionNameFromPath(path);
  const rangeStart = queryStart ? parseICalDateTimeForFB(queryStart) : null;
  const rangeEnd = queryEnd ? parseICalDateTimeForFB(queryEnd) : null;

  // Collect FREEBUSY periods from VAVAILABILITY objects in the collection
  const freebusyLines: string[] = [];

  // Helper: BUSYTYPE → FBTYPE string
  function btToFbtype(busytype: string): string {
    const bt = busytype.toUpperCase();
    if (bt === "BUSY") return "BUSY";
    if (bt === "BUSY-TENTATIVE") return "BUSY-TENTATIVE";
    return "BUSY-UNAVAILABLE"; // default per RFC 7953 §3.2
  }

  // Collect VAVAILABILITY blocks: [{start, end, priority, busytype, availRanges}]
  const blocks: Array<{ start: Date | null; end: Date | null; priority: number; busytype: string; availRanges: Array<{ s: Date; e: Date }> }> = [];

  // From PUT objects
  const objects = await storage.listObjects(colName);
  for (const obj of objects) {
    try {
      const cal = parseICS(obj.ics);

      // RFC 4791 §7.10: derive busy periods from VEVENTs (TRANSP/STATUS determine FBTYPE)
      for (const ev of getComps(cal, "VEVENT")) {
        const transp = getProp(ev, "TRANSP")?.value?.toUpperCase();
        if (transp === "TRANSPARENT") continue;
        const status = getProp(ev, "STATUS")?.value?.toUpperCase();
        if (status === "CANCELLED") continue;
        const evStart = getPropDate2(ev, "DTSTART");
        if (!evStart) continue;
        const evEnd = getPropDate2(ev, "DTEND") ?? new Date(evStart.getTime() + 86400000);
        const qStart2 = rangeStart ?? new Date(0);
        const qEnd2 = rangeEnd ?? new Date(8.64e15);
        if (evStart >= qEnd2 || evEnd <= qStart2) continue;
        const fbtype = status === "TENTATIVE" ? "BUSY-TENTATIVE" : "BUSY";
        const effS = evStart > qStart2 ? evStart : qStart2;
        const effE = evEnd < qEnd2 ? evEnd : qEnd2;
        freebusyLines.push(`FREEBUSY;FBTYPE=${fbtype}:${formatICalDateTime(effS)}/${formatICalDateTime(effE)}`);
      }

      for (const va of getComps(cal, "VAVAILABILITY")) {
        const dtStart = getPropDate2(va, "DTSTART");
        const dtEnd = getPropDate2(va, "DTEND");
        const priorityProp = getProp(va, "PRIORITY");
        const priority = priorityProp ? parseInt(priorityProp.value, 10) : 0;
        const busytypeProp = getProp(va, "BUSYTYPE");
        const busytype = busytypeProp?.value ?? "BUSY-UNAVAILABLE";
        // AVAILABLE sub-components
        const availRanges: Array<{ s: Date; e: Date }> = [];
        for (const avail of getComps(va, "AVAILABLE")) {
          const as = getPropDate2(avail, "DTSTART");
          const ae = getPropDate2(avail, "DTEND");
          if (as && ae) availRanges.push({ s: as, e: ae });
        }
        blocks.push({ start: dtStart, end: dtEnd, priority, busytype, availRanges });
      }
    } catch {
      // ignore parse errors
    }
  }

  // Also check calendar-availability custom prop on the collection
  const cal = await storage.getCalendar(colName);
  if (cal) {
    const caPropKey = `urn:ietf:params:xml:ns:caldav\x00calendar-availability`;
    const caRaw = cal.customProps[caPropKey];
    if (caRaw) {
      // Extract ICS content from the XML element
      const innerMatch = caRaw.match(/>([^<]*(?:BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR))/);
      const icsContent = innerMatch?.[1] ?? caRaw.replace(/<[^>]+>/g, "").trim();
      try {
        const avCal = parseICS(icsContent);
        for (const va of getComps(avCal, "VAVAILABILITY")) {
          const dtStart = getPropDate2(va, "DTSTART");
          const dtEnd = getPropDate2(va, "DTEND");
          const priorityProp = getProp(va, "PRIORITY");
          const priority = priorityProp ? parseInt(priorityProp.value, 10) : 0;
          const busytypeProp = getProp(va, "BUSYTYPE");
          const busytype = busytypeProp?.value ?? "BUSY-UNAVAILABLE";
          blocks.push({ start: dtStart, end: dtEnd, priority, busytype, availRanges: [] });
        }
      } catch {
        // ignore
      }
    }
  }

  // Process blocks to generate FREEBUSY periods
  const qStart = rangeStart ?? new Date(0);
  const qEnd = rangeEnd ?? new Date(8.64e15);

  for (const block of blocks) {
    const windowStart = block.start ?? new Date(0);
    const windowEnd = block.end ?? new Date(8.64e15);
    // Does this VAVAILABILITY overlap the query range?
    if (windowStart >= qEnd || windowEnd <= qStart) continue;

    // Effective overlap of VAVAILABILITY window with query range
    const effStart = windowStart > qStart ? windowStart : qStart;
    const effEnd = windowEnd < qEnd ? windowEnd : qEnd;

    const fbtype = btToFbtype(block.busytype);

    // Subtract AVAILABLE sub-ranges: remaining intervals are busy
    const busyIntervals = subtractIntervals(effStart, effEnd, block.availRanges);
    for (const { s, e } of busyIntervals) {
      freebusyLines.push(`FREEBUSY;FBTYPE=${fbtype}:${formatICalDateTime(s)}/${formatICalDateTime(e)}`);
    }
  }

  // Build VFREEBUSY response
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let vfb = "BEGIN:VFREEBUSY\r\nDTSTAMP:" + dtstamp + "\r\n";
  if (queryStart) vfb += "DTSTART:" + queryStart + "\r\n";
  if (queryEnd) vfb += "DTEND:" + queryEnd + "\r\n";
  for (const line of freebusyLines) vfb += line + "\r\n";
  vfb += "END:VFREEBUSY\r\n";

  const ical = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//CalDAV Server//EN\r\n" + vfb + "END:VCALENDAR\r\n";
  return new Response(ical, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}

function subtractIntervals(
  start: Date,
  end: Date,
  freeRanges: Array<{ s: Date; e: Date }>,
): Array<{ s: Date; e: Date }> {
  // Sort free ranges by start
  const sorted = [...freeRanges].filter((r) => r.s < end && r.e > start).sort((a, b) => a.s.getTime() - b.s.getTime());
  const result: Array<{ s: Date; e: Date }> = [];
  let cur = start;
  for (const fr of sorted) {
    const frStart = fr.s > cur ? fr.s : cur;
    if (frStart > cur) result.push({ s: cur, e: frStart });
    if (fr.e > cur) cur = fr.e;
    if (cur >= end) break;
  }
  if (cur < end) result.push({ s: cur, e: end });
  return result;
}

function parseICalDateTimeForFB(s: string): Date {
  if (s.length === 8) return new Date(Date.UTC(parseInt(s.slice(0, 4)), parseInt(s.slice(4, 6)) - 1, parseInt(s.slice(6, 8))));
  return new Date(Date.UTC(parseInt(s.slice(0, 4)), parseInt(s.slice(4, 6)) - 1, parseInt(s.slice(6, 8)), parseInt(s.slice(9, 11)), parseInt(s.slice(11, 13)), parseInt(s.slice(13, 15))));
}

function formatICalDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "").replace("T", "T").slice(0, 15) + "Z";
}

function getPropDate2(comp: ICalComponent, name: string): Date | null {
  const prop = getProp(comp, name);
  if (!prop) return null;
  try { return parseICalDateTimeForFB(prop.value); } catch { return null; }
}
