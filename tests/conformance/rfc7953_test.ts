// RFC 7953 — Calendar Availability
// Spec: specs/rfc7953.txt
//
// Coverage:
//   §3   VAVAILABILITY component
//   §4   AVAILABLE sub-component
//   §5   Interaction with free-busy reports
//   §6   New CalDAV properties (calendar-availability)

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  calContentType,
  collectionPath,
  nsCalDAV,
  objectPath,
  parseMultistatus,
  propfindProps,
  testDTSTAMP,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §3 VAVAILABILITY component ───────────────────────────────────────────────

Deno.test("RFC 7953 §3 VAVAILABILITY PUT must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("avail-col");
    const uid = "avail-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20261231T235959Z\r\n" +
      "SUMMARY:Work Hours\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-avail\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=Europe/London:20260101T090000\r\n" +
      "DTEND;TZID=Europe/London:20260101T170000\r\n" +
      "SUMMARY:Available\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("avail-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "PUT with VAVAILABILITY must not cause 5xx");

    if (resp.status === 201) {
      const getResp = await s.do("GET", objectPath("avail-col", uid));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, "BEGIN:VAVAILABILITY", "VAVAILABILITY must round-trip");
      assertStringIncludes(getResp.body, "BEGIN:AVAILABLE", "AVAILABLE sub-component must round-trip");
    }
  });
});

Deno.test("RFC 7953 §3.1 VAVAILABILITY without UID must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("avail-uid-col");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const resp = await s.do(
      "PUT",
      objectPath("avail-uid-col", "no-uid"),
      calContentType(),
      body,
    );
    assertEquals(resp.status < 500, true, "VAVAILABILITY without UID must not cause 5xx");
  });
});

// ─── §4 AVAILABLE sub-component ───────────────────────────────────────────────

Deno.test("RFC 7953 §4 VAVAILABILITY with AVAILABLE sub-component must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("avail-sub-col");
    const uid = "avail-sub-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-slot1\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260104T090000Z\r\n" +
      "DTEND:20260104T170000Z\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("avail-sub-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "VAVAILABILITY with AVAILABLE must not cause 5xx");
  });
});

// ─── §6 Calendar availability property ────────────────────────────────────────

Deno.test("RFC 7953 §6.1 calendar-availability appears in PROPFIND on collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("avail-prop-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("avail-prop-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-availability"),
    );
    assertEquals(resp.status, 207);
    const r = parseMultistatus(resp.body).response(collectionPath("avail-prop-col"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("calendar-availability") !== undefined,
      true,
      "calendar-availability must appear in PROPFIND propstat",
    );
  });
});

Deno.test("RFC 7953 §6.1 PROPPATCH calendar-availability must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("avail-proppatch-col");
    const availData =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:cal-avail-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${availData}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("avail-proppatch-col"),
      xmlContentType(),
      body,
    );
    assertEquals(
      resp.status < 500,
      true,
      "PROPPATCH calendar-availability must not cause 5xx",
    );
  });
});

// ─── §5 Free-busy interaction ──────────────────────────────────────────────────

Deno.test("RFC 7953 §5 free-busy-query with VAVAILABILITY context must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-avail-col");
    await s.putEvent("fb-avail-col", "fb-avail-evt");

    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<C:time-range start="20260115T000000Z" end="20260116T000000Z"/>` +
      `</C:free-busy-query>`;

    const resp = await s.do(
      "REPORT",
      collectionPath("fb-avail-col"),
      xmlContentType(),
      body,
    );
    assertEquals(
      resp.status < 500,
      true,
      "free-busy-query with VAVAILABILITY context must not cause 5xx",
    );
  });
});
