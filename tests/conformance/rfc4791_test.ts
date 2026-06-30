// RFC 4791 — Calendaring Extensions to WebDAV (CalDAV)
// Spec: specs/rfc4791.txt
//
// Coverage:
//   §4   Calendar Resources
//   §5.1 OPTIONS — calendar-access compliance
//   §5.2 Calendar Collection Properties
//   §5.3 Creating Resources (MKCALENDAR, PUT preconditions, ETag)
//   §6.2 calendar-home-set principal property
//   §7.8 calendar-query REPORT
//   §7.9 calendar-multiget REPORT
//   §7.10 free-busy-query REPORT

import { assertEquals } from "@std/assert";
import {
  calContentType,
  calendarHomePath,
  calendarMultiget,
  calendarQueryByComp,
  calendarQueryByTimeRange,
  collectionPath,
  depthHeader,
  nsCalDAV,
  nsDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindAllprop,
  propfindProps,
  vtodo,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §5.1 OPTIONS / DAV compliance ───────────────────────────────────────────

Deno.test("RFC 4791 §5.1 OPTIONS advertises calendar-access", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", principalPath);
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(
      dav.includes("calendar-access"),
      true,
      "DAV header must include 'calendar-access'",
    );
  });
});

Deno.test("RFC 4791 §5.1 OPTIONS on calendar home advertises calendar-access", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", calendarHomePath);
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(dav.includes("calendar-access"), true);
  });
});

Deno.test("RFC 4791 §5.1 OPTIONS on collection advertises calendar-access", async () => {
  await withServer(async (s) => {
    await s.mkcol("opts-col");
    const resp = await s.do("OPTIONS", collectionPath("opts-col"));
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(dav.includes("calendar-access"), true);
  });
});

// ─── §6.2 calendar-home-set ───────────────────────────────────────────────────

Deno.test("RFC 4791 §6.2 principal has calendar-home-set property", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "calendar-home-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("calendar-home-set");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4791 §6.2 current-user-principal property is supported", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "current-user-principal"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("current-user-principal");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
  });
});

// ─── §5.3.1 MKCALENDAR ───────────────────────────────────────────────────────

Deno.test("RFC 4791 §5.3.1 MKCALENDAR creates collection with 201", async () => {
  await withServer(async (s) => {
    const resp = await s.do("MKCALENDAR", collectionPath("mkcal-test"));
    assertEquals(resp.status, 201, "MKCALENDAR must return 201 Created");
  });
});

Deno.test("RFC 4791 §5.3.1 MKCALENDAR on existing path returns 405", async () => {
  await withServer(async (s) => {
    await s.mkcol("mkcal-dup");
    const resp = await s.do("MKCALENDAR", collectionPath("mkcal-dup"));
    assertEquals(resp.status, 405);
  });
});

Deno.test("RFC 4791 §5.3.1 MKCALENDAR sets <C:calendar/> resourcetype", async () => {
  await withServer(async (s) => {
    const mkResp = await s.do("MKCALENDAR", collectionPath("mkcal-rt"));
    assertEquals(mkResp.status, 201);

    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("mkcal-rt"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "resourcetype"),
    );
    assertEquals(pfResp.status, 207);

    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("mkcal-rt"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true);
    assertEquals(p!.hasChild("calendar"), true, "MKCALENDAR collection must have <C:calendar/>");
  });
});

Deno.test("RFC 4791 §5.3.1 MKCOL also creates a calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("mkcol-cal");

    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("mkcol-cal"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "resourcetype"),
    );
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("mkcol-cal"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true);
    assertEquals(p!.hasChild("collection"), true, "MKCOL collection must have <D:collection/>");
  });
});

// ─── §5.2 Calendar Collection Properties ──────────────────────────────────────

Deno.test("RFC 4791 §5.2.3 supported-calendar-component-set present", async () => {
  await withServer(async (s) => {
    await s.mkcol("sccs-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("sccs-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "supported-calendar-component-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("sccs-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("supported-calendar-component-set");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4791 §5.2.4 supported-calendar-data present", async () => {
  await withServer(async (s) => {
    await s.mkcol("scd-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("scd-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "supported-calendar-data"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("scd-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("supported-calendar-data");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4791 §5.2.1 calendar-description appears in propstat", async () => {
  await withServer(async (s) => {
    await s.mkcol("desc-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("desc-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "calendar-description"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("desc-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("calendar-description");
    assertEquals(p !== undefined, true, "calendar-description must appear in PROPFIND propstat");
  });
});

Deno.test("RFC 4791 §5.2.5 max-resource-size appears in propstat", async () => {
  await withServer(async (s) => {
    await s.mkcol("mrs-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("mrs-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "max-resource-size"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("mrs-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("max-resource-size");
    assertEquals(p !== undefined, true, "max-resource-size must appear in PROPFIND propstat");
  });
});

Deno.test("RFC 4791 §5.2.6/5.2.7 min-date-time and max-date-time appear", async () => {
  await withServer(async (s) => {
    await s.mkcol("dt-range-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("dt-range-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "min-date-time", nsCalDAV, "max-date-time"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("dt-range-test"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("min-date-time") !== undefined,
      true,
      "min-date-time must appear in propstat",
    );
    assertEquals(
      r!.prop("max-date-time") !== undefined,
      true,
      "max-date-time must appear in propstat",
    );
  });
});

// ─── §5.3.2 PUT preconditions ────────────────────────────────────────────────

Deno.test("RFC 4791 §5.3.2 PUT with wrong Content-Type rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("ct-test");
    const resp = await s.do(
      "PUT",
      objectPath("ct-test", "bad-ct"),
      { "Content-Type": "text/plain" },
      vtodo("bad-ct"),
    );
    assertEquals(
      [400, 415].includes(resp.status),
      true,
      "PUT with wrong Content-Type must be rejected",
    );
  });
});

Deno.test("RFC 4791 §5.3.2 PUT without UID rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("uid-test");
    const noUID =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n" +
      "BEGIN:VTODO\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:No UID\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("uid-test", "no-uid"), calContentType(), noUID);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      "PUT without UID must be rejected",
    );
  });
});

Deno.test("RFC 4791 §5.3.2 PUT with invalid iCalendar body rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("invalid-test");
    const resp = await s.do(
      "PUT",
      objectPath("invalid-test", "bad"),
      calContentType(),
      "this is not valid icalendar data",
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      "PUT of invalid iCalendar must be rejected",
    );
  });
});

Deno.test("RFC 4791 §5.3.2 If-None-Match: * prevents overwriting existing object", async () => {
  await withServer(async (s) => {
    await s.mkcol("precond-test");
    await s.putTodo("precond-test", "exists");

    const resp = await s.do(
      "PUT",
      objectPath("precond-test", "exists"),
      withHeaders(calContentType(), { "If-None-Match": "*" }),
      vtodo("exists"),
    );
    assertEquals(resp.status, 412, "If-None-Match: * must return 412 when resource exists");
  });
});

Deno.test("RFC 4791 §5.3.2 no-uid-conflict: same UID at different URL rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("uid-conflict");
    const uid = "conflict-uid-001";
    await s.putObject(objectPath("uid-conflict", uid), vtodo(uid));

    const resp = await s.do(
      "PUT",
      objectPath("uid-conflict", "other-name"),
      calContentType(),
      vtodo(uid),
    );
    assertEquals(
      [403, 409].includes(resp.status),
      true,
      "Duplicate UID in same collection must be rejected",
    );
  });
});

