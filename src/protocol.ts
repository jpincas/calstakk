// CalDAV / WebDAV HTTP handler.
// Routes requests to the appropriate handler based on method and path.

import {
  calendarHomePath,
  collectionPath,
  DEFAULT_CALENDAR_NAME,
  HTTPError,
  inboxPath,
  objectPath,
  outboxPath,
  ParsedPath,
  parsePath,
  principalPath,
  User,
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
import { hashPassword, parseBasicAuth, verifyPassword } from "./auth.ts";

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

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

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

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CalStakk"' },
  });
}

const DAV_HEADER = "1, calendar-access, calendar-availability, calendar-no-timezone, calendar-managed-attachments, calendar-managed-attachments-no-recurrence, calendar-auto-schedule";
const ALLOW_HEADER =
  "OPTIONS, GET, HEAD, PUT, POST, DELETE, PROPFIND, PROPPATCH, MKCOL, MKCALENDAR, REPORT";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authenticate(req: Request, storage: Storage, config: Config): Promise<User | Response> {
  // Bootstrap owner on first request if not yet in storage.
  const ownerInStore = await storage.getUser(config.user.username);
  if (!ownerInStore) {
    await storage.createUser({
      username: config.user.username,
      passwordHash: config.user.password ? await hashPassword(config.user.password) : "",
      displayName: config.user.displayName,
      email: config.user.email,
      timezone: config.user.timezone,
      isAdmin: true,
    });
  }

  // No password configured — auth disabled, treat every request as the owner.
  if (!config.user.password) {
    return (await storage.getUser(config.user.username))!;
  }

  const creds = parseBasicAuth(req.headers.get("Authorization"));
  if (!creds) return unauthorized();

  const user = await storage.getUser(creds.username);
  if (!user) return unauthorized();

  const valid = await verifyPassword(creds.password, user.passwordHash);
  if (!valid) return unauthorized();

  return user;
}

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
  const parsed = parsePath(path);

  // Well-known redirect — RFC 6764 §5: absolute URI, no auth required.
  // Redirect to the configured owner's principal so unauthenticated discovery works.
  if (parsed.type === "wellknown") {
    const ownerPrincipal = principalPath(config.user.username);
    return respond(308, "", { Location: `${url.origin}${ownerPrincipal}`, "Cache-Control": "no-cache" });
  }

  // OPTIONS never requires auth
  if (method === "OPTIONS") return handleOptions();

  // All other requests require authentication
  const authResult = await authenticate(req, storage, config);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  switch (method) {
    case "GET":   return await handleGet(req, path, parsed, user, storage);
    case "HEAD":  return await handleHead(path, parsed, user, storage);
    case "PUT":   return await handlePut(req, path, parsed, user, storage);
    case "DELETE": return await handleDelete(path, parsed, user, storage);
    case "PROPFIND": return await handlePropfind(req, path, parsed, user, storage, config);
    case "PROPPATCH": return await handleProppatch(req, path, parsed, user, storage);
    case "MKCOL": return await handleMkcol(req, path, parsed, user, storage, false);
    case "MKCALENDAR": return await handleMkcol(req, path, parsed, user, storage, true);
    case "REPORT": return await handleReport(req, path, parsed, user, storage);
    case "COPY":  return await handleCopy(req, path, parsed, user, storage);
    case "MOVE":  return await handleMove(req, path, parsed, user, storage);
    case "POST":  return await handlePost(req, path, parsed, user, storage);
    default: return respond(405, "Method not allowed", { Allow: ALLOW_HEADER });
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

// ─── Path ownership check ─────────────────────────────────────────────────────

/** Returns 403 if the authenticated user doesn't own the target path username. */
function checkOwnership(parsed: ParsedPath, user: User): Response | null {
  if (!parsed.username) return null; // root-level path, no ownership check
  if (parsed.username === user.username || user.isAdmin) return null;
  return respond(403, "Forbidden: you do not own this resource");
}

// ─── GET / HEAD ───────────────────────────────────────────────────────────────

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

async function handleGet(req: Request, _path: string, parsed: ParsedPath, user: User, storage: Storage): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  if (parsed.type !== "object") return respond(405, "Method not allowed");

  const obj = await storage.getObject(parsed.username, parsed.collection, parsed.uid);
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

async function handleHead(_path: string, parsed: ParsedPath, user: User, storage: Storage): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  if (parsed.type !== "object") return respond(405, "Method not allowed");

  const obj = await storage.getObject(parsed.username, parsed.collection, parsed.uid);
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
  _path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  if (parsed.type !== "object") return respond(405, "Method not allowed");

  const ct = req.headers.get("Content-Type") ?? "";
  const mimeType = ct.split(";")[0].trim().toLowerCase();
  if (mimeType !== "text/calendar") {
    return respond(415, "Unsupported Media Type: expected text/calendar");
  }

  const ics = await req.text();

  let cal;
  try {
    cal = parseICS(ics);
  } catch {
    return respond(400, "Invalid iCalendar data");
  }

  const validErr = validateCalendarObject(cal);
  if (validErr) {
    if (validErr.precondition) {
      return xmlResponse(validErr.code, buildPreconditionError(validErr.precondition));
    }
    return respond(validErr.code, validErr.message);
  }

  const icalUID = extractUID(cal);
  const { username, collection: colName, uid } = parsed;

  const col = await storage.getCalendar(username, colName);
  if (!col) return respond(409, `Calendar collection not found: ${colName}`);

  // ETag preconditions
  const ifNoneMatch = req.headers.get("If-None-Match");
  const ifMatch = req.headers.get("If-Match");
  const existing = await storage.getObject(username, colName, uid);

  if (ifNoneMatch === "*" && existing) return respond(412, "Precondition Failed: resource already exists");
  if (ifMatch && ifMatch !== "*") {
    if (!existing) return respond(412, "Precondition Failed: resource does not exist");
    if (existing.etag !== ifMatch) return respond(412, "Precondition Failed: ETag mismatch");
  }

  // WebDAV If header check
  const ifHeader = req.headers.get("If");
  if (ifHeader) {
    const stateTokenMatch = ifHeader.match(/<([^>]+)>\s*\(<([^>]+)>\)/);
    if (stateTokenMatch) {
      const tokenUri = stateTokenMatch[2];
      if (tokenUri.startsWith(SYNC_TOKEN_PREFIX)) {
        const ifPath = stateTokenMatch[1];
        let ifColName: string;
        try {
          ifColName = parsePath(new URL(ifPath).pathname).collection;
        } catch {
          ifColName = parsePath(ifPath).collection;
        }
        const currentToken = wrapSyncToken(await storage.getSyncToken(username, ifColName));
        if (tokenUri !== currentToken) return respond(412, "Precondition Failed: stale sync-token");
      }
    }
    const etagMatch = ifHeader.match(/\["([^"]+)"\]/);
    if (etagMatch) {
      const expectedETag = `"${etagMatch[1]}"`;
      const obj2 = await storage.getObject(username, colName, uid);
      if (!obj2 || obj2.etag !== expectedETag) {
        return respond(412, "Precondition Failed: If header condition not met");
      }
    }
  }

  // UID conflict check
  const existingUID = await storage.findObjectByICalUID(username, colName, icalUID);
  if (existingUID && existingUID !== uid) {
    return xmlResponse(409, buildPreconditionError("no-uid-conflict"));
  }

  // RFC 8607 §3.4: ATTACH;MANAGED-ID= must be server-assigned
  for (const comp of [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")]) {
    for (const attach of getProps(comp, "ATTACH")) {
      if (attach.params["MANAGED-ID"]) {
        return xmlResponse(403, buildPreconditionError("valid-managed-id-parameter"));
      }
    }
  }

  // SEQUENCE check
  if (existing) {
    const newComponents = [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")];
    const newSeq = newComponents.length > 0 ? parseInt(getProp(newComponents[0], "SEQUENCE")?.value ?? "0", 10) : 0;
    try {
      const storedCal = parseICS(existing.ics);
      const storedComponents = [...getComps(storedCal, "VEVENT"), ...getComps(storedCal, "VTODO")];
      const storedSeq = storedComponents.length > 0 ? parseInt(getProp(storedComponents[0], "SEQUENCE")?.value ?? "0", 10) : 0;
      if (newSeq < storedSeq) return respond(412, "Precondition Failed: SEQUENCE is lower than stored object");
    } catch { /* ignore */ }
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
    const globalMatch = await storage.findObjectByICalUIDGlobal(username, icalUID);
    if (globalMatch && globalMatch.calendarName !== colName) {
      return xmlResponse(403, buildPreconditionError("unique-scheduling-object-resource"));
    }

    // §11.2 item 5: ORGANIZER cannot change on an existing scheduling object
    if (existing && isSchedulingObject(existing.ics)) {
      const existingOrg = extractOrganizerEmail(existing.ics);
      const newOrg = extractOrganizerEmail(ics);
      if (existingOrg && newOrg && existingOrg !== newOrg) {
        return xmlResponse(403, buildPreconditionError("same-organizer-in-all-components"));
      }
    }

    const organizerEmail = extractOrganizerEmail(ics);
    const userEmail = user.email.toLowerCase();
    const isOrganizer = organizerEmail ? organizerEmail === userEmail : false;
    const isAttendee = !isOrganizer && extractAttendeeEmails(ics).some((e) => e === userEmail);

    // §11.2 item 4: ORGANIZER must match authenticated user's calendar-user-address-set
    // Only enforce when: (a) user has an email, (b) the event has an ORGANIZER
    // New resource PUT with mismatched ORGANIZER → 403
    if (organizerEmail && user.email && !isOrganizer && !isAttendee) {
      // Caller is neither organizer nor attendee — reject if creating new resource with ORGANIZER
      if (!existing) {
        return xmlResponse(403, buildPreconditionError("valid-organizer"));
      }
    }

    // §3.2.4.3: Organizer cannot set another attendee's PARTSTAT to non-NEEDS-ACTION
    if (isOrganizer && existing && isSchedulingObject(existing.ics)) {
      const forbiddenErr = checkOrganizerPARTSTAT(existing.ics, ics);
      if (forbiddenErr) return xmlResponse(403, buildPreconditionError(forbiddenErr));
    }

    // §3.2.2.1: Attendee can only change their own PARTSTAT
    if (isAttendee && existing && isSchedulingObject(existing.ics)) {
      const forbiddenErr = checkAttendeeForbiddenChange(existing.ics, ics, userEmail);
      if (forbiddenErr) return xmlResponse(403, buildPreconditionError(forbiddenErr));
    }

    // §8.3: If-Schedule-Tag-Match conditional header
    const ifSchedTagMatch = req.headers.get("If-Schedule-Tag-Match");
    if (ifSchedTagMatch && existing) {
      const storedTag = getScheduleTag(existing.deadProps ?? {});
      if (!storedTag || ifSchedTagMatch !== storedTag) {
        return respond(412, "Precondition Failed: If-Schedule-Tag-Match mismatch");
      }
    }

    // §3.2.1.2: If DTSTART changed, reset all ATTENDEE PARTSTAT to NEEDS-ACTION
    let resetPartstat = false;
    if (existing) {
      const oldDTSTART = extractDTSTART(existing.ics);
      const newDTSTART = extractDTSTART(ics);
      if (oldDTSTART && newDTSTART && oldDTSTART !== newDTSTART) resetPartstat = true;
    }

    // §3.2.2.3: Attendee reply — update SCHEDULE-STATUS on organizer's copy
    if (isAttendee && existing && organizerEmail) {
      const orgUser = await storage.getUserByEmail(organizerEmail);
      if (orgUser) {
        const orgMatch = await storage.findObjectByICalUIDGlobal(orgUser.username, icalUID);
        if (orgMatch) {
          const orgObj = await storage.getObject(orgUser.username, orgMatch.calendarName, orgMatch.uid);
          if (orgObj) {
            const updatedOrgIcs = updateOrganizerScheduleStatus(orgObj.ics, userEmail, ics);
            await storage.putObject(orgUser.username, orgMatch.calendarName, orgMatch.uid, updatedOrgIcs, icalUID);
          }
        }
      }
    }

    // Mutate ICS: strip SCHEDULE-FORCE-SEND, add SCHEDULE-STATUS, reset PARTSTAT if needed
    storedIcs = mutateSchedulingICS(ics, {
      stripForceSend: true,
      addScheduleStatus: !isAttendee, // don't add SCHEDULE-STATUS on attendee's copy
      resetPartstat,
    });

    // §3.2.10: Compute scheduling hash to determine if schedule-tag should change
    const newHash = await hashSchedulingContent(storedIcs);
    const oldHash = existing ? getSchedulingHash(existing.deadProps ?? {}) : null;
    const existingTag = existing ? getScheduleTag(existing.deadProps ?? {}) : null;
    schedTag = (existingTag && oldHash === newHash) ? existingTag : `"${crypto.randomUUID()}"`;
  }

  const obj = await storage.putObject(username, colName, uid, storedIcs, icalUID);

  if (isSchedObj && schedTag) {
    await storage.updateObjectProp(username, colName, uid, "urn:ietf:params:xml:ns:caldav\x00schedule-tag", scheduleTagXml(schedTag));
    await storage.updateObjectProp(username, colName, uid, "urn:calstakk:internal\x00scheduling-hash", await hashSchedulingContent(storedIcs));
  }

  // §4.1: Deliver REQUEST iTIP to local attendees' inboxes (organizer PUT of new/updated event)
  if (isSchedObj) {
    const organizerEmail = extractOrganizerEmail(ics);
    const userEmail = user.email.toLowerCase();
    const isOrganizer = organizerEmail ? organizerEmail === userEmail : false;
    if (isOrganizer || !organizerEmail) {
      await deliverRequestToAttendees(ics, user, storage);
    }
    // §4.2: Attendee reply — write REPLY to organizer's inbox
    const isAttendee = !isOrganizer && organizerEmail &&
      extractAttendeeEmails(ics).some((e) => e === userEmail);
    if (isAttendee && organizerEmail) {
      await deliverReplyToOrganizer(ics, user, organizerEmail, storage);
    }
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
  _path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  if (parsed.type === "object") {
    const { username, collection: colName, uid } = parsed;
    const obj = await storage.getObject(username, colName, uid);
    if (!obj) return respond(404, "Not found");

    // §3.2.1.3: Deliver CANCEL iTIP to local attendees before deletion
    if (isSchedulingObject(obj.ics)) {
      const organizerEmail = extractOrganizerEmail(obj.ics);
      if (organizerEmail === user.email.toLowerCase()) {
        await deliverCancelToAttendees(obj.ics, user, storage);
      }
    }

    try {
      await storage.deleteObject(username, colName, uid);
    } catch {
      return respond(404, "Not found");
    }
    return respond(204);
  }

  if (parsed.type === "collection") {
    const { username, collection: colName } = parsed;
    const defaultCalPath = collectionPath(username, DEFAULT_CALENDAR_NAME);
    if (collectionPath(username, colName) === defaultCalPath) {
      return xmlResponse(403, buildPreconditionError("default-calendar-needed"));
    }
    const col = await storage.getCalendar(username, colName);
    if (!col) return respond(404, "Not found");
    await storage.deleteCalendar(username, colName);
    return respond(204);
  }

  return respond(403, "Cannot delete this resource");
}

// ─── PROPFIND ─────────────────────────────────────────────────────────────────

async function handlePropfind(
  req: Request,
  path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
  config: Config,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const depth = parseDepth(req.headers.get("Depth"));
  const body = await req.text();
  if (body.trim() && !isWellFormedXML(body)) {
    return respond(400, "Malformed XML request body");
  }
  const pfReq = parsePropfind(body);
  const responses: string[] = [];

  switch (parsed.type) {
    case "root":
    case "principals": {
      // Root or /principals/ — return current user's principal
      const pp = principalPath(user.username);
      responses.push(buildPrincipalResponse(pp, user, pfReq));
      if (depth !== "0") {
        const chp = calendarHomePath(user.username);
        responses.push(buildCalendarHomeResponse(chp, pfReq));
      }
      break;
    }

    case "principal": {
      // /principals/<username> — return that user's principal props
      const targetUser = await storage.getUser(parsed.username);
      if (!targetUser) return respond(404, "Not found");
      responses.push(buildPrincipalResponse(path, targetUser, pfReq));
      if (depth !== "0") {
        const chp = calendarHomePath(parsed.username);
        responses.push(buildCalendarHomeResponse(chp, pfReq));
        if (depth === "infinity") {
          const cals = await storage.listCalendars(parsed.username);
          for (const cal of cals) {
            responses.push(buildCollectionResponse(cal.href, cal, pfReq, "0", config));
          }
        }
      }
      break;
    }

    case "calendarHome": {
      responses.push(buildCalendarHomeResponse(path, pfReq));
      if (depth !== "0") {
        const cals = await storage.listCalendars(parsed.username);
        for (const cal of cals) {
          responses.push(buildCollectionResponse(cal.href, cal, pfReq, "0", config));
          if (depth === "infinity") {
            const objs = await storage.listObjects(parsed.username, cal.name);
            for (const obj of objs) {
              responses.push(buildObjectResponse(obj.href, obj, pfReq));
            }
          }
        }
      }
      break;
    }

    case "collection": {
      const { username, collection: colName } = parsed;
      const col = await storage.getCalendar(username, colName);
      if (!col) return respond(404, "Not found");
      const syncToken = await storage.getSyncToken(username, colName);
      responses.push(buildCollectionResponse(path, col, pfReq, syncToken, config));
      if (depth !== "0") {
        const objs = await storage.listObjects(username, colName);
        for (const obj of objs) {
          responses.push(buildObjectResponse(obj.href, obj, pfReq));
        }
      }
      break;
    }

    case "object": {
      const { username, collection: colName, uid } = parsed;
      const obj = await storage.getObject(username, colName, uid);
      if (!obj) return respond(404, "Not found");
      responses.push(buildObjectResponse(path, obj, pfReq));
      break;
    }

    case "inbox": {
      const { username } = parsed;
      const ip = inboxPath(username);
      const defaultCalPath = collectionPath(username, DEFAULT_CALENDAR_NAME);
      responses.push(buildPropsResponse(ip, inboxProps(username, defaultCalPath), pfReq));
      if (depth !== "0") {
        const items = await storage.listInboxItems(username);
        for (const item of items) {
          responses.push(buildInboxItemResponse(item.href, item, pfReq));
        }
      }
      break;
    }

    case "outbox": {
      const { username } = parsed;
      responses.push(buildPropsResponse(outboxPath(username), outboxProps(username), pfReq));
      break;
    }

    default:
      return respond(404, "Not found");
  }

  const extraHeaders: Record<string, string> = {};
  if (parsed.type === "collection" && !path.endsWith("/")) {
    extraHeaders["Content-Location"] = path + "/";
  }
  return xmlResponse(207, multiStatusXML(responses), extraHeaders);
}

function parseDepth(header: string | null): "0" | "1" | "infinity" {
  if (header === "0") return "0";
  if (header === "infinity") return "infinity";
  return "1";
}

// ─── Property maps ────────────────────────────────────────────────────────────

type PropMap = Map<string, string>;

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

function principalProps(user: User): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(user.username);
  const chp = calendarHomePath(user.username);
  const ip = inboxPath(user.username);
  const op = outboxPath(user.username);
  const defaultCal = collectionPath(user.username, DEFAULT_CALENDAR_NAME);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + D("principal")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", esc(user.displayName)));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-home-set"), C("calendar-home-set", D("href", chp)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  if (user.email) {
    const addr = user.email.startsWith("mailto:") ? user.email : `mailto:${user.email}`;
    m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-user-address-set"),
      C("calendar-user-address-set", D("href", addr)));
  }
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "schedule-inbox-URL"),
    C("schedule-inbox-URL", D("href", ip)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "schedule-outbox-URL"),
    C("schedule-outbox-URL", D("href", op)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "schedule-default-calendar-URL"),
    C("schedule-default-calendar-URL", D("href", defaultCal)));
  m.set(makeKey("DAV:", "supported-privilege-set"), D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
    D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
    D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
    D("supported-privilege", D("privilege", C("read-free-busy")) + D("description", "Read free/busy")),
  ));
  return m;
}

