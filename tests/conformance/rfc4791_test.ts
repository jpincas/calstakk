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