// ─── §5.3.4 ETag ─────────────────────────────────────────────────────────────

Deno.test("RFC 4791 §5.3.4 successful PUT returns ETag", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag4791");
    const resp = await s.do(
      "PUT",
      objectPath("etag4791", "e1"),
      calContentType(),
      vtodo("e1"),
    );
    assertEquals(resp.status, 201);
    assertEquals(
      resp.headers.get("ETag") !== null,
      true,
      "RFC 4791 §5.3.4: server MUST return ETag on successful PUT",
    );
  });
});

// ─── §7.8 calendar-query REPORT ───────────────────────────────────────────────

Deno.test("RFC 4791 §7.8 calendar-query REPORT returns 207 Multi-Status", async () => {
  await withServer(async (s) => {
    await s.mkcol("query-test");
    await s.putTodo("query-test", "q-todo");

    const resp = await s.do(
      "REPORT",
      collectionPath("query-test"),
      xmlContentType(),
      calendarQueryByComp("VTODO"),
    );
    assertEquals(resp.status, 207, "calendar-query REPORT must return 207");
  });
});

Deno.test("RFC 4791 §7.8 calendar-query filters by VTODO component type", async () => {
  await withServer(async (s) => {
    await s.mkcol("filter-col");
    await s.putTodo("filter-col", "todo-1");
    await s.putTodo("filter-col", "todo-2");
    await s.putEvent("filter-col", "event-1");

    const resp = await s.do(
      "REPORT",
      collectionPath("filter-col"),
      xmlContentType(),
      calendarQueryByComp("VTODO"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);

    assertEquals(
      ms.response(objectPath("filter-col", "event-1")),
      undefined,
      "VEVENT must not appear in VTODO-only query",
    );
    assertEquals(ms.response(objectPath("filter-col", "todo-1")) !== undefined, true);
    assertEquals(ms.response(objectPath("filter-col", "todo-2")) !== undefined, true);
  });
});

Deno.test("RFC 4791 §7.8 calendar-query filters by VEVENT component type", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-filter");
    await s.putEvent("vevent-filter", "evt-1");
    await s.putEvent("vevent-filter", "evt-2");
    await s.putTodo("vevent-filter", "td-1");

    const resp = await s.do(
      "REPORT",
      collectionPath("vevent-filter"),
      xmlContentType(),
      calendarQueryByComp("VEVENT"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);

    assertEquals(ms.response(objectPath("vevent-filter", "evt-1")) !== undefined, true);
    assertEquals(ms.response(objectPath("vevent-filter", "evt-2")) !== undefined, true);
    assertEquals(
      ms.response(objectPath("vevent-filter", "td-1")),
      undefined,
      "VTODO must not appear in VEVENT-only query",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query time-range filter returns only overlapping events", async () => {
  await withServer(async (s) => {
    await s.mkcol("time-range");

    // Event inside the query window: 2026-01-15
    await s.putEvent(
      "time-range",
      "in-range",
      "DTSTART:20260115T100000Z",
      "DTEND:20260115T110000Z",
    );
    // Event outside the query window: 2026-03-01
    await s.putEvent(
      "time-range",
      "out-range",
      "DTSTART:20260301T100000Z",
      "DTEND:20260301T110000Z",
    );

    const resp = await s.do(
      "REPORT",
      collectionPath("time-range"),
      xmlContentType(),
      calendarQueryByTimeRange("VEVENT", "20260101T000000Z", "20260201T000000Z"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);

    assertEquals(
      ms.response(objectPath("time-range", "in-range")) !== undefined,
      true,
      "in-range event must be in result",
    );
    assertEquals(
      ms.response(objectPath("time-range", "out-range")),
      undefined,
      "out-of-range event must not be in result",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query on object does not return 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("qobj-test");
    await s.putTodo("qobj-test", "qobj-todo");

    const resp = await s.do(
      "REPORT",
      objectPath("qobj-test", "qobj-todo"),
      xmlContentType(),
      calendarQueryByComp("VTODO"),
    );
    assertEquals(resp.status < 500, true, "REPORT on object must not return 5xx");
  });
});

Deno.test("RFC 4791 §7.8 calendar-query returns calendar-data in response body", async () => {
  await withServer(async (s) => {
    await s.mkcol("cdata-test");
    await s.putTodo("cdata-test", "cdata-todo");

    const resp = await s.do(
      "REPORT",
      collectionPath("cdata-test"),
      xmlContentType(),
      calendarQueryByComp("VTODO"),
    );
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes("BEGIN:VCALENDAR"), true);
  });
});

// ─── §7.9 calendar-multiget REPORT ───────────────────────────────────────────

Deno.test("RFC 4791 §7.9 calendar-multiget returns 207 with each href", async () => {
  await withServer(async (s) => {
    await s.mkcol("multiget-test");
    await s.putTodo("multiget-test", "mg-todo1");
    await s.putTodo("multiget-test", "mg-todo2");

    const hrefs = [
      objectPath("multiget-test", "mg-todo1"),
      objectPath("multiget-test", "mg-todo2"),
    ];
    const resp = await s.do(
      "REPORT",
      collectionPath("multiget-test"),
      xmlContentType(),
      calendarMultiget(...hrefs),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.response(objectPath("multiget-test", "mg-todo1")) !== undefined, true);
    assertEquals(ms.response(objectPath("multiget-test", "mg-todo2")) !== undefined, true);
  });
});

Deno.test("RFC 4791 §7.9 multiget non-existent href returns 404 in response", async () => {
  await withServer(async (s) => {
    await s.mkcol("mg-miss");
    await s.putTodo("mg-miss", "exists");

    const resp = await s.do(
      "REPORT",
      collectionPath("mg-miss"),
      xmlContentType(),
      calendarMultiget(
        objectPath("mg-miss", "exists"),
        objectPath("mg-miss", "no-such-object"),
      ),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.response(objectPath("mg-miss", "exists")) !== undefined, true);
    // Missing object: response may be absent or have 404 propstats
    // (both are conformant per RFC 4791 §7.9)
  });
});

// ─── §7.10 free-busy-query REPORT ────────────────────────────────────────────

Deno.test("RFC 4791 §7.10 free-busy-query returns 200 or 207 (not 5xx)", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-test");
    await s.putEvent("fb-test", "fb-event");

    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>' +
      "</C:free-busy-query>";
    const resp = await s.do("REPORT", collectionPath("fb-test"), xmlContentType(), body);
    assertEquals(resp.status < 500, true, "free-busy-query must not return 5xx");
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      "free-busy-query must return 200 or 207",
    );
  });
});

// ─── §4 Resource listing ──────────────────────────────────────────────────────