function inboxPrivilegeSet(): string {
  const sub = (priv: string) =>
    D("supported-privilege", D("privilege", C(priv), { name: priv }) + D("description", priv));
  return D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
    D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
    D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
    D("supported-privilege",
      D("privilege", C("schedule-deliver"), { name: "schedule-deliver" }) +
      D("description", "Scheduling deliveries") +
      sub("schedule-deliver-invite") +
      sub("schedule-deliver-reply") +
      sub("schedule-query-freebusy"),
    ),
  );
}

function outboxPrivilegeSet(): string {
  const sub = (priv: string) =>
    D("supported-privilege", D("privilege", C(priv), { name: priv }) + D("description", priv));
  return D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
    D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
    D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
    D("supported-privilege",
      D("privilege", C("schedule-send"), { name: "schedule-send" }) +
      D("description", "Scheduling sends") +
      sub("schedule-send-invite") +
      sub("schedule-send-reply") +
      sub("schedule-send-freebusy"),
    ),
  );
}

function inboxProps(username: string, defaultCalPath: string): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(username);
  const _ip = inboxPath(username);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + C("schedule-inbox")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Inbox"));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "schedule-default-calendar-URL"),
    C("schedule-default-calendar-URL", D("href", defaultCalPath)));
  m.set(makeKey("DAV:", "supported-privilege-set"), inboxPrivilegeSet());
  return m;
}