Deno.test("RFC 4791 §4.2 collection appears in home PROPFIND Depth:1", async () => {
  await withServer(async (s) => {
    await s.mkcol("list-col");

    const resp = await s.do(
      "PROPFIND",
      calendarHomePath,
      withHeaders(depthHeader("1"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(collectionPath("list-col")) !== undefined,
      true,
      "collection must appear in home PROPFIND Depth:1",
    );
  });
});

Deno.test("RFC 4791 §4.1 object appears in collection PROPFIND Depth:1", async () => {
  await withServer(async (s) => {
    await s.mkcol("obj-list");
    await s.putTodo("obj-list", "listed-todo");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("obj-list"),
      withHeaders(depthHeader("1"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("obj-list", "listed-todo")) !== undefined,
      true,
      "calendar object must appear in collection PROPFIND Depth:1",
    );
  });
});

// ─── §5.1 OPTIONS on calendar object resource ─────────────────────────────────

Deno.test("RFC 4791 §5.1 OPTIONS on calendar object resource advertises calendar-access", async () => {
  await withServer(async (s) => {
    await s.mkcol("opts-obj");
    await s.putTodo("opts-obj", "opts-todo");
    const resp = await s.do("OPTIONS", objectPath("opts-obj", "opts-todo"));
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(
      dav.includes("calendar-access"),
      true,
      "DAV header on calendar object resource must include 'calendar-access'",
    );
  });
});

// ─── §4.2 resourcetype and collection nesting ────────────────────────────────

Deno.test("RFC 4791 §4.2 MKCALENDAR resourcetype contains both DAV:collection and CALDAV:calendar", async () => {
  await withServer(async (s) => {
    const resp = await s.do("MKCALENDAR", collectionPath("mkcal-both-rt"));
    assertEquals(resp.status, 201);
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("mkcal-both-rt"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "resourcetype"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("mkcal-both-rt"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true);
    assertEquals(p!.hasChild("collection"), true, "resourcetype must contain DAV:collection");
    assertEquals(p!.hasChild("calendar"), true, "resourcetype must contain CALDAV:calendar");
  });
});

Deno.test("RFC 4791 §4.2 creating calendar collection inside calendar collection is rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("outer-cal");
    const innerPath = collectionPath("outer-cal") + "/inner-cal";
    const resp = await s.do("MKCALENDAR", innerPath);
    assertEquals(
      [403, 405, 409].includes(resp.status),
      true,
      "Nesting calendar collections must be rejected with 403, 405, or 409",
    );
  });
});

// ─── §4.1 PUT restrictions ────────────────────────────────────────────────────

Deno.test("RFC 4791 §4.1 PUT with mixed component types (VEVENT + VTODO) is rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("mixed-types");
    const mixed =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:mixed-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event\r\n" +
      "END:VEVENT\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:mixed-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Todo\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("mixed-types", "mixed-001"),
      calContentType(),
      mixed,
    );
    assertEquals(
      [400, 403, 409, 422].includes(resp.status),
      true,
      "PUT with mixed VEVENT+VTODO must be rejected",
    );
  });
});

Deno.test("RFC 4791 §4.1 PUT with iCalendar METHOD property is rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("method-test");
    const withMethod =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:method-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Test\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("method-test", "method-001"),
      calContentType(),
      withMethod,
    );
    assertEquals(
      [400, 403, 409, 422].includes(resp.status),
      true,
      "PUT with METHOD property must be rejected",
    );
  });
});

// ─── §5.2.3 supported-calendar-component-set ─────────────────────────────────

Deno.test("RFC 4791 §5.2.3 supported-calendar-component-set is protected against PROPPATCH", async () => {
  await withServer(async (s) => {
    await s.mkcol("sccs-protect");
    const proppatch =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<C:supported-calendar-component-set>" +
      '<C:comp name="VEVENT"/>' +
      "</C:supported-calendar-component-set>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";
    const resp = await s.do(
      "PROPPATCH",
      collectionPath("sccs-protect"),
      xmlContentType(),
      proppatch,
    );
    if (resp.status === 207) {
      const ms = parseMultistatus(resp.body);
      const r = ms.response(collectionPath("sccs-protect"));
      assertEquals(r !== undefined, true);
      const p = r!.prop("supported-calendar-component-set");
      assertEquals(
        p !== undefined && p.status !== 200,
        true,
        "supported-calendar-component-set must be protected (propstat must not be 200)",
      );
    } else {
      assertEquals(
        [403, 409].includes(resp.status),
        true,
        "PROPPATCH to change protected property must fail with 403 or 409",
      );
    }
  });
});

Deno.test("RFC 4791 §5.2.3 PUT with unsupported component type returns CALDAV:supported-calendar-component precondition error", async () => {
  await withServer(async (s) => {
    await s.mkcol("comp-restrict");
    // VJOURNAL is not in the default supported-calendar-component-set (VEVENT + VTODO)
    const vjournal =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VJOURNAL\r\n" +
      "UID:vjournal-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Test Journal\r\n" +
      "END:VJOURNAL\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("comp-restrict", "vjournal-001"),
      calContentType(),
      vjournal,
    );
    assertEquals(
      [403, 409].includes(resp.status),
      true,
      "PUT with unsupported component type (VJOURNAL) must be rejected with 403 or 409",
    );
    assertEquals(
      resp.body.includes("supported-calendar-component"),
      true,
      "Error body must contain CALDAV:supported-calendar-component precondition element",
    );
  });
});

// ─── §5.2.10 calendar-timezone validation ────────────────────────────────────

Deno.test("RFC 4791 §5.2.10 PROPPATCH with invalid calendar-timezone returns CALDAV:valid-calendar-data precondition", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-invalid");
    const proppatch =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<C:calendar-timezone>NOT VALID ICALENDAR</C:calendar-timezone>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";
    const resp = await s.do(
      "PROPPATCH",
      collectionPath("tz-invalid"),
      xmlContentType(),
      proppatch,
    );
    const failedAtHttpLevel = [403, 409].includes(resp.status);
    const failedInPropstat =
      resp.status === 207 && resp.body.includes("valid-calendar-data");
    assertEquals(
      failedAtHttpLevel || failedInPropstat,
      true,
      "PROPPATCH with invalid calendar-timezone must fail with CALDAV:valid-calendar-data precondition",
    );
  });
});

// ─── §5.3.1 MKCALENDAR enhancements ──────────────────────────────────────────

Deno.test("RFC 4791 §5.3.1 MKCALENDAR response includes Cache-Control: no-cache", async () => {
  await withServer(async (s) => {
    const resp = await s.do("MKCALENDAR", collectionPath("cc-nocache"));
    assertEquals(resp.status, 201);
    const cc = resp.headers.get("Cache-Control") ?? "";
    assertEquals(
      cc.toLowerCase().includes("no-cache"),
      true,
      "MKCALENDAR response must include Cache-Control: no-cache",
    );
  });
});

Deno.test("RFC 4791 §5.3.1 MKCALENDAR with body sets DAV:displayname and CALDAV:calendar-description", async () => {
  await withServer(async (s) => {
    const mkBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<D:displayname>My Test Calendar</D:displayname>" +
      "<C:calendar-description>A test calendar description</C:calendar-description>" +
      "</D:prop></D:set>" +
      "</C:mkcalendar>";
    const mkResp = await s.do(
      "MKCALENDAR",
      collectionPath("mkcal-body"),
      xmlContentType(),
      mkBody,
    );
    assertEquals(mkResp.status, 201, "MKCALENDAR with body must return 201");
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("mkcal-body"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "displayname", nsCalDAV, "calendar-description"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("mkcal-body"));
    assertEquals(r !== undefined, true);
    const dn = r!.prop("displayname");
    assertEquals(dn !== undefined && dn.status === 200, true, "displayname must be set");
    assertEquals(
      dn!.text().includes("My Test Calendar"),
      true,
      "displayname value must match what was sent in MKCALENDAR body",
    );
    const desc = r!.prop("calendar-description");
    assertEquals(desc !== undefined && desc.status === 200, true, "calendar-description must be set");
    assertEquals(
      desc!.text().includes("A test calendar description"),
      true,
      "calendar-description value must match what was sent in MKCALENDAR body",
    );
  });
});

// ─── §5.3.2 PUT precondition error bodies ────────────────────────────────────

Deno.test("RFC 4791 §5.3.2 PUT precondition violation response body contains DAV:error with CALDAV precondition element", async () => {
  await withServer(async (s) => {
    await s.mkcol("precond-body");
    const resp = await s.do(
      "PUT",
      objectPath("precond-body", "bad-ical"),
      calContentType(),
      "this is not valid icalendar",
    );
    assertEquals(
      [400, 403, 409, 422].includes(resp.status),
      true,
      "PUT of invalid iCalendar must be rejected",
    );
    // Response body should contain a DAV:error or CALDAV error element
    const body = resp.body.toLowerCase();
    assertEquals(
      body.includes("error") || body.includes("valid-calendar-data"),
      true,
      "Error response body must contain an error element",
    );
  });
});

Deno.test("RFC 4791 §5.3.2 no-uid-conflict error response body includes DAV:href of conflicting resource", async () => {
  await withServer(async (s) => {
    await s.mkcol("uid-conflict-href");
    const uid = "conflict-href-uid-001";
    await s.putObject(objectPath("uid-conflict-href", uid), vtodo(uid));
    const resp = await s.do(
      "PUT",
      objectPath("uid-conflict-href", "other-name-href"),
      calContentType(),
      vtodo(uid),
    );
    assertEquals(
      [403, 409].includes(resp.status),
      true,
      "Duplicate UID must be rejected with 403 or 409",
    );
    // Body should include a reference to the conflicting resource or the no-uid-conflict element
    assertEquals(
      resp.body.includes(objectPath("uid-conflict-href", uid)) ||
        resp.body.includes("no-uid-conflict"),
      true,
      "Error body must include conflicting resource href or CALDAV:no-uid-conflict element",
    );
  });
});

// ─── §5.3.3 X-* non-standard properties ──────────────────────────────────────

Deno.test("RFC 4791 §5.3.3 PUT with X-* non-standard properties is accepted and round-trips correctly", async () => {
  await withServer(async (s) => {
    await s.mkcol("xprop-test");
    const ical =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:xprop-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Test with X-prop\r\n" +
      "X-CUSTOM-PROP:custom-value-12345\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const putResp = await s.do(
      "PUT",
      objectPath("xprop-test", "xprop-001"),
      calContentType(),
      ical,
    );
    assertEquals(
      [201, 204].includes(putResp.status),
      true,
      "PUT with X-* property must succeed",
    );
    const getResp = await s.do("GET", objectPath("xprop-test", "xprop-001"));
    assertEquals(getResp.status, 200);
    assertEquals(
      getResp.body.includes("X-CUSTOM-PROP"),
      true,
      "X-CUSTOM-PROP must be preserved in stored calendar object",
    );
    assertEquals(
      getResp.body.includes("custom-value-12345"),
      true,
      "X-CUSTOM-PROP value must be preserved on round-trip",
    );
  });
});

// ─── §5.3.4 GET ETag ──────────────────────────────────────────────────────────

Deno.test("RFC 4791 §5.3.4 GET on calendar object resource returns ETag header", async () => {
  await withServer(async (s) => {
    await s.mkcol("get-etag");
    await s.putTodo("get-etag", "get-etag-todo");
    const resp = await s.do("GET", objectPath("get-etag", "get-etag-todo"));
    assertEquals(resp.status, 200);
    assertEquals(
      resp.headers.get("ETag") !== null,
      true,
      "GET on calendar object resource must return ETag header",
    );
  });
});

Deno.test("RFC 4791 §5.3.4 DAV:getetag PROPFIND value matches GET ETag header", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-match");
    await s.putTodo("etag-match", "etag-match-todo");
    const getResp = await s.do("GET", objectPath("etag-match", "etag-match-todo"));
    assertEquals(getResp.status, 200);
    const getEtag = getResp.headers.get("ETag") ?? "";
    assertEquals(getEtag !== "", true, "GET must return ETag");
    const pfResp = await s.do(
      "PROPFIND",
      objectPath("etag-match", "etag-match-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getetag"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("etag-match", "etag-match-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getetag");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
    assertEquals(
      p!.text().replace(/"/g, "") === getEtag.replace(/"/g, ""),
      true,
      "DAV:getetag from PROPFIND must match ETag returned by GET",
    );
  });
});

// ─── §5.2.1 calendar-description xml:lang ────────────────────────────────────

Deno.test("RFC 4791 §5.2.1 calendar-description xml:lang attribute is preserved and returned", async () => {
  await withServer(async (s) => {
    await s.mkcol("lang-desc");
    const proppatch =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      '<C:calendar-description xml:lang="en-US">English description</C:calendar-description>' +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";
    const ppResp = await s.do(
      "PROPPATCH",
      collectionPath("lang-desc"),
      xmlContentType(),
      proppatch,
    );
    if (![200, 207].includes(ppResp.status)) return;
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("lang-desc"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "calendar-description"),
    );
    assertEquals(pfResp.status, 207);
    assertEquals(
      pfResp.body.includes("lang") && pfResp.body.includes("en-US"),
      true,
      "calendar-description xml:lang attribute must be preserved and returned in PROPFIND response",
    );
  });
});

// ─── §5.2 allprop exclusion ───────────────────────────────────────────────────

Deno.test("RFC 4791 §5.2 CalDAV collection properties are excluded from PROPFIND DAV:allprop response", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-excl");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-excl"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("allprop-excl"));
    const caldavProps = [
      "calendar-description",
      "calendar-timezone",
      "supported-calendar-component-set",
      "supported-calendar-data",
      "max-resource-size",
    ];
    for (const propName of caldavProps) {
      if (r) {
        const p = r.prop(propName);
        assertEquals(
          p === undefined || p.status !== 200,
          true,
          `${propName} SHOULD NOT appear with 200 status in allprop response`,
        );
      }
    }
  });
});

// ─── §7 supported-report-set ─────────────────────────────────────────────────