function outboxProps(username: string): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(username);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + C("schedule-outbox")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Outbox"));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
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

async function processSchedulingCalendar(
  ics: string,
  methodParam: string | null,
  user: User,
): Promise<string[] | Response> {
  let cal;
  try {
    cal = parseICS(ics);
  } catch {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  const calMethod = (getProp(cal, "METHOD")?.value ?? "").toUpperCase();
  if (!calMethod) return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));

  if (methodParam && methodParam.toUpperCase() !== calMethod) {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  if (calMethod === "REQUEST") {
    const vfreebusy = getComps(cal, "VFREEBUSY");
    if (vfreebusy.length > 0) {
      const fbComp = vfreebusy[0];
      const organizer = getProp(fbComp, "ORGANIZER");
      if (!organizer) return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));

      // §5.2.2: ORGANIZER must match authenticated user's calendar-user-address-set
      const orgEmail = organizer.value.replace(/^mailto:/i, "").toLowerCase();
      if (user.email && orgEmail !== user.email.toLowerCase()) {
        return xmlResponse(403, buildPreconditionError("valid-organizer"));
      }

      return getProps(fbComp, "ATTENDEE").map((a) => recipientXml(a.value));
    }
  }

  if (calMethod === "PUBLISH") return [];

  const allComps = [...getComps(cal, "VEVENT"), ...getComps(cal, "VTODO")];
  if (allComps.length === 0) return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
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

async function handleOutboxPost(req: Request, _parsed: ParsedPath, user: User): Promise<Response> {
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
      const result = await processSchedulingCalendar(p.ics, p.methodParam, user);
      if (Array.isArray(result)) allRecs.push(...result);
    }
    return xmlResponse(200, buildScheduleResponseXml(allRecs));
  }

  if (mediaType !== "text/calendar") {
    return respond(415, "Unsupported Media Type: expected text/calendar or multipart/mixed");
  }

  const methodParam = ctParams["method"] ?? null;

  if (methodParam && hasNonAscii(bodyText) && ctParams["charset"]?.toLowerCase() !== "utf-8") {
    return xmlResponse(400, buildPreconditionError("valid-scheduling-message"));
  }

  const result = await processSchedulingCalendar(bodyText, methodParam, user);
  if (result instanceof Response) return result;
  return xmlResponse(200, buildScheduleResponseXml(result));
}

function calendarHomeProps(syncToken: string): PropMap {
  const m = new Map<string, string>();
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", "Calendars"));
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", wrapSyncToken(syncToken)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  return m;
}