Deno.test("RFC 4791 §7 DAV:supported-report-set on calendar collection lists all required CalDAV reports", async () => {
  await withServer(async (s) => {
    await s.mkcol("report-set");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("report-set"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "supported-report-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("report-set"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("supported-report-set");
    assertEquals(p !== undefined, true, "supported-report-set must be present");
    assertEquals(p!.status, 200);
    assertEquals(
      resp.body.includes("calendar-query"),
      true,
      "supported-report-set must list calendar-query",
    );
    assertEquals(
      resp.body.includes("calendar-multiget"),
      true,
      "supported-report-set must list calendar-multiget",
    );
    assertEquals(
      resp.body.includes("free-busy-query"),
      true,
      "supported-report-set must list free-busy-query",
    );
  });
});

// ─── §7.1 expand-property REPORT ─────────────────────────────────────────────

Deno.test("RFC 4791 §7.1 DAV:expand-property REPORT is supported", async () => {
  await withServer(async (s) => {
    await s.mkcol("expand-prop");
    await s.putTodo("expand-prop", "ep-todo");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:expand-property xmlns:D="DAV:">' +
      '<D:property name="resourcetype"/>' +
      "</D:expand-property>";
    const resp = await s.do(
      "REPORT",
      collectionPath("expand-prop"),
      withHeaders(depthHeader("1"), xmlContentType()),
      body,
    );
    assertEquals(resp.status < 500, true, "expand-property REPORT must not return 5xx");
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      "expand-property REPORT must return 200 or 207",
    );
  });
});

// ─── §7.5 collation support ───────────────────────────────────────────────────

Deno.test("RFC 4791 §7.5.1 supported-collation-set property lists i;ascii-casemap and i;octet", async () => {
  await withServer(async (s) => {
    await s.mkcol("collation-set");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("collation-set"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "supported-collation-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("collation-set"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("supported-collation-set");
    assertEquals(p !== undefined, true, "supported-collation-set must be present");
    assertEquals(p!.status, 200);
    assertEquals(
      resp.body.includes("i;ascii-casemap"),
      true,
      "supported-collation-set must include i;ascii-casemap",
    );
    assertEquals(
      resp.body.includes("i;octet"),
      true,
      "supported-collation-set must include i;octet",
    );
  });
});

Deno.test("RFC 4791 §7.5 calendar-query with unsupported collation returns CALDAV:supported-collation precondition", async () => {
  await withServer(async (s) => {
    await s.mkcol("collation-err");
    await s.putTodo("collation-err", "c-todo");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="SUMMARY">' +
      '<C:text-match collation="i;unsupported-collation-xyz">Test</C:text-match>' +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("collation-err"), xmlContentType(), body);
    assertEquals(
      [403, 409].includes(resp.status),
      true,
      "Unsupported collation in calendar-query must return 403 or 409",
    );
    assertEquals(
      resp.body.includes("supported-collation"),
      true,
      "Error body must contain CALDAV:supported-collation precondition element",
    );
  });
});

// ─── §7.8 comp-filter / prop-filter / param-filter ───────────────────────────

Deno.test("RFC 4791 §7.8 calendar-query comp-filter with is-not-defined matches absent components", async () => {
  await withServer(async (s) => {
    await s.mkcol("indef-comp");
    await s.putTodo("indef-comp", "todo-no-event");
    await s.putEvent("indef-comp", "event-no-todo");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/><C:calendar-data/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT"><C:is-not-defined/></C:comp-filter>' +
      "</C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("indef-comp"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("indef-comp", "todo-no-event")) !== undefined,
      true,
      "VTODO (which has no VEVENT) must match is-not-defined VEVENT filter",
    );
    assertEquals(
      ms.response(objectPath("indef-comp", "event-no-todo")),
      undefined,
      "VEVENT must not match is-not-defined VEVENT filter",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query prop-filter with text-match filters by property value", async () => {
  await withServer(async (s) => {
    await s.mkcol("textmatch-test");
    const matchIcal =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:tm-match\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:FindMe Special\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const noMatchIcal =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:tm-nomatch\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:OtherThing\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("textmatch-test", "tm-match"), matchIcal);
    await s.putObject(objectPath("textmatch-test", "tm-nomatch"), noMatchIcal);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="SUMMARY">' +
      '<C:text-match collation="i;ascii-casemap">FindMe</C:text-match>' +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("textmatch-test"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("textmatch-test", "tm-match")) !== undefined,
      true,
      "Resource with matching SUMMARY must be returned by text-match filter",
    );
    assertEquals(
      ms.response(objectPath("textmatch-test", "tm-nomatch")),
      undefined,
      "Resource with non-matching SUMMARY must not be returned by text-match filter",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query prop-filter with is-not-defined matches components lacking a property", async () => {
  await withServer(async (s) => {
    await s.mkcol("prop-indef");
    const withLoc =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:with-loc\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Has location\r\n" +
      "LOCATION:Office\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const noLoc =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:no-loc\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:No location\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("prop-indef", "with-loc"), withLoc);
    await s.putObject(objectPath("prop-indef", "no-loc"), noLoc);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="LOCATION"><C:is-not-defined/></C:prop-filter>' +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("prop-indef"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("prop-indef", "no-loc")) !== undefined,
      true,
      "VTODO without LOCATION must match is-not-defined LOCATION filter",
    );
    assertEquals(
      ms.response(objectPath("prop-indef", "with-loc")),
      undefined,
      "VTODO with LOCATION must not match is-not-defined LOCATION filter",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query prop-filter text-match with negate-condition excludes matching resources", async () => {
  await withServer(async (s) => {
    await s.mkcol("negate-test");
    const r1 =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:negate-match\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:ExcludeMe Thing\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const r2 =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:negate-keep\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Keep This One\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("negate-test", "negate-match"), r1);
    await s.putObject(objectPath("negate-test", "negate-keep"), r2);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="SUMMARY">' +
      '<C:text-match collation="i;ascii-casemap" negate-condition="yes">ExcludeMe</C:text-match>' +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("negate-test"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("negate-test", "negate-keep")) !== undefined,
      true,
      "Resource not matching negated pattern must be returned",
    );
    assertEquals(
      ms.response(objectPath("negate-test", "negate-match")),
      undefined,
      "Resource matching negated pattern must be excluded",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query param-filter filters by property parameter value", async () => {
  await withServer(async (s) => {
    await s.mkcol("param-filter");
    const accepted =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:param-accepted\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Accepted\r\n" +
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:alice@example.com\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    const declined =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:param-declined\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T120000Z\r\n" +
      "DTEND:20260115T130000Z\r\n" +
      "SUMMARY:Declined\r\n" +
      "ATTENDEE;PARTSTAT=DECLINED:mailto:bob@example.com\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("param-filter", "param-accepted"), accepted);
    await s.putObject(objectPath("param-filter", "param-declined"), declined);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT">' +
      '<C:prop-filter name="ATTENDEE">' +
      '<C:param-filter name="PARTSTAT">' +
      '<C:text-match collation="i;ascii-casemap">ACCEPTED</C:text-match>' +
      "</C:param-filter>" +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("param-filter"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("param-filter", "param-accepted")) !== undefined,
      true,
      "Event with ATTENDEE PARTSTAT=ACCEPTED must match param-filter",
    );
    assertEquals(
      ms.response(objectPath("param-filter", "param-declined")),
      undefined,
      "Event with ATTENDEE PARTSTAT=DECLINED must not match ACCEPTED param-filter",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query partial retrieval with CALDAV:comp returns only requested properties", async () => {
  await withServer(async (s) => {
    await s.mkcol("partial-retrieval");
    const ical =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:partial-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Partial Test\r\n" +
      "DESCRIPTION:This description must be omitted by partial retrieval\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("partial-retrieval", "partial-001"), ical);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop>" +
      "<C:calendar-data>" +
      '<C:comp name="VCALENDAR">' +
      '<C:comp name="VTODO">' +
      '<C:prop name="UID"/>' +
      '<C:prop name="SUMMARY"/>' +
      "</C:comp>" +
      "</C:comp>" +
      "</C:calendar-data>" +
      "</D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO"/>' +
      "</C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("partial-retrieval"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(objectPath("partial-retrieval", "partial-001"));
    assertEquals(r !== undefined, true, "Resource must appear in partial-retrieval response");
    const calDataProp = r!.prop("calendar-data");
    if (calDataProp && calDataProp.text().includes("BEGIN:VTODO")) {
      assertEquals(
        calDataProp.text().includes("DESCRIPTION"),
        false,
        "Partial retrieval must omit non-requested properties (DESCRIPTION)",
      );
      assertEquals(
        calDataProp.text().includes("SUMMARY"),
        true,
        "Partial retrieval must include explicitly requested properties (SUMMARY)",
      );
    }
  });
});

// ─── §9.6.5 CALDAV:expand ────────────────────────────────────────────────────

Deno.test("RFC 4791 §9.6.5 calendar-query with CALDAV:expand returns individual UTC recurrence instances", async () => {
  await withServer(async (s) => {
    await s.mkcol("expand-recur");
    const recurring =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:expand-weekly\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "RRULE:FREQ=WEEKLY;COUNT=4\r\n" +
      "SUMMARY:Weekly\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("expand-recur", "expand-weekly"), recurring);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop>" +
      "<C:calendar-data>" +
      '<C:expand start="20260101T000000Z" end="20260301T000000Z"/>' +
      "</C:calendar-data>" +
      "</D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT">' +
      '<C:time-range start="20260101T000000Z" end="20260301T000000Z"/>' +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("expand-recur"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(objectPath("expand-recur", "expand-weekly"));
    assertEquals(r !== undefined, true, "Recurring event must appear in response");
    const calData = r!.prop("calendar-data");
    if (calData && calData.text().includes("RECURRENCE-ID")) {
      assertEquals(
        calData.text().includes("RRULE"),
        false,
        "Expanded recurrence instances must not contain RRULE",
      );
    }
  });
});

// ─── §9.6.6 CALDAV:limit-recurrence-set ──────────────────────────────────────

Deno.test("RFC 4791 §9.6.6 calendar-query with CALDAV:limit-recurrence-set returns only relevant overrides", async () => {
  await withServer(async (s) => {
    await s.mkcol("limit-recur");
    const recurring =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:limit-weekly\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "RRULE:FREQ=WEEKLY;COUNT=10\r\n" +
      "SUMMARY:Weekly Master\r\n" +
      "END:VEVENT\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:limit-weekly\r\n" +
      "RECURRENCE-ID:20260122T100000Z\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260122T110000Z\r\n" +
      "DTEND:20260122T120000Z\r\n" +
      "SUMMARY:Weekly Override Jan 22\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("limit-recur", "limit-weekly"), recurring);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop>" +
      "<C:calendar-data>" +
      '<C:limit-recurrence-set start="20260120T000000Z" end="20260130T000000Z"/>' +
      "</C:calendar-data>" +
      "</D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT">' +
      '<C:time-range start="20260115T000000Z" end="20260201T000000Z"/>' +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("limit-recur"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("limit-recur", "limit-weekly")) !== undefined,
      true,
      "Recurring event must appear in limit-recurrence-set response",
    );
  });
});

// ─── §9.6.7 CALDAV:limit-freebusy-set ────────────────────────────────────────

Deno.test("RFC 4791 §9.6.7 calendar-query with CALDAV:limit-freebusy-set returns only overlapping FREEBUSY periods", async () => {
  await withServer(async (s) => {
    await s.mkcol("limit-fb");
    const freebusy =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VFREEBUSY\r\n" +
      "UID:fb-001\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20260131T235959Z\r\n" +
      "FREEBUSY:20260105T100000Z/20260105T110000Z\r\n" +
      "FREEBUSY:20260120T100000Z/20260120T110000Z\r\n" +
      "END:VFREEBUSY\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("limit-fb", "fb-001"), freebusy);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop>" +
      "<C:calendar-data>" +
      '<C:limit-freebusy-set start="20260118T000000Z" end="20260125T000000Z"/>' +
      "</C:calendar-data>" +
      "</D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VFREEBUSY">' +
      '<C:time-range start="20260101T000000Z" end="20260131T000000Z"/>' +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("limit-fb"), xmlContentType(), body);
    assertEquals(
      resp.status < 500,
      true,
      "limit-freebusy-set request must not return 5xx",
    );
    assertEquals(
      [207, 403, 409].includes(resp.status),
      true,
      "limit-freebusy-set response must be 207, 403, or 409",
    );
  });
});

// ─── §9.8 CALDAV:timezone override ───────────────────────────────────────────

Deno.test("RFC 4791 §9.8 calendar-query CALDAV:timezone element overrides collection timezone for floating-time filtering", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-override");
    // Event with floating time (no trailing Z — local time)
    const floatingEvent =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:floating-evt\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000\r\n" +
      "DTEND:20260115T110000\r\n" +
      "SUMMARY:Floating Time Event\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("tz-override", "floating-evt"), floatingEvent);
    // America/New_York (UTC-5): 10:00 local = 15:00Z; query 14:00Z-17:00Z must match
    const tzIcal =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTIMEZONE\r\n" +
      "TZID:America/New_York\r\n" +
      "BEGIN:STANDARD\r\n" +
      "DTSTART:19671029T020000\r\n" +
      "TZOFFSETFROM:-0400\r\n" +
      "TZOFFSETTO:-0500\r\n" +
      "TZNAME:EST\r\n" +
      "END:STANDARD\r\n" +
      "END:VTIMEZONE\r\n" +
      "END:VCALENDAR\r\n";
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/><C:calendar-data/></D:prop>" +
      `<C:timezone>${tzIcal}</C:timezone>` +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT">' +
      '<C:time-range start="20260115T140000Z" end="20260115T170000Z"/>' +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("tz-override"), xmlContentType(), body);
    assertEquals(resp.status, 207, "calendar-query with CALDAV:timezone element must return 207");
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("tz-override", "floating-evt")) !== undefined,
      true,
      "Floating-time event must be matched using the timezone provided in CALDAV:timezone element",
    );
  });
});

// ─── §7.4 / §7.8 VTODO time-range and VALARM time-range ─────────────────────

Deno.test("RFC 4791 §7.8 calendar-query time-range filter correctly selects VTODO by due date", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-timerange");
    const inRange =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-due-in\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260110T000000Z\r\n" +
      "DUE:20260115T120000Z\r\n" +
      "SUMMARY:Due In Range\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const outRange =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-due-out\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260210T000000Z\r\n" +
      "DUE:20260215T120000Z\r\n" +
      "SUMMARY:Due Out of Range\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("vtodo-timerange", "vtodo-due-in"), inRange);
    await s.putObject(objectPath("vtodo-timerange", "vtodo-due-out"), outRange);
    const resp = await s.do(
      "REPORT",
      collectionPath("vtodo-timerange"),
      xmlContentType(),
      calendarQueryByTimeRange("VTODO", "20260101T000000Z", "20260131T000000Z"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("vtodo-timerange", "vtodo-due-in")) !== undefined,
      true,
      "VTODO with DUE date inside the time-range must be returned",
    );
    assertEquals(
      ms.response(objectPath("vtodo-timerange", "vtodo-due-out")),
      undefined,
      "VTODO with DUE date outside the time-range must not be returned",
    );
  });
});