function collectionProps(
  username: string,
  name: string,
  displayName: string,
  syncToken: string,
  customProps: Record<string, string> = {},
  config?: Config,
): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(username);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype", D("collection") + C("calendar")));
  m.set(makeKey("DAV:", "displayname"), D("displayname", esc(displayName || name)));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
  m.set(makeKey("DAV:", "sync-token"), D("sync-token", wrapSyncToken(syncToken)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", new Date().toISOString()));
  m.set(makeKey("DAV:", "supported-report-set"), D(
    "supported-report-set",
    D("supported-report", D("report", C("calendar-query"))) +
    D("supported-report", D("report", C("calendar-multiget"))) +
    D("supported-report", D("report", C("free-busy-query"))) +
    D("supported-report", D("report", D("sync-collection"))) +
    D("supported-report", D("report", D("expand-property"))),
  ));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "supported-collation-set"), C(
    "supported-collation-set",
    C("supported-collation", "i;ascii-casemap") + C("supported-collation", "i;octet"),
  ));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-description"), C("calendar-description"));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-data"), C(
    "supported-calendar-data",
    Cattr("calendar-data", { "content-type": "text/calendar", version: "2.0" }),
  ));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "supported-calendar-component-set"), C(
    "supported-calendar-component-set",
    Cattr("comp", { name: "VEVENT" }) + Cattr("comp", { name: "VTODO" }) + Cattr("comp", { name: "VAVAILABILITY" }),
  ));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "max-resource-size"), C("max-resource-size", "10485760"));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "min-date-time"), C("min-date-time", "19700101T000000Z"));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "max-date-time"), C("max-date-time", "20991231T235959Z"));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "max-instances"), C("max-instances", "3000"));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "max-attendees-per-instance"), C("max-attendees-per-instance", "100"));
  const defaultTzId = config?.user.timezone ?? "UTC";
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone-id"), C("calendar-timezone-id", defaultTzId));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-timezone"), C(
    "calendar-timezone",
    escapeXmlCDATA(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:${defaultTzId}\r\nEND:VTIMEZONE\r\nEND:VCALENDAR\r\n`),
  ));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "schedule-calendar-transp"), C("schedule-calendar-transp", C("opaque")));
  m.set(makeKey("DAV:", "supported-privilege-set"), D(
    "supported-privilege-set",
    D("supported-privilege", D("privilege", D("all")) + D("description", "All privileges")) +
    D("supported-privilege", D("privilege", D("read")) + D("description", "Read")) +
    D("supported-privilege", D("privilege", D("write")) + D("description", "Write")) +
    D("supported-privilege", D("privilege", C("read-free-busy")) + D("description", "Read free/busy")),
  ));

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

function extractOrganizerEmail(ics: string): string {
  const m = ics.match(/^ORGANIZER[;:][^\r\n]+/m);
  if (!m) return "";
  const val = m[0].replace(/^ORGANIZER[;:]?/i, "").replace(/^.*:/, "").trim();
  return val.replace(/^mailto:/i, "").toLowerCase();
}

function extractAttendeeEmails(ics: string): string[] {
  const emails: string[] = [];
  const lines = ics.split(/\r?\n/);
  for (const line of lines) {
    if (/^ATTENDEE[;:]/i.test(line)) {
      // Skip SCHEDULE-AGENT=CLIENT or SCHEDULE-AGENT=NONE
      if (/SCHEDULE-AGENT=(CLIENT|NONE)/i.test(line)) continue;
      const val = line.replace(/^ATTENDEE[^:]*:/i, "").trim();
      const email = val.replace(/^mailto:/i, "").toLowerCase();
      if (email) emails.push(email);
    }
  }
  return emails;
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
      if (opts.stripForceSend) l = l.replace(/;SCHEDULE-FORCE-SEND=[^;:]+/gi, "");
      if (opts.addScheduleStatus && !l.includes("SCHEDULE-STATUS")) {
        const isClientAgent = /SCHEDULE-AGENT=CLIENT/i.test(l);
        const isNoneAgent = /SCHEDULE-AGENT=NONE/i.test(l);
        if (!isClientAgent && !isNoneAgent) {
          const colonIdx = l.indexOf(":");
          if (colonIdx >= 0) l = l.slice(0, colonIdx) + ";SCHEDULE-STATUS=1.2" + l.slice(colonIdx);
        }
      }
      if (opts.resetPartstat) l = l.replace(/PARTSTAT=[^;:]+/i, "PARTSTAT=NEEDS-ACTION");
      result.push(foldLine(l, eol));
    } else {
      result.push(line);
    }
  }
  return result.join(eol);
}

async function hashSchedulingContent(ics: string): Promise<string> {
  const { lines } = unfoldLines(ics);
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

function getScheduleTag(deadProps: Record<string, string>): string | null {
  const xml = deadProps["urn:ietf:params:xml:ns:caldav\x00schedule-tag"];
  if (!xml) return null;
  const m = xml.match(/>([^<]+)</);
  return m?.[1]?.trim() ?? null;
}

function getSchedulingHash(deadProps: Record<string, string>): string | null {
  return deadProps["urn:calstakk:internal\x00scheduling-hash"] ?? null;
}

function scheduleTagXml(tag: string): string {
  return `<C:schedule-tag xmlns:C="urn:ietf:params:xml:ns:caldav">${escapeXmlCDATA(tag)}</C:schedule-tag>`;
}

function extractDTSTART(ics: string): string | null {
  const m = ics.match(/^DTSTART[;:][^\r\n]+/m);
  return m?.[0] ?? null;
}

/** Check if organizer is setting an attendee's PARTSTAT to non-NEEDS-ACTION. */
function checkOrganizerPARTSTAT(oldIcs: string, newIcs: string): string | null {
  const { lines: oldLines } = unfoldLines(oldIcs);
  const { lines: newLines } = unfoldLines(newIcs);
  const oldAtts = new Map<string, string>(); // email → partstat
  for (const l of oldLines) {
    if (/^ATTENDEE[;:]/i.test(l)) {
      const email = l.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase();
      const ps = (l.match(/PARTSTAT=([^;:]+)/i)?.[1] ?? "NEEDS-ACTION").toUpperCase();
      oldAtts.set(email, ps);
    }
  }
  for (const l of newLines) {
    if (/^ATTENDEE[;:]/i.test(l)) {
      const email = l.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase();
      const ps = (l.match(/PARTSTAT=([^;:]+)/i)?.[1] ?? "NEEDS-ACTION").toUpperCase();
      const old = oldAtts.get(email) ?? "NEEDS-ACTION";
      if (ps !== "NEEDS-ACTION" && ps !== old) {
        return "allowed-organizer-scheduling-object-change";
      }
    }
  }
  return null;
}

/** Check if attendee is changing fields other than their own PARTSTAT. */
function checkAttendeeForbiddenChange(oldIcs: string, newIcs: string, attendeeEmail: string): string | null {
  const { lines: oldLines } = unfoldLines(oldIcs);
  const { lines: newLines } = unfoldLines(newIcs);

  // Allowed: attendee changes their own PARTSTAT only.
  // Forbidden: changes to any other property.
  // Strategy: compare all non-ATTENDEE lines; they must be identical (modulo DTSTAMP/LAST-MODIFIED).
  // Then for the attendee's own ATTENDEE line, only PARTSTAT can differ.

  function normalize(lines: string[]): string[] {
    return lines.filter((l) =>
      !/^DTSTAMP[;:]/i.test(l) &&
      !/^LAST-MODIFIED[;:]/i.test(l) &&
      !/^ATTENDEE[;:]/i.test(l)
    );
  }

  const oldNorm = normalize(oldLines).join("\n");
  const newNorm = normalize(newLines).join("\n");

  if (oldNorm !== newNorm) {
    return "allowed-attendee-scheduling-object-change";
  }

  // Check attendee's own line: only PARTSTAT can change
  const oldAttLine = oldLines.find((l) =>
    /^ATTENDEE[;:]/i.test(l) &&
    l.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase() === attendeeEmail
  ) ?? "";
  const newAttLine = newLines.find((l) =>
    /^ATTENDEE[;:]/i.test(l) &&
    l.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase() === attendeeEmail
  ) ?? "";

  // Strip PARTSTAT from both lines and compare
  const stripPartstat = (l: string) => l.replace(/;?PARTSTAT=[^;:]+/gi, "");
  if (stripPartstat(oldAttLine) !== stripPartstat(newAttLine)) {
    return "allowed-attendee-scheduling-object-change";
  }

  return null;
}

/** Update ORGANIZER's copy: add SCHEDULE-STATUS to the organizer's ORGANIZER property after attendee reply. */
function updateOrganizerScheduleStatus(orgIcs: string, attendeeEmail: string, replyIcs: string): string {
  const { lines, eol } = unfoldLines(orgIcs);
  const { lines: replyLines } = unfoldLines(replyIcs);

  // Find the attendee's PARTSTAT in the reply
  const attLine = replyLines.find((l) =>
    /^ATTENDEE[;:]/i.test(l) &&
    l.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase() === attendeeEmail
  );
  if (!attLine) return orgIcs;
  const ps = attLine.match(/PARTSTAT=([^;:]+)/i)?.[1] ?? "NEEDS-ACTION";

  // Update the ATTENDEE line in the organizer's copy
  const result: string[] = [];
  for (const line of lines) {
    if (/^ATTENDEE[;:]/i.test(line)) {
      const email = line.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase();
      if (email === attendeeEmail) {
        // Update PARTSTAT
        let updated = line.replace(/PARTSTAT=[^;:]+/i, `PARTSTAT=${ps}`);
        if (!updated.includes("PARTSTAT=")) {
          const colonIdx = updated.indexOf(":");
          if (colonIdx >= 0) updated = updated.slice(0, colonIdx) + `;PARTSTAT=${ps}` + updated.slice(colonIdx);
        }
        result.push(foldLine(updated, eol));
        continue;
      }
    }
    // Update ORGANIZER: add SCHEDULE-STATUS=2.0 if not present
    if (/^ORGANIZER[;:]/i.test(line) && !line.includes("SCHEDULE-STATUS")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        result.push(foldLine(line.slice(0, colonIdx) + ";SCHEDULE-STATUS=2.0" + line.slice(colonIdx), eol));
        continue;
      }
    }
    result.push(line);
  }
  return result.join(eol);
}

/** Build a CANCEL iTIP for a deleted event. */
function buildCancelICS(ics: string): string {
  const { lines, eol } = unfoldLines(ics);
  const result: string[] = [];
  for (const line of lines) {
    if (/^STATUS[;:]/i.test(line)) continue; // remove existing STATUS
    if (line === "BEGIN:VEVENT" || line === "BEGIN:VTODO") {
      result.push(line);
      result.push("METHOD:CANCEL");
      continue;
    }
    result.push(line);
  }
  // Ensure METHOD:CANCEL at VCALENDAR level
  const final: string[] = [];
  let addedMethod = false;
  for (const line of result) {
    if (line === "BEGIN:VCALENDAR") {
      final.push(line);
      final.push("METHOD:CANCEL");
      addedMethod = true;
      continue;
    }
    if (line.startsWith("METHOD:") && addedMethod) continue;
    if (/^BEGIN:(VEVENT|VTODO)/i.test(line)) {
      final.push(line);
      final.push("STATUS:CANCELLED");
      continue;
    }
    final.push(line);
  }
  return final.join(eol);
}

/** Build a REPLY iTIP from attendee's iCal (extracts just the attendee's reply). */
function buildReplyICS(ics: string, attendeeEmail: string): string {
  const { lines, eol } = unfoldLines(ics);
  // Replace or add METHOD:REPLY at VCALENDAR level
  const result: string[] = [];
  let inComponent = false;
  let methodAdded = false;
  for (const line of lines) {
    if (line === "BEGIN:VCALENDAR") {
      result.push(line);
      result.push("METHOD:REPLY");
      methodAdded = true;
      continue;
    }
    if (line.startsWith("METHOD:") && methodAdded) continue;
    if (/^BEGIN:(VEVENT|VTODO)/i.test(line)) inComponent = true;
    if (/^END:(VEVENT|VTODO)/i.test(line)) inComponent = false;
    // Keep only the replying attendee's line + organizer + core props
    if (inComponent && /^ATTENDEE[;:]/i.test(line)) {
      const email = line.replace(/^ATTENDEE[^:]*:/i, "").replace(/^mailto:/i, "").trim().toLowerCase();
      if (email !== attendeeEmail) continue; // strip other attendees from reply
    }
    result.push(line);
  }
  return result.join(eol);
}

/** Deliver REQUEST iTIP to each local attendee's inbox. */
async function deliverRequestToAttendees(ics: string, user: User, storage: Storage): Promise<void> {
  const attendeeEmails = extractAttendeeEmails(ics);
  for (const email of attendeeEmails) {
    if (email === user.email.toLowerCase()) continue; // skip self
    const attUser = await storage.getUserByEmail(email);
    if (!attUser) continue;
    const uid = crypto.randomUUID();
    await storage.putInboxItem(attUser.username, uid, ics);
  }
}

/** Deliver CANCEL iTIP to each local attendee's inbox. */
async function deliverCancelToAttendees(ics: string, user: User, storage: Storage): Promise<void> {
  const cancelIcs = buildCancelICS(ics);
  const attendeeEmails = extractAttendeeEmails(ics);
  for (const email of attendeeEmails) {
    if (email === user.email.toLowerCase()) continue;
    const attUser = await storage.getUserByEmail(email);
    if (!attUser) continue;
    const uid = crypto.randomUUID();
    await storage.putInboxItem(attUser.username, uid, cancelIcs);
  }
}

/** Deliver REPLY iTIP to organizer's inbox and update their copy. */
async function deliverReplyToOrganizer(
  ics: string,
  attendeeUser: User,
  organizerEmail: string,
  storage: Storage,
): Promise<void> {
  const orgUser = await storage.getUserByEmail(organizerEmail);
  if (!orgUser) return;
  const replyIcs = buildReplyICS(ics, attendeeUser.email.toLowerCase());
  const uid = crypto.randomUUID();
  await storage.putInboxItem(orgUser.username, uid, replyIcs);
}

function objectPropsMap(
  etag: string,
  lastModified: Date,
  contentLength: number,
  ics: string,
  username: string,
  deadProps: Record<string, string> = {},
): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(username);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype"));
  m.set(makeKey("DAV:", "getetag"), D("getetag", etag));
  m.set(makeKey("DAV:", "getcontenttype"), D("getcontenttype", "text/calendar; charset=utf-8"));
  m.set(makeKey("DAV:", "getlastmodified"), D("getlastmodified", lastModified.toUTCString()));
  m.set(makeKey("DAV:", "getcontentlength"), D("getcontentlength", String(contentLength)));
  m.set(makeKey("DAV:", "creationdate"), D("creationdate", lastModified.toISOString()));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-data"), C("calendar-data", escapeXmlCDATA(ics)));

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

function inboxItemPropsMap(
  etag: string,
  lastModified: Date,
  contentLength: number,
  ics: string,
  username: string,
): PropMap {
  const m = new Map<string, string>();
  const pp = principalPath(username);
  m.set(makeKey("DAV:", "resourcetype"), D("resourcetype"));
  m.set(makeKey("DAV:", "getetag"), D("getetag", etag));
  m.set(makeKey("DAV:", "getcontenttype"), D("getcontenttype", "text/calendar; charset=utf-8"));
  m.set(makeKey("DAV:", "getlastmodified"), D("getlastmodified", lastModified.toUTCString()));
  m.set(makeKey("DAV:", "getcontentlength"), D("getcontentlength", String(contentLength)));
  m.set(makeKey("DAV:", "current-user-principal"), D("current-user-principal", D("href", pp)));
  m.set(makeKey("urn:ietf:params:xml:ns:caldav", "calendar-data"), C("calendar-data", escapeXmlCDATA(ics)));
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
    const names = Array.from(props.keys())
      .map((k) => {
        const [ns, local] = splitKey(k);
        return buildEmptyProp(ns, local);
      })
      .join("");
    return responseXML(href, [{ props: names, status: 200 }]);
  }

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

function buildPrincipalResponse(href: string, user: User, pfReq: PropFindRequest): string {
  return buildPropsResponse(href, principalProps(user), pfReq);
}

function buildCalendarHomeResponse(href: string, pfReq: PropFindRequest): string {
  return buildPropsResponse(href, calendarHomeProps("0"), pfReq);
}

function buildCollectionResponse(
  href: string,
  col: { name: string; displayName: string; customProps?: Record<string, string> },
  pfReq: PropFindRequest,
  syncToken = "0",
  config?: Config,
): string {
  // Extract username from href: /calendars/<username>/<name>
  const parts = href.split("/").filter(Boolean);
  const username = parts[1] ?? "";
  return buildPropsResponse(
    href,
    collectionProps(username, col.name, col.displayName, syncToken, col.customProps ?? {}, config),
    pfReq,
  );
}

function buildObjectResponse(
  href: string,
  obj: { etag: string; lastModified: Date; contentLength: number; ics: string; deadProps?: Record<string, string>; href?: string },
  pfReq: PropFindRequest,
  noTimezones = false,
  calDataSpec?: CalDataCompSpec,
): string {
  let ics = noTimezones ? stripKnownVTimezones(obj.ics) : obj.ics;
  if (calDataSpec) ics = applyCalDataSpec(ics, calDataSpec);
  const contentLength = (noTimezones || calDataSpec) ? new TextEncoder().encode(ics).length : obj.contentLength;
  // Extract username from stored href or from the request href
  const parts = (obj.href ?? href).split("/").filter(Boolean) ?? [];
  const username = parts[1] ?? "";
  return buildPropsResponse(
    href,
    objectPropsMap(obj.etag, obj.lastModified, contentLength, ics, username, obj.deadProps ?? {}),
    pfReq,
  );
}

function buildInboxItemResponse(
  href: string,
  item: { etag: string; lastModified: Date; contentLength: number; ics: string },
  pfReq: PropFindRequest,
): string {
  const parts = href.split("/").filter(Boolean);
  const username = parts[1] ?? "";
  return buildPropsResponse(
    href,
    inboxItemPropsMap(item.etag, item.lastModified, item.contentLength, item.ics, username),
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
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const { username, collection: colName, uid } = parsed;

  if (parsed.type === "inbox") {
    const body = await req.text();
    const ops = parseProppatch(body);
    for (const op of ops) {
      if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "schedule-default-calendar-URL") {
        const hrefMatch = op.rawXml.match(/<[^>]*href>([^<]+)<\/[^>]*href>/);
        const calPath = (hrefMatch?.[1]?.trim() ?? op.value).replace(/\/$/, "");
        const p = parsePath(calPath);
        if (p.type !== "collection" || !p.collection) {
          return xmlResponse(403, buildPreconditionError("valid-schedule-default-calendar-URL"));
        }
        const col = await storage.getCalendar(p.username || username, p.collection);
        if (!col) return xmlResponse(403, buildPreconditionError("valid-schedule-default-calendar-URL"));
      }
    }
    return xmlResponse(207, multiStatusXML([]));
  }

  if (parsed.type === "collection") {
    const col = await storage.getCalendar(username, colName);
    if (!col) return respond(404, "Not found");
  } else if (parsed.type === "object") {
    const obj = await storage.getObject(username, colName, uid);
    if (!obj) return respond(404, "Not found");
  } else if (parsed.type === "unknown") {
    return respond(404, "Not found");
  }

  const body = await req.text();
  if (body.trim() && !isWellFormedXML(body)) return respond(400, "Malformed XML request body");
  const ops = parseProppatch(body);

  const hasProtected = ops.some((op) => op.type === "set" && PROTECTED_PROPS.has(makeKey(op.ns, op.local)));

  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-availability") {
      const val = op.value.trim();
      try {
        const avCal = parseICS(val);
        const vavails = getComps(avCal, "VAVAILABILITY");
        const nonVtz = avCal.children.filter((c) => c.name !== "VTIMEZONE" && c.name !== "VAVAILABILITY");
        if (vavails.length !== 1 || nonVtz.length > 0) {
          return xmlResponse(409, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>');
        }
      } catch {
        return xmlResponse(409, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>');
      }
    }
  }

  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone-id") {
      const tzId = op.value.trim();
      if (tzId.startsWith("X-")) return xmlResponse(403, buildPreconditionError("valid-timezone"));
    }
  }

  for (const op of ops) {
    if (op.type === "set" && op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone") {
      const val = op.value.trim().replace(/\\n/g, "\n");
      if (!val.includes("BEGIN:VTIMEZONE")) {
        return xmlResponse(409, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-calendar-data/></D:error>');
      }
    }
  }

  if (!hasProtected) {
    if (parsed.type === "collection") {
      for (const op of ops) {
        if (op.type === "set") {
          if (op.ns === "DAV:" && op.local === "displayname") {
            await storage.updateCalendarDisplayName(username, colName, op.value);
          } else {
            await storage.updateCalendarProp(username, colName, `${op.ns}\x00${op.local}`, op.rawXml);
          }
          if (op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone") {
            const normalized = op.value.trim().replace(/\\n/g, "\n");
            const tzidMatch = normalized.match(/TZID:([^\r\n;:]+)/);
            const extractedTzId = tzidMatch?.[1]?.trim();
            if (extractedTzId) {
              const tzIdXml = `<C:calendar-timezone-id xmlns:C="urn:ietf:params:xml:ns:caldav">${esc(extractedTzId)}</C:calendar-timezone-id>`;
              await storage.updateCalendarProp(username, colName, `urn:ietf:params:xml:ns:caldav\x00calendar-timezone-id`, tzIdXml);
            }
          }
          if (op.ns === "urn:ietf:params:xml:ns:caldav" && op.local === "calendar-timezone-id") {
            const tzId = op.value.trim();
            if (tzId) {
              const tzICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:${tzId}\r\nEND:VTIMEZONE\r\nEND:VCALENDAR\r\n`;
              const tzXml = `<C:calendar-timezone xmlns:C="urn:ietf:params:xml:ns:caldav">${escapeXmlCDATA(tzICS)}</C:calendar-timezone>`;
              await storage.updateCalendarProp(username, colName, `urn:ietf:params:xml:ns:caldav\x00calendar-timezone`, tzXml);
            }
          }
        }
      }
    } else if (parsed.type === "object") {
      for (const op of ops) {
        if (op.type === "set") {
          await storage.updateObjectProp(username, colName, uid, `${op.ns}\x00${op.local}`, op.rawXml);
        }
      }
    }
  }

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
  _path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
  isMkcalendar: boolean,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const reqBody = await req.text();
  const ct = req.headers.get("Content-Type") ?? "";
  if (reqBody.length > 0) {
    const mime = ct.split(";")[0].trim().toLowerCase();
    if (mime !== "application/xml" && mime !== "text/xml") return respond(415, "Unsupported Media Type");
  }

  if (parsed.type !== "collection") {
    if (parsed.type === "unknown" || parsed.type === "object") return respond(409, "Conflict: intermediate resource does not exist");
    return respond(403, "Forbidden: can only create calendar collections");
  }

  const { username, collection: colName } = parsed;
  if (!colName || colName.includes("/")) return respond(409, "Conflict: nested collections not supported");

  const existing = await storage.getCalendar(username, colName);
  if (existing) return respond(405, "Method Not Allowed: collection already exists");

  let displayName = colName;
  let calDescription: string | undefined;
  if (isMkcalendar && reqBody.length > 0) {
    const dnMatch = reqBody.match(/<[^:>]*:?displayname[^>]*>([^<]*)<\/[^>]*:?displayname>/);
    if (dnMatch) displayName = dnMatch[1];
    const descMatch = reqBody.match(/<[^:>]*:?calendar-description[^>]*>([^<]*)<\/[^>]*:?calendar-description>/);
    if (descMatch) calDescription = descMatch[1];
  }

  await storage.createCalendar(username, colName, displayName);
  if (calDescription !== undefined) {
    await storage.updateCalendarProp(username, colName, `urn:ietf:params:xml:ns:caldav\x00calendar-description`, C("calendar-description", calDescription));
  }
  return respond(201, "", isMkcalendar ? { "Cache-Control": "no-cache" } : {});
}