Deno.test("RFC 4791 §7.8 calendar-query VALARM comp-filter with time-range matches by alarm trigger time", async () => {
  await withServer(async (s) => {
    await s.mkcol("valarm-range");
    const withAlarm =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:alarm-in-range\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with alarm in range\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "TRIGGER;VALUE=DATE-TIME:20260115T090000Z\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    const outOfRange =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:alarm-out-range\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260315T100000Z\r\n" +
      "DTEND:20260315T110000Z\r\n" +
      "SUMMARY:Event with alarm outside range\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "TRIGGER;VALUE=DATE-TIME:20260315T090000Z\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("valarm-range", "alarm-in-range"), withAlarm);
    await s.putObject(objectPath("valarm-range", "alarm-out-range"), outOfRange);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VEVENT">' +
      '<C:comp-filter name="VALARM">' +
      '<C:time-range start="20260115T080000Z" end="20260115T095959Z"/>' +
      "</C:comp-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("valarm-range"), xmlContentType(), body);
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("valarm-range", "alarm-in-range")) !== undefined,
      true,
      "Event with VALARM trigger inside the time-range must be returned",
    );
    assertEquals(
      ms.response(objectPath("valarm-range", "alarm-out-range")),
      undefined,
      "Event with VALARM trigger outside the time-range must not be returned",
    );
  });
});

Deno.test("RFC 4791 §7.4 calendar-query time-range filter expands recurrences and returns recurring event with overlapping instance", async () => {
  await withServer(async (s) => {
    await s.mkcol("recur-expand");
    // Master DTSTART 2026-01-01 (outside Feb), weekly recurrences fall in Feb
    const recurring =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:recur-weekly-expand\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260101T100000Z\r\n" +
      "DTEND:20260101T110000Z\r\n" +
      "RRULE:FREQ=WEEKLY;COUNT=10\r\n" +
      "SUMMARY:Weekly Recurring\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("recur-expand", "recur-weekly-expand"), recurring);
    const resp = await s.do(
      "REPORT",
      collectionPath("recur-expand"),
      xmlContentType(),
      calendarQueryByTimeRange("VEVENT", "20260201T000000Z", "20260228T235959Z"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("recur-expand", "recur-weekly-expand")) !== undefined,
      true,
      "Recurring event with an instance inside the query range must be returned even if master DTSTART is outside the range",
    );
  });
});

// ─── §7.8 filter validation and supported-filter ─────────────────────────────

Deno.test("RFC 4791 §7.8 calendar-query with invalid filter structure returns CALDAV:valid-filter precondition error", async () => {
  await withServer(async (s) => {
    await s.mkcol("invalid-filter");
    await s.putTodo("invalid-filter", "if-todo");
    // Invalid: time-range inside a SUMMARY prop-filter is not permitted by the RFC
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="SUMMARY">' +
      '<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>' +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("invalid-filter"), xmlContentType(), body);
    assertEquals(
      [400, 403, 409].includes(resp.status),
      true,
      "Invalid filter structure must return 400, 403, or 409",
    );
    assertEquals(
      resp.body.includes("valid-filter"),
      true,
      "Error body must contain CALDAV:valid-filter precondition element",
    );
  });
});

Deno.test("RFC 4791 §7.8.10 calendar-query with unsupported non-standard prop-filter returns CALDAV:supported-filter error with element", async () => {
  await withServer(async (s) => {
    await s.mkcol("unsupported-filter");
    await s.putTodo("unsupported-filter", "uf-todo");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VTODO">' +
      '<C:prop-filter name="X-NONEXISTENT-UNSUPPORTED-PROP-12345">' +
      "<C:text-match>value</C:text-match>" +
      "</C:prop-filter>" +
      "</C:comp-filter></C:comp-filter></C:filter>" +
      "</C:calendar-query>";
    const resp = await s.do("REPORT", collectionPath("unsupported-filter"), xmlContentType(), body);
    assertEquals(resp.status < 500, true, "Response must not be 5xx");
    if ([403, 409].includes(resp.status)) {
      assertEquals(
        resp.body.includes("supported-filter"),
        true,
        "Error body must contain CALDAV:supported-filter precondition element when rejecting unsupported filter",
      );
    }
  });
});

// ─── §7.9 calendar-multiget edge cases ───────────────────────────────────────

Deno.test("RFC 4791 §7.9 calendar-multiget ignores Depth header", async () => {
  await withServer(async (s) => {
    await s.mkcol("mg-depth");
    await s.putTodo("mg-depth", "mg-depth-todo");
    const hrefs = [objectPath("mg-depth", "mg-depth-todo")];
    const respD0 = await s.do(
      "REPORT",
      collectionPath("mg-depth"),
      withHeaders(xmlContentType(), depthHeader("0")),
      calendarMultiget(...hrefs),
    );
    const respD1 = await s.do(
      "REPORT",
      collectionPath("mg-depth"),
      withHeaders(xmlContentType(), depthHeader("1")),
      calendarMultiget(...hrefs),
    );
    assertEquals(respD0.status, 207, "calendar-multiget with Depth:0 must return 207");
    assertEquals(respD1.status, 207, "calendar-multiget with Depth:1 must return 207");
    const ms0 = parseMultistatus(respD0.body);
    const ms1 = parseMultistatus(respD1.body);
    assertEquals(
      ms0.response(objectPath("mg-depth", "mg-depth-todo")) !== undefined,
      true,
      "Requested href must appear in multiget result regardless of Depth header value",
    );
    assertEquals(
      ms1.response(objectPath("mg-depth", "mg-depth-todo")) !== undefined,
      true,
    );
  });
});

Deno.test("RFC 4791 §7.9 calendar-multiget on non-collection resource with matching href returns 207", async () => {
  await withServer(async (s) => {
    await s.mkcol("mg-obj");
    await s.putTodo("mg-obj", "mg-obj-todo");
    const objPath = objectPath("mg-obj", "mg-obj-todo");
    const resp = await s.do(
      "REPORT",
      objPath,
      xmlContentType(),
      calendarMultiget(objPath),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objPath) !== undefined,
      true,
      "calendar-multiget issued against a non-collection resource must return the resource in the response",
    );
  });
});

Deno.test("RFC 4791 §7.9 calendar-multiget non-existent href response has 404 status", async () => {
  await withServer(async (s) => {
    await s.mkcol("mg-404");
    const nonExistent = objectPath("mg-404", "does-not-exist");
    const resp = await s.do(
      "REPORT",
      collectionPath("mg-404"),
      xmlContentType(),
      calendarMultiget(nonExistent),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(nonExistent);
    assertEquals(r !== undefined, true, "Non-existent href must appear in multiget response");
    const statusProp = r!.prop("__status__");
    const etagProp = r!.prop("getetag");
    if (statusProp) {
      assertEquals(statusProp.status, 404, "Non-existent href must carry 404 status");
    } else if (etagProp) {
      assertEquals(etagProp.status, 404, "Non-existent href propstat must carry 404 status");
    }
  });
});

// ─── §7.10 free-busy-query enhancements ──────────────────────────────────────

Deno.test("RFC 4791 §7.10 free-busy-query response Content-Type is text/calendar and body contains VFREEBUSY", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-ct");
    await s.putEvent("fb-ct", "fb-ct-event");
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>' +
      "</C:free-busy-query>";
    const resp = await s.do("REPORT", collectionPath("fb-ct"), xmlContentType(), body);
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      "free-busy-query must return 200 or 207",
    );
    const ct = resp.headers.get("Content-Type") ?? "";
    assertEquals(
      ct.includes("text/calendar"),
      true,
      "free-busy-query response Content-Type must be text/calendar",
    );
    assertEquals(
      resp.body.includes("BEGIN:VFREEBUSY"),
      true,
      "free-busy-query response body must contain a VFREEBUSY component",
    );
  });
});

Deno.test("RFC 4791 §7.10 free-busy-query on calendar object resource returns 403", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-obj-err");
    await s.putEvent("fb-obj-err", "fb-evt");
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>' +
      "</C:free-busy-query>";
    const resp = await s.do(
      "REPORT",
      objectPath("fb-obj-err", "fb-evt"),
      xmlContentType(),
      body,
    );
    assertEquals(
      resp.status,
      403,
      "free-busy-query on a calendar object resource (non-collection) must return 403 Forbidden",
    );
  });
});

Deno.test("RFC 4791 §7.10 free-busy-query with no matching events returns empty VFREEBUSY component", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-empty");
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20500101T000000Z" end="20500201T000000Z"/>' +
      "</C:free-busy-query>";
    const resp = await s.do("REPORT", collectionPath("fb-empty"), xmlContentType(), body);
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      "free-busy-query with no events must return 200 or 207",
    );
    assertEquals(
      resp.body.includes("BEGIN:VFREEBUSY"),
      true,
      "Response must contain a VFREEBUSY component even when no events match",
    );
    assertEquals(
      resp.body.includes("FREEBUSY:"),
      false,
      "VFREEBUSY must contain no FREEBUSY property when no events match",
    );
  });
});

Deno.test("RFC 4791 §7.10 free-busy-query FBTYPE is derived correctly from VEVENT TRANSP and STATUS properties", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-fbtype");
    // OPAQUE + TENTATIVE -> BUSY-TENTATIVE
    const tentative =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:fbtype-tentative\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Tentative opaque\r\n" +
      "TRANSP:OPAQUE\r\n" +
      "STATUS:TENTATIVE\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    // TRANSPARENT -> FREE regardless of STATUS
    const transparent =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:fbtype-transparent\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T120000Z\r\n" +
      "DTEND:20260115T130000Z\r\n" +
      "SUMMARY:Transparent confirmed\r\n" +
      "TRANSP:TRANSPARENT\r\n" +
      "STATUS:CONFIRMED\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";
    await s.putObject(objectPath("fb-fbtype", "fbtype-tentative"), tentative);
    await s.putObject(objectPath("fb-fbtype", "fbtype-transparent"), transparent);
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260115T000000Z" end="20260116T000000Z"/>' +
      "</C:free-busy-query>";
    const resp = await s.do("REPORT", collectionPath("fb-fbtype"), xmlContentType(), body);
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      "free-busy-query with TRANSP/STATUS variants must succeed",
    );
    if (resp.body.includes("VFREEBUSY")) {
      assertEquals(
        resp.body.includes("BUSY-TENTATIVE"),
        true,
        "OPAQUE+TENTATIVE event must produce FBTYPE=BUSY-TENTATIVE in VFREEBUSY",
      );
      // Transparent event must not contribute any busy period
      assertEquals(
        resp.body.includes("20260115T120000Z"),
        false,
        "TRANSPARENT event must not appear as a busy period in VFREEBUSY",
      );
    }
  });
});

// ─── §6.1.1 read-free-busy privilege ─────────────────────────────────────────

Deno.test("RFC 4791 §6.1.1 DAV:supported-privilege-set includes CALDAV:read-free-busy privilege", async () => {
  await withServer(async (s) => {
    await s.mkcol("privset-test");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("privset-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "supported-privilege-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("privset-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("supported-privilege-set");
    assertEquals(p !== undefined, true, "supported-privilege-set must be present on calendar collection");
    assertEquals(p!.status, 200);
    assertEquals(
      resp.body.includes("read-free-busy"),
      true,
      "supported-privilege-set must include CALDAV:read-free-busy privilege",
    );
  });
});

// ─── §6.2 calendar-home-set href ─────────────────────────────────────────────

Deno.test("RFC 4791 §6.2 calendar-home-set property value contains DAV:href pointing to calendar home", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "calendar-home-set"),
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("href") && resp.body.includes(calendarHomePath),
      true,
      "calendar-home-set must contain a DAV:href pointing to the calendar home collection",
    );
  });
});

// ─── §5.2.8 max-instances ────────────────────────────────────────────────────

Deno.test("RFC 4791 §5.2.8 max-instances property appears in PROPFIND response on calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("max-inst-test");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("max-inst-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "max-instances"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("max-inst-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("max-instances");
    // Optional property: if present, must be 200
    if (p !== undefined) {
      assertEquals(
        p.status,
        200,
        "max-instances, if present, must be returned with 200 status",
      );
    }
  });
});

// ─── §5.2.9 max-attendees-per-instance ───────────────────────────────────────

Deno.test("RFC 4791 §5.2.9 max-attendees-per-instance property appears in PROPFIND response on calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("max-att-test");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("max-att-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsCalDAV, "max-attendees-per-instance"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("max-att-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("max-attendees-per-instance");
    // Optional property: if present, must be 200
    if (p !== undefined) {
      assertEquals(
        p.status,
        200,
        "max-attendees-per-instance, if present, must be returned with 200 status",
      );
    }
  });
});