// ─── COPY ─────────────────────────────────────────────────────────────────────

async function handleCopy(
  req: Request,
  path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const destHeader = req.headers.get("Destination");
  if (!destHeader) return respond(400, "Destination header required");

  let destPath: string;
  try {
    destPath = decodeURIComponent(new URL(destHeader).pathname);
  } catch {
    destPath = destHeader;
  }

  if (path === destPath) return respond(403, "Source and destination are the same");
  if (parsed.type !== "object") return respond(403, "COPY only supported for calendar objects");

  const { username, collection: srcCol, uid: srcUid } = parsed;
  const src = await storage.getObject(username, srcCol, srcUid);
  if (!src) return respond(404, "Source not found");

  const dstParsed = parsePath(destPath);
  if (dstParsed.type !== "object") return respond(409, "Invalid destination path");

  const dstCal = await storage.getCalendar(username, dstParsed.collection);
  if (!dstCal) return respond(409, "Destination collection does not exist");

  const existingDst = await storage.getObject(username, dstParsed.collection, dstParsed.uid);
  if (existingDst && (req.headers.get("Overwrite") ?? "T") === "F") {
    return respond(412, "Precondition Failed: destination exists");
  }

  await storage.copyObject(username, srcCol, srcUid, dstParsed.collection, dstParsed.uid);
  return respond(existingDst ? 204 : 201);
}

// ─── MOVE ─────────────────────────────────────────────────────────────────────

async function handleMove(
  req: Request,
  path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const destHeader = req.headers.get("Destination");
  if (!destHeader) return respond(400, "Destination header required");

  let destPath: string;
  try {
    destPath = decodeURIComponent(new URL(destHeader).pathname);
  } catch {
    destPath = destHeader;
  }

  if (path === destPath) return respond(403, "Source and destination are the same");
  if (parsed.type !== "object") return respond(403, "MOVE only supported for calendar objects");

  const { username, collection: srcCol, uid: srcUid } = parsed;
  const src = await storage.getObject(username, srcCol, srcUid);
  if (!src) return respond(404, "Source not found");

  const dstParsed = parsePath(destPath);
  if (dstParsed.type !== "object") return respond(409, "Invalid destination path");

  const dstCal = await storage.getCalendar(username, dstParsed.collection);
  if (!dstCal) return respond(409, "Destination collection does not exist");

  const existingDst = await storage.getObject(username, dstParsed.collection, dstParsed.uid);
  if (existingDst && (req.headers.get("Overwrite") ?? "T") === "F") {
    return respond(412, "Precondition Failed: destination exists");
  }

  await storage.moveObject(username, srcCol, srcUid, dstParsed.collection, dstParsed.uid);
  return respond(existingDst ? 204 : 201);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

async function handlePost(
  req: Request,
  _path: string,
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  if (parsed.type === "outbox") return await handleOutboxPost(req, parsed, user);

  if (parsed.type !== "object") return respond(405, "Method not allowed");

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const managedId = url.searchParams.get("managed-id");
  const rid = url.searchParams.get("rid");

  const { username, collection: colName, uid } = parsed;
  const obj = await storage.getObject(username, colName, uid);
  if (!obj) return respond(404, "Not found");

  const VALID_ACTIONS = new Set(["attachment-add", "attachment-update", "attachment-remove"]);
  if (!action || !VALID_ACTIONS.has(action)) return xmlResponse(403, buildPreconditionError("valid-action"));
  if (action === "attachment-add" && managedId) return xmlResponse(403, buildPreconditionError("valid-managed-id"));
  if (rid) return xmlResponse(403, buildPreconditionError("valid-rid"));

  if (action === "attachment-remove") {
    if (!managedId) return xmlResponse(403, buildPreconditionError("valid-managed-id"));
    const removedICS = icsRemoveAttach(obj.ics, managedId);
    if (removedICS === null) return xmlResponse(403, buildPreconditionError("valid-managed-id"));
    await storage.putObject(username, colName, uid, removedICS, obj.icalUID);
    return respond(204);
  }

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

  await storage.putObject(username, colName, uid, updatedICS, obj.icalUID);
  return respond(201, "", { "Cal-Managed-ID": assignedManagedId });
}

function icsAddAttach(ics: string, managedId: string, fmttype: string, filename: string, size: number): string {
  const attachLine = buildAttachLine(managedId, fmttype, filename, size);
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  for (const compEnd of ["END:VEVENT", "END:VTODO"]) {
    const idx = ics.indexOf(compEnd);
    if (idx >= 0) return ics.slice(0, idx) + attachLine + eol + ics.slice(idx);
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
    if (!skip) {
      if (line.toUpperCase().startsWith("ATTACH") && line.toUpperCase().includes("MANAGED-ID=" + managedId.toUpperCase())) {
        found = true; skip = true; continue;
      }
      result.push(line);
    } else {
      if (line.startsWith(" ") || line.startsWith("\t")) continue;
      skip = false; result.push(line);
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
  parsed: ParsedPath,
  user: User,
  storage: Storage,
): Promise<Response> {
  const own = checkOwnership(parsed, user);
  if (own) return own;

  const body = await req.text();
  if (body.trim() && !isWellFormedXML(body)) return respond(400, "Malformed XML request body");
  const report = parseReport(body);

  if (parsed.type === "inbox") {
    if (report.type === "free-busy-query") return respond(403, "free-busy-query is not supported on scheduling inbox");
    if (report.type === "calendar-query") return xmlResponse(207, multiStatusXML([]));
    return respond(405, "Method Not Allowed");
  }

  const noTimezones = (req.headers.get("CalDAV-Timezones") ?? "").toUpperCase() === "F";
  const { username } = parsed;

  switch (report.type) {
    case "calendar-query":
      return await handleCalendarQuery(path, parsed, user, report.query, storage, noTimezones);
    case "calendar-multiget":
      return await handleCalendarMultiget(report.multiget, username, storage, noTimezones);
    case "sync-collection":
      return await handleSyncCollection(req, path, parsed, user, report.sync, storage);
    case "free-busy-query":
      return await handleFreeBusyQuery(req, path, parsed, user, report.start, report.end, storage);
    case "expand-property":
      return xmlResponse(207, multiStatusXML([]));
    default:
      return respond(400, "Unknown REPORT type");
  }
}

const SUPPORTED_COLLATIONS = new Set(["i;ascii-casemap", "i;octet"]);
const DATE_TIME_PROPS = new Set(["DTSTART", "DTEND", "DUE", "COMPLETED", "CREATED", "LAST-MODIFIED", "RECURRENCE-ID", "TRIGGER"]);

function hasUnsupportedCollation(cf: CompFilter): string | null {
  for (const pf of cf.props) {
    if (pf.textMatch?.collation && !SUPPORTED_COLLATIONS.has(pf.textMatch.collation)) return pf.textMatch.collation;
    for (const param of pf.paramFilters) {
      if (param.textMatch?.collation && !SUPPORTED_COLLATIONS.has(param.textMatch.collation)) return param.textMatch.collation;
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
    if ((pf.start || pf.end) && !DATE_TIME_PROPS.has(pf.name.toUpperCase())) return true;
  }
  for (const child of cf.comps) {
    if (hasInvalidFilter(child)) return true;
  }
  return false;
}

async function handleCalendarQuery(
  _path: string,
  parsed: ParsedPath,
  _user: User,
  query: CalendarQuery,
  storage: Storage,
  noTimezones = false,
): Promise<Response> {
  if (query.timezoneId?.startsWith("X-")) return xmlResponse(403, buildPreconditionError("valid-timezone"));

  const badCollation = hasUnsupportedCollation(query.filter);
  if (badCollation) {
    return xmlResponse(403, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:supported-collation/></D:error>');
  }
  if (hasInvalidFilter(query.filter)) {
    return xmlResponse(403, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:valid-filter/></D:error>');
  }

  const { username, collection: colName, uid } = parsed;
  const tzOffsetMs = query.timezone ? extractTzOffsetFromVTZ(query.timezone) : 0;

  if (parsed.type === "object") {
    const obj = await storage.getObject(username, colName, uid);
    if (!obj) return respond(404, "Not found");
    const pfReq: PropFindRequest = { type: "prop", names: query.requestedProps };
    const responses: string[] = [];
    if (matchesFilter(obj.ics, query.filter, tzOffsetMs)) {
      responses.push(buildObjectResponse(obj.href, obj, pfReq, noTimezones, query.calDataSpec));
    }
    return xmlResponse(207, multiStatusXML(responses));
  }

  if (parsed.type !== "collection") return respond(403, "calendar-query must target a calendar collection");

  const col = await storage.getCalendar(username, colName);
  if (!col) return respond(404, "Not found");

  const objs = await storage.listObjects(username, colName);
  const pfReq: PropFindRequest = query.allProp ? { type: "allprop" } : { type: "prop", names: query.requestedProps };

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
  username: string,
  storage: Storage,
  noTimezones = false,
): Promise<Response> {
  const pfReq: PropFindRequest = multiget.allProp ? { type: "allprop" } : { type: "prop", names: multiget.requestedProps };
  const responses: string[] = [];

  for (const href of multiget.hrefs) {
    const p = parsePath(href);
    if (p.type !== "object") {
      responses.push(notFoundResponseXML(href));
      continue;
    }
    const targetUsername = p.username || username;
    const obj = await storage.getObject(targetUsername, p.collection, p.uid);
    if (!obj) {
      const ps: PropstatEntry[] = [{
        props: pfReq.type === "prop" ? pfReq.names.map((n) => buildEmptyProp(n.ns, n.local)).join("") : "",
        status: 404,
      }];
      responses.push(responseXML(href, ps));
      continue;
    }
    responses.push(buildObjectResponse(href, obj, pfReq, noTimezones));
  }

  return xmlResponse(207, multiStatusXML(responses));
}

async function handleSyncCollection(
  req: Request,
  _path: string,
  parsed: ParsedPath,
  _user: User,
  sync: SyncCollectionQuery,
  storage: Storage,
): Promise<Response> {
  const depth = req.headers.get("Depth");
  if (depth !== null && depth !== "0") return respond(400, "sync-collection REPORT requires Depth: 0");

  const { username, collection: colName } = parsed;

  if (parsed.type === "calendarHome") {
    const cals = await storage.listCalendars(username);
    const pfReq: PropFindRequest = sync.allProp ? { type: "allprop" } : { type: "prop", names: sync.requestedProps };
    const responses: string[] = [];
    for (const cal of cals) {
      const rawToken = await storage.getSyncToken(username, cal.name);
      responses.push(buildPropsResponse(
        cal.href,
        collectionProps(username, cal.name, cal.displayName, rawToken, cal.customProps ?? {}),
        pfReq,
      ));
    }
    const respBody =
      '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      responses.join("") +
      D("sync-token", wrapSyncToken("0")) +
      `</D:multistatus>`;
    return xmlResponse(207, respBody);
  }

  if (parsed.type !== "collection") return respond(403, "sync-collection must target a calendar collection or home");

  const col = await storage.getCalendar(username, colName);
  if (!col) return respond(404, "Not found");

  const pfReq: PropFindRequest = sync.allProp ? { type: "allprop" } : { type: "prop", names: sync.requestedProps };
  const rawToken = unwrapSyncToken(sync.syncToken);
  const syncResult = await storage.getChanges(username, colName, rawToken);
  if (syncResult.invalidToken) {
    return xmlResponse(403, '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>');
  }

  const responses: string[] = [];
  for (const change of syncResult.changes) {
    const href = objectPath(username, colName, change.uid);
    if (change.type === "deleted") {
      responses.push(D("response", D("href", href) + D("status", "HTTP/1.1 404 Not Found")));
    } else {
      const obj = await storage.getObject(username, colName, change.uid);
      if (obj) responses.push(buildObjectResponse(href, obj, pfReq));
    }
  }

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
  _path: string,
  parsed: ParsedPath,
  _user: User,
  queryStart: string,
  queryEnd: string,
  storage: Storage,
): Promise<Response> {
  if (parsed.type === "object") {
    return xmlResponse(403,
      '<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:supported-filter/></D:error>');
  }

  const { username, collection: colName } = parsed;
  const rangeStart = queryStart ? parseICalDateTimeForFB(queryStart) : null;
  const rangeEnd = queryEnd ? parseICalDateTimeForFB(queryEnd) : null;

  const freebusyLines: string[] = [];

  function btToFbtype(busytype: string): string {
    const bt = busytype.toUpperCase();
    if (bt === "BUSY") return "BUSY";
    if (bt === "BUSY-TENTATIVE") return "BUSY-TENTATIVE";
    return "BUSY-UNAVAILABLE";
  }

  const blocks: Array<{ start: Date | null; end: Date | null; priority: number; busytype: string; availRanges: Array<{ s: Date; e: Date }> }> = [];
  const objects = await storage.listObjects(username, colName);

  for (const obj of objects) {
    try {
      const cal = parseICS(obj.ics);
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
        const priority = parseInt(getProp(va, "PRIORITY")?.value ?? "0", 10);
        const busytype = getProp(va, "BUSYTYPE")?.value ?? "BUSY-UNAVAILABLE";
        const availRanges: Array<{ s: Date; e: Date }> = [];
        for (const avail of getComps(va, "AVAILABLE")) {
          const as = getPropDate2(avail, "DTSTART");
          const ae = getPropDate2(avail, "DTEND");
          if (as && ae) availRanges.push({ s: as, e: ae });
        }
        blocks.push({ start: dtStart, end: dtEnd, priority, busytype, availRanges });
      }
    } catch { /* ignore */ }
  }

  const cal = await storage.getCalendar(username, colName);
  if (cal) {
    const caRaw = cal.customProps[`urn:ietf:params:xml:ns:caldav\x00calendar-availability`];
    if (caRaw) {
      const innerMatch = caRaw.match(/>([^<]*(?:BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR))/);
      const icsContent = innerMatch?.[1] ?? caRaw.replace(/<[^>]+>/g, "").trim();
      try {
        const avCal = parseICS(icsContent);
        for (const va of getComps(avCal, "VAVAILABILITY")) {
          const dtStart = getPropDate2(va, "DTSTART");
          const dtEnd = getPropDate2(va, "DTEND");
          const priority = parseInt(getProp(va, "PRIORITY")?.value ?? "0", 10);
          const busytype = getProp(va, "BUSYTYPE")?.value ?? "BUSY-UNAVAILABLE";
          blocks.push({ start: dtStart, end: dtEnd, priority, busytype, availRanges: [] });
        }
      } catch { /* ignore */ }
    }
  }

  const qStart = rangeStart ?? new Date(0);
  const qEnd = rangeEnd ?? new Date(8.64e15);

  for (const block of blocks) {
    const windowStart = block.start ?? new Date(0);
    const windowEnd = block.end ?? new Date(8.64e15);
    if (windowStart >= qEnd || windowEnd <= qStart) continue;
    const effStart = windowStart > qStart ? windowStart : qStart;
    const effEnd = windowEnd < qEnd ? windowEnd : qEnd;
    const fbtype = btToFbtype(block.busytype);
    const busyIntervals = subtractIntervals(effStart, effEnd, block.availRanges);
    for (const { s, e } of busyIntervals) {
      freebusyLines.push(`FREEBUSY;FBTYPE=${fbtype}:${formatICalDateTime(s)}/${formatICalDateTime(e)}`);
    }
  }

  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let vfb = "BEGIN:VFREEBUSY\r\nDTSTAMP:" + dtstamp + "\r\n";
  if (queryStart) vfb += "DTSTART:" + queryStart + "\r\n";
  if (queryEnd) vfb += "DTEND:" + queryEnd + "\r\n";
  for (const line of freebusyLines) vfb += line + "\r\n";
  vfb += "END:VFREEBUSY\r\n";

  const ical = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//CalDAV Server//EN\r\n" + vfb + "END:VCALENDAR\r\n";
  return new Response(ical, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}

function subtractIntervals(start: Date, end: Date, freeRanges: Array<{ s: Date; e: Date }>): Array<{ s: Date; e: Date }> {
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
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";
}

function getPropDate2(comp: ICalComponent, name: string): Date | null {
  const prop = getProp(comp, name);
  if (!prop) return null;
  try { return parseICalDateTimeForFB(prop.value); } catch { return null; }
}
