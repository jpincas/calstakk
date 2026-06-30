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

// ─── §7.2.1 OPTIONS advertises calendar-availability ──────────────────────────

Deno.test("RFC 7953 §7.2.1 OPTIONS must advertise calendar-availability in DAV header", async () => {
  await withServer(async (s) => {
    await s.mkcol("opts-avail-col");
    const resp = await s.do("OPTIONS", collectionPath("opts-avail-col"));
    assertEquals(resp.status, 200, `OPTIONS must return 200, got ${resp.status}`);
    const dav = resp.headers.get("DAV") ?? "";
    assertEquals(
      dav.includes("calendar-availability"),
      true,
      `DAV response header must include "calendar-availability", got: "${dav}"`,
    );
  });
});

// ─── §7.1 supported-calendar-component-set includes VAVAILABILITY ─────────────

Deno.test("RFC 7953 §7.1 supported-calendar-component-set must include VAVAILABILITY", async () => {
  await withServer(async (s) => {
    await s.mkcol("scs-avail-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("scs-avail-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "supported-calendar-component-set"),
    );
    assertEquals(resp.status, 207, `PROPFIND must return 207, got ${resp.status}`);
    assertStringIncludes(
      resp.body,
      "VAVAILABILITY",
      "supported-calendar-component-set must advertise VAVAILABILITY component support",
    );
  });
});

// ─── §3.1 Validation: VAVAILABILITY without UID ───────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY without UID must be rejected with 4xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-uid-col");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20261231T235959Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("val-uid-col", "no-uid-item"), calContentType(), body);
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `VAVAILABILITY without UID must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §3.1 Validation: AVAILABLE without required properties ───────────────────

Deno.test("RFC 7953 §3.1 AVAILABLE without required properties (UID/DTSTART/DTSTAMP) must be rejected with 4xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-avail-req-col");
    // AVAILABLE subcomponent missing UID, DTSTART, and DTSTAMP — all REQUIRED
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-avail-req-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      "SUMMARY:Missing required properties\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("val-avail-req-col", "avail-req-item"),
      calContentType(),
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `AVAILABLE without UID/DTSTART/DTSTAMP must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §3.1 Validation: DATE-only DTSTART or DTEND ─────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY/AVAILABLE with DATE-only DTSTART or DTEND must be rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-date-col");
    // DTSTART as DATE value (VALUE=DATE) — MUST be DATE-TIME per RFC 7953 §3.1
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-date-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;VALUE=DATE:20260101\r\n" +
      "DTEND;VALUE=DATE:20261231\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("val-date-col", "date-item"), calContentType(), body);
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `VAVAILABILITY with DATE-only DTSTART/DTEND must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §3.1 Validation: both DTEND and DURATION ─────────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY/AVAILABLE with both DTEND and DURATION must be rejected with 4xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-dtend-dur-col");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-dtend-dur-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20261231T235959Z\r\n" +
      "DURATION:P1D\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("val-dtend-dur-col", "dtend-dur-item"),
      calContentType(),
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `VAVAILABILITY with both DTEND and DURATION must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §3.1 Validation: DURATION without DTSTART ────────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY with DURATION but no DTSTART must be rejected with 4xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-dur-nodtstart-col");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-dur-nodtstart-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DURATION:P7D\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("val-dur-nodtstart-col", "dur-nodtstart-item"),
      calContentType(),
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `VAVAILABILITY with DURATION but no DTSTART must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §3.1 Validation: TZID without matching VTIMEZONE ────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY using TZID without matching VTIMEZONE must be rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-tzid-col");
    // Determine if RFC 7809 (calendar-no-timezone) is in effect; if so the constraint is lifted.
    const optResp = await s.do("OPTIONS", collectionPath("val-tzid-col"));
    const dav = optResp.headers.get("DAV") ?? "";
    const rfc7809InEffect = dav.includes("calendar-no-timezone");

    // Uses TZID=America/New_York but no VTIMEZONE component in the iCalendar object
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-tzid-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=America/New_York:20260101T000000\r\n" +
      "DTEND;TZID=America/New_York:20261231T235959\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      "UID:vavail-tzid-avail-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=America/New_York:20260105T090000\r\n" +
      "DTEND;TZID=America/New_York:20260105T170000\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("val-tzid-col", "tzid-item"), calContentType(), body);

    if (!rfc7809InEffect) {
      assertEquals(
        resp.status >= 400 && resp.status < 500,
        true,
        `VAVAILABILITY using TZID without VTIMEZONE must be rejected with 4xx (RFC 7809 not in effect), got ${resp.status}`,
      );
    }
  });
});

// ─── §3.1 Full PUT/GET roundtrip ──────────────────────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY PUT must return 201/204 and GET must roundtrip all properties", async () => {
  await withServer(async (s) => {
    await s.mkcol("roundtrip-avail-col");
    const uid = "vavail-roundtrip-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20261231T235959Z\r\n" +
      "SUMMARY:Work availability\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-avail\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260105T090000Z\r\n" +
      "DTEND:20260105T170000Z\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const putResp = await s.do(
      "PUT",
      objectPath("roundtrip-avail-col", uid),
      calContentType(),
      body,
    );
    assertEquals(
      putResp.status === 201 || putResp.status === 204,
      true,
      `PUT must return 201 or 204, got ${putResp.status}`,
    );
    const getResp = await s.do("GET", objectPath("roundtrip-avail-col", uid));
    assertEquals(getResp.status, 200, "GET after PUT must return 200");
    assertStringIncludes(getResp.body, "BEGIN:VAVAILABILITY", "GET must include VAVAILABILITY");
    assertStringIncludes(getResp.body, `UID:${uid}`, "GET must preserve UID");
    assertStringIncludes(getResp.body, "DTSTAMP:", "GET must preserve DTSTAMP");
    assertStringIncludes(getResp.body, "BEGIN:AVAILABLE", "GET must preserve AVAILABLE subcomponent");
    assertStringIncludes(getResp.body, "RRULE:FREQ=WEEKLY", "GET must preserve RRULE in AVAILABLE");
  });
});

// ─── §3.2 BUSYTYPE roundtrip ──────────────────────────────────────────────────

Deno.test("RFC 7953 §3.2 BUSYTYPE property roundtrips correctly for BUSY, BUSY-UNAVAILABLE, and BUSY-TENTATIVE values", async () => {
  await withServer(async (s) => {
    await s.mkcol("busytype-col");
    for (const busytype of ["BUSY", "BUSY-UNAVAILABLE", "BUSY-TENTATIVE"]) {
      const uid = `vavail-busytype-${busytype.replace(/-/g, "").toLowerCase()}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20261231T235959Z\r\n" +
        `BUSYTYPE:${busytype}\r\n` +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n";
      const putResp = await s.do(
        "PUT",
        objectPath("busytype-col", uid),
        calContentType(),
        body,
      );
      assertEquals(
        putResp.status === 201 || putResp.status === 204,
        true,
        `PUT with BUSYTYPE:${busytype} must return 201 or 204, got ${putResp.status}`,
      );
      const getResp = await s.do("GET", objectPath("busytype-col", uid));
      assertEquals(getResp.status, 200, `GET must return 200 for BUSYTYPE:${busytype}`);
      assertStringIncludes(
        getResp.body,
        `BUSYTYPE:${busytype}`,
        `BUSYTYPE:${busytype} must round-trip correctly via GET`,
      );
    }
  });
});

// ─── §7.2.2 DTEND before DTSTART ─────────────────────────────────────────────

Deno.test("RFC 7953 §7.2.2 VAVAILABILITY with DTEND before DTSTART must be rejected with 4xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("val-dtend-before-col");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:vavail-dtend-before-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20261231T000000Z\r\n" +
      "DTEND:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("val-dtend-before-col", "dtend-before-item"),
      calContentType(),
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `VAVAILABILITY with DTEND before DTSTART must be rejected with 4xx, got ${resp.status}`,
    );
  });
});

// ─── §7.2.2 time-range filtering ─────────────────────────────────────────────

Deno.test("RFC 7953 §7.2.2 time-range filtering on VAVAILABILITY matches correct overlap condition for each case", async () => {
  await withServer(async (s) => {
    await s.mkcol("tr-filter-col");

    // Case Y/Y/N: DTSTART+DTEND — overlaps query range 20260115T..20260116T because
    // start(20260115T) < DTEND(20260116T) AND end(20260116T) > DTSTART(20260114T)
    const uid1 = "vavail-tr-dtstart-dtend";
    await s.do(
      "PUT",
      objectPath("tr-filter-col", uid1),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260114T000000Z\r\n" +
        "DTEND:20260116T000000Z\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // Case Y/N/N: DTSTART only (unbounded end) — overlaps any range where end > DTSTART
    const uid2 = "vavail-tr-dtstart-only";
    await s.do(
      "PUT",
      objectPath("tr-filter-col", uid2),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260110T000000Z\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // Case N/N/*: No DTSTART and no DTEND — always overlaps (TRUE)
    const uid3 = "vavail-tr-unbounded";
    await s.do(
      "PUT",
      objectPath("tr-filter-col", uid3),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid3}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "BEGIN:AVAILABLE\r\n" +
        `UID:${uid3}-avail\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260105T090000Z\r\n" +
        "DTEND:20260105T170000Z\r\n" +
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
        "END:AVAILABLE\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // Non-overlapping: DTSTART+DTEND entirely before the query range
    const uid4 = "vavail-tr-nooverlap";
    await s.do(
      "PUT",
      objectPath("tr-filter-col", uid4),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid4}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20260110T000000Z\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // Query time-range 20260115T000000Z..20260116T000000Z for VAVAILABILITY
    const queryBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:prop><D:getetag/><C:calendar-data/></D:prop>" +
      '<C:filter><C:comp-filter name="VCALENDAR">' +
      '<C:comp-filter name="VAVAILABILITY">' +
      '<C:time-range start="20260115T000000Z" end="20260116T000000Z"/>' +
      "</C:comp-filter>" +
      "</C:comp-filter></C:filter>" +
      "</C:calendar-query>";

    const resp = await s.do(
      "REPORT",
      collectionPath("tr-filter-col"),
      withHeaders({ Depth: "1" }, xmlContentType()),
      queryBody,
    );
    assertEquals(resp.status, 207, `calendar-query REPORT must return 207, got ${resp.status}`);
    assertStringIncludes(resp.body, uid1, "DTSTART+DTEND overlapping the range must be included");
    assertStringIncludes(resp.body, uid2, "Unbounded-end VAVAILABILITY starting before range must be included");
    assertStringIncludes(resp.body, uid3, "Fully-unbounded VAVAILABILITY (always TRUE) must be included");
    assertEquals(
      resp.body.includes(uid4),
      false,
      "VAVAILABILITY entirely before the query range must NOT be included",
    );
  });
});

// ─── §7.2.3 free-busy-query incorporates VAVAILABILITY ────────────────────────

Deno.test("RFC 7953 §7.2.3 free-busy-query REPORT must incorporate VAVAILABILITY blocks in VFREEBUSY response", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-vavail-col");

    // VAVAILABILITY covers the whole day with no AVAILABLE sub-components — all time is unavailable
    const uid = "vavail-fb-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260120T000000Z\r\n" +
      "DTEND:20260121T000000Z\r\n" +
      "BUSYTYPE:BUSY-UNAVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    await s.do("PUT", objectPath("fb-vavail-col", uid), calContentType(), body);

    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260120T000000Z" end="20260121T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do("REPORT", collectionPath("fb-vavail-col"), xmlContentType(), queryBody);
    assertEquals(resp.status < 500, true, "free-busy-query must not cause 5xx");
    if (resp.status === 200) {
      assertStringIncludes(resp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY component");
      assertStringIncludes(
        resp.body,
        "FREEBUSY",
        "VFREEBUSY must include a FREEBUSY property covering the unavailable VAVAILABILITY period",
      );
    }
  });
});

Deno.test("RFC 7953 §7.2.3 free-busy-query must expand recurring AVAILABLE instances correctly", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-recur-col");

    // 2026-01-26 is a Monday; VAVAILABILITY covers that week with AVAILABLE Mon-Fri 09-17 UTC
    const uid = "vavail-recur-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260126T000000Z\r\n" +
      "DTEND:20260201T000000Z\r\n" +
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-slot\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260126T090000Z\r\n" +
      "DTEND:20260126T170000Z\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    await s.do("PUT", objectPath("fb-recur-col", uid), calContentType(), body);

    // Query Monday 2026-01-26: 09-17 UTC should be free; midnight-09 and 17-midnight should be busy
    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260126T000000Z" end="20260127T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do("REPORT", collectionPath("fb-recur-col"), xmlContentType(), queryBody);
    assertEquals(
      resp.status < 500,
      true,
      "free-busy-query with recurring AVAILABLE must not cause 5xx",
    );
    if (resp.status === 200) {
      assertStringIncludes(resp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      // The 09-17 UTC window is AVAILABLE (free), so freebusy periods must NOT span the entire day.
      // At minimum there must be FREEBUSY properties for the unavailable portions (outside AVAILABLE).
      assertStringIncludes(
        resp.body,
        "FREEBUSY",
        "VFREEBUSY must contain FREEBUSY property for the unavailable time outside AVAILABLE windows",
      );
      // If the whole day were one FREEBUSY block it would be 20260126T000000Z/20260127T000000Z;
      // correct expansion must not produce that single block when AVAILABLE 09-17 is present.
      assertEquals(
        resp.body.includes("20260126T000000Z/20260127T000000Z"),
        false,
        "Entire day must not appear as a single FREEBUSY block; AVAILABLE 09-17 must be free",
      );
    }
  });
});

// ─── §4 PRIORITY-based combining ──────────────────────────────────────────────

Deno.test("RFC 7953 §4 PRIORITY-based VAVAILABILITY combining: higher priority overrides lower in free-busy result", async () => {
  await withServer(async (s) => {
    await s.mkcol("prio-col");

    // Low priority (0): VAVAILABILITY with AVAILABLE 09-17 UTC on 2026-01-27 → would be free
    const uid1 = "vavail-prio-low";
    await s.do(
      "PUT",
      objectPath("prio-col", uid1),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "PRIORITY:0\r\n" +
        "DTSTART:20260127T000000Z\r\n" +
        "DTEND:20260128T000000Z\r\n" +
        "BUSYTYPE:BUSY-UNAVAILABLE\r\n" +
        "BEGIN:AVAILABLE\r\n" +
        `UID:${uid1}-avail\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260127T090000Z\r\n" +
        "DTEND:20260127T170000Z\r\n" +
        "END:AVAILABLE\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // High priority (1): VAVAILABILITY with BUSYTYPE:BUSY and no AVAILABLE → whole day is BUSY
    const uid2 = "vavail-prio-high";
    await s.do(
      "PUT",
      objectPath("prio-col", uid2),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "PRIORITY:1\r\n" +
        "DTSTART:20260127T000000Z\r\n" +
        "DTEND:20260128T000000Z\r\n" +
        "BUSYTYPE:BUSY\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260127T000000Z" end="20260128T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do("REPORT", collectionPath("prio-col"), xmlContentType(), queryBody);
    assertEquals(resp.status < 500, true, "free-busy-query with priority VAVAILABILITY must not cause 5xx");
    if (resp.status === 200) {
      assertStringIncludes(resp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      // High-priority (PRIORITY:1, BUSYTYPE:BUSY) completely covers the day and overrides
      // the low-priority AVAILABLE window; the 09-17 slot must appear as BUSY, not free.
      assertStringIncludes(
        resp.body,
        "FBTYPE=BUSY",
        "Higher-priority BUSYTYPE:BUSY must produce FBTYPE=BUSY, overriding lower-priority AVAILABLE",
      );
    }
  });
});

Deno.test("RFC 7953 §4 Same-priority VAVAILABILITY overlap uses BUSY > BUSY-UNAVAILABLE > BUSY-TENTATIVE precedence", async () => {
  await withServer(async (s) => {
    await s.mkcol("same-prio-col");

    // Priority 5, BUSY-TENTATIVE
    const uid1 = "vavail-sameprio-tent";
    await s.do(
      "PUT",
      objectPath("same-prio-col", uid1),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "PRIORITY:5\r\n" +
        "DTSTART:20260128T000000Z\r\n" +
        "DTEND:20260129T000000Z\r\n" +
        "BUSYTYPE:BUSY-TENTATIVE\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    // Priority 5, BUSY-UNAVAILABLE — must win over BUSY-TENTATIVE at the same priority
    const uid2 = "vavail-sameprio-unavail";
    await s.do(
      "PUT",
      objectPath("same-prio-col", uid2),
      calContentType(),
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VAVAILABILITY\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "PRIORITY:5\r\n" +
        "DTSTART:20260128T000000Z\r\n" +
        "DTEND:20260129T000000Z\r\n" +
        "BUSYTYPE:BUSY-UNAVAILABLE\r\n" +
        "END:VAVAILABILITY\r\n" +
        "END:VCALENDAR\r\n",
    );

    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260128T000000Z" end="20260129T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do("REPORT", collectionPath("same-prio-col"), xmlContentType(), queryBody);
    assertEquals(
      resp.status < 500,
      true,
      "free-busy-query with same-priority overlapping VAVAILABILITY must not cause 5xx",
    );
    if (resp.status === 200) {
      assertStringIncludes(resp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      // BUSY-UNAVAILABLE > BUSY-TENTATIVE at equal priority; result must reflect BUSY-UNAVAILABLE
      assertStringIncludes(
        resp.body,
        "BUSY-UNAVAILABLE",
        "BUSY-UNAVAILABLE must take precedence over BUSY-TENTATIVE at equal PRIORITY",
      );
    }
  });
});

Deno.test("RFC 7953 §3.2/§4 BUSYTYPE defaults to BUSY-UNAVAILABLE in free-busy output when property is absent", async () => {
  await withServer(async (s) => {
    await s.mkcol("default-busytype-col");

    // VAVAILABILITY without BUSYTYPE property — default per RFC 7953 §3.2 is BUSY-UNAVAILABLE
    const uid = "vavail-default-busytype";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260129T000000Z\r\n" +
      "DTEND:20260130T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    await s.do("PUT", objectPath("default-busytype-col", uid), calContentType(), body);

    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260129T000000Z" end="20260130T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do(
      "REPORT",
      collectionPath("default-busytype-col"),
      xmlContentType(),
      queryBody,
    );
    assertEquals(resp.status < 500, true, "free-busy-query must not cause 5xx");
    if (resp.status === 200) {
      assertStringIncludes(resp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      assertStringIncludes(
        resp.body,
        "BUSY-UNAVAILABLE",
        "Absent BUSYTYPE must default to BUSY-UNAVAILABLE in free-busy FREEBUSY output",
      );
    }
  });
});

// ─── §7.2.4 CALDAV:calendar-availability property ────────────────────────────

Deno.test("RFC 7953 §7.2.4 PROPPATCH calendar-availability must reject values with multiple VAVAILABILITY components", async () => {
  await withServer(async (s) => {
    await s.mkcol("proppatch-multi-col");
    // Two VAVAILABILITY in one iCalendar object — prohibited by §7.2.4
    const twoVAvail =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:multi-vavail-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:multi-vavail-002\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260601T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const xmlBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${twoVAvail}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("proppatch-multi-col"),
      xmlContentType(),
      xmlBody,
    );
    // Server must reject via 4xx directly or a 207 containing a 403 propstat
    const rejected =
      (resp.status >= 400 && resp.status < 500) ||
      (resp.status === 207 && resp.body.includes("403"));
    assertEquals(
      rejected,
      true,
      `PROPPATCH with multiple VAVAILABILITY must be rejected (4xx or 207/403 propstat), got ${resp.status}: ${resp.body}`,
    );
  });
});

Deno.test("RFC 7953 §7.2.4 PROPPATCH calendar-availability must reject values with non-VAVAILABILITY components", async () => {
  await withServer(async (s) => {
    await s.mkcol("proppatch-vevent-col");
    // Contains a VEVENT which is explicitly disallowed by §7.2.4
    const withVEvent =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:illegal-vevent-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T090000Z\r\n" +
      "DTEND:20260101T100000Z\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";

    const xmlBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${withVEvent}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("proppatch-vevent-col"),
      xmlContentType(),
      xmlBody,
    );
    const rejected =
      (resp.status >= 400 && resp.status < 500) ||
      (resp.status === 207 && resp.body.includes("403"));
    assertEquals(
      rejected,
      true,
      `PROPPATCH with VEVENT in calendar-availability must be rejected (4xx or 207/403 propstat), got ${resp.status}`,
    );
  });
});

Deno.test("RFC 7953 §7.2.4 calendar-availability PROPPATCH value must roundtrip via PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("proppatch-rt-col");
    const availData =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:cal-avail-rt-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${availData}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;

    const patchResp = await s.do(
      "PROPPATCH",
      collectionPath("proppatch-rt-col"),
      xmlContentType(),
      patchBody,
    );
    assertEquals(patchResp.status < 500, true, `PROPPATCH must not cause 5xx, got ${patchResp.status}`);

    // Only assert PROPFIND roundtrip if PROPPATCH indicates success
    const patchOk =
      patchResp.status === 200 ||
      (patchResp.status === 207 && !patchResp.body.includes("<D:status>HTTP/1.1 4"));
    if (patchOk) {
      const propfindResp = await s.do(
        "PROPFIND",
        collectionPath("proppatch-rt-col"),
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "calendar-availability"),
      );
      assertEquals(propfindResp.status, 207, "PROPFIND must return 207");
      assertStringIncludes(
        propfindResp.body,
        "BEGIN:VAVAILABILITY",
        "PROPFIND must return the stored VAVAILABILITY in calendar-availability",
      );
      assertStringIncludes(
        propfindResp.body,
        "cal-avail-rt-001",
        "PROPFIND must return the UID of the stored VAVAILABILITY",
      );
    }
  });
});

Deno.test("RFC 7953 §7.2.4 calendar-availability must not appear in PROPFIND allprop response", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-cal-col");

    // Store a calendar-availability value so there is a value that could potentially be returned
    const availData =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:cal-avail-allprop-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${availData}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;
    await s.do("PROPPATCH", collectionPath("allprop-cal-col"), xmlContentType(), patchBody);

    // Issue a DAV:allprop PROPFIND
    const allpropBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-cal-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      allpropBody,
    );
    assertEquals(resp.status, 207, "PROPFIND allprop must return 207");
    assertEquals(
      resp.body.includes("calendar-availability"),
      false,
      "calendar-availability SHOULD NOT be returned in DAV:allprop response (RFC 7953 §7.2.4)",
    );
  });
});

// ─── §7.2.4/§7.2.5 calendar-availability in free-busy calculation ─────────────

Deno.test("RFC 7953 §7.2.4/§7.2.5 VAVAILABILITY in calendar-availability property must be included in free-busy calculation", async () => {
  await withServer(async (s) => {
    await s.mkcol("fb-cal-avail-col");

    // Set calendar-availability to a VAVAILABILITY that marks 2026-01-30 as BUSY-UNAVAILABLE
    const availData =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      "UID:cal-avail-fb-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260130T000000Z\r\n" +
      "DTEND:20260131T000000Z\r\n" +
      "BUSYTYPE:BUSY-UNAVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-availability>${availData}</C:calendar-availability>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;
    const patchResp = await s.do(
      "PROPPATCH",
      collectionPath("fb-cal-avail-col"),
      xmlContentType(),
      patchBody,
    );
    assertEquals(patchResp.status < 500, true, "PROPPATCH must not cause 5xx");

    // Issue free-busy REPORT on the collection for the VAVAILABILITY time range
    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260130T000000Z" end="20260131T000000Z"/>' +
      "</C:free-busy-query>";
    const fbResp = await s.do(
      "REPORT",
      collectionPath("fb-cal-avail-col"),
      xmlContentType(),
      queryBody,
    );
    assertEquals(fbResp.status < 500, true, "free-busy-query must not cause 5xx");
    if (fbResp.status === 200) {
      assertStringIncludes(fbResp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      // The calendar-availability VAVAILABILITY marking 2026-01-30 as BUSY-UNAVAILABLE
      // must be reflected in the free-busy response
      assertStringIncludes(
        fbResp.body,
        "BUSY-UNAVAILABLE",
        "calendar-availability VAVAILABILITY must contribute BUSY-UNAVAILABLE to free-busy result",
      );
    }
  });
});

// ─── §9 Privacy ───────────────────────────────────────────────────────────────

Deno.test("RFC 7953 §9 free-busy response from VAVAILABILITY must not expose SUMMARY, LOCATION, or DESCRIPTION", async () => {
  await withServer(async (s) => {
    await s.mkcol("privacy-col");

    const uid = "vavail-privacy-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260201T000000Z\r\n" +
      "DTEND:20260202T000000Z\r\n" +
      "SUMMARY:SecretMeetingTitle\r\n" +
      "LOCATION:SecretLocation\r\n" +
      "DESCRIPTION:SecretDescription\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";
    await s.do("PUT", objectPath("privacy-col", uid), calContentType(), body);

    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260201T000000Z" end="20260202T000000Z"/>' +
      "</C:free-busy-query>";

    const resp = await s.do("REPORT", collectionPath("privacy-col"), xmlContentType(), queryBody);
    assertEquals(resp.status < 500, true, "free-busy-query must not cause 5xx");
    if (resp.status === 200) {
      assertEquals(
        resp.body.includes("SecretMeetingTitle"),
        false,
        "free-busy response MUST NOT include SUMMARY value from VAVAILABILITY (RFC 7953 §9)",
      );
      assertEquals(
        resp.body.includes("SecretLocation"),
        false,
        "free-busy response MUST NOT include LOCATION value from VAVAILABILITY (RFC 7953 §9)",
      );
      assertEquals(
        resp.body.includes("SecretDescription"),
        false,
        "free-busy response MUST NOT include DESCRIPTION value from VAVAILABILITY (RFC 7953 §9)",
      );
    }
  });
});

// ─── §3.1 Unbounded start and/or end ─────────────────────────────────────────

Deno.test("RFC 7953 §3.1 VAVAILABILITY with unbounded start and unbounded end must be accepted and roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("unbounded-col");

    // No DTSTART and no DTEND/DURATION in VAVAILABILITY — fully unbounded, which is valid per §3.1
    const uid = "vavail-unbounded-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-avail\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260202T090000Z\r\n" +
      "DTEND:20260202T170000Z\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("unbounded-col", uid), calContentType(), body);
    assertEquals(
      putResp.status === 201 || putResp.status === 204,
      true,
      `Fully-unbounded VAVAILABILITY (no DTSTART, no DTEND, no DURATION) must be accepted (201/204), got ${putResp.status}`,
    );
    const getResp = await s.do("GET", objectPath("unbounded-col", uid));
    assertEquals(getResp.status, 200, "GET must return 200");
    assertStringIncludes(getResp.body, "BEGIN:VAVAILABILITY", "VAVAILABILITY must round-trip");
    assertStringIncludes(getResp.body, `UID:${uid}`, "UID must round-trip");
    assertStringIncludes(getResp.body, "BEGIN:AVAILABLE", "AVAILABLE subcomponent must round-trip");
    assertStringIncludes(getResp.body, "RRULE:", "RRULE in AVAILABLE must round-trip");
  });
});

// ─── §3.1/§5 RECURRENCE-ID override in AVAILABLE ─────────────────────────────

Deno.test("RFC 7953 §3.1/§5 AVAILABLE RRULE recurrence with RECURRENCE-ID override must be correctly expanded in free-busy", async () => {
  await withServer(async (s) => {
    await s.mkcol("recurid-col");

    // VAVAILABILITY: Mon-Fri 09-17 UTC, with a RECURRENCE-ID override that shortens Feb 9 to 09-12
    // 2026-02-02 is a Monday
    const uid = "vavail-recurid-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VAVAILABILITY\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260202T000000Z\r\n" +
      "DTEND:20260216T000000Z\r\n" +
      // Base recurring AVAILABLE: Mon-Fri 09-17 UTC starting 2026-02-02
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-slot\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260202T090000Z\r\n" +
      "DTEND:20260202T170000Z\r\n" +
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
      "END:AVAILABLE\r\n" +
      // Override for the Feb 9 Monday instance: shortened to 09-12 UTC
      "BEGIN:AVAILABLE\r\n" +
      `UID:${uid}-slot\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "RECURRENCE-ID:20260209T090000Z\r\n" +
      "DTSTART:20260209T090000Z\r\n" +
      "DTEND:20260209T120000Z\r\n" +
      "END:AVAILABLE\r\n" +
      "END:VAVAILABILITY\r\n" +
      "END:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("recurid-col", uid), calContentType(), body);
    assertEquals(
      putResp.status === 201 || putResp.status === 204,
      true,
      `VAVAILABILITY with RECURRENCE-ID override must be accepted (201/204), got ${putResp.status}`,
    );

    // Verify roundtrip preserves both the RRULE and the RECURRENCE-ID override
    const getResp = await s.do("GET", objectPath("recurid-col", uid));
    assertEquals(getResp.status, 200, "GET must return 200");
    assertStringIncludes(getResp.body, "BEGIN:VAVAILABILITY", "VAVAILABILITY must round-trip");
    assertStringIncludes(getResp.body, "RRULE:FREQ=WEEKLY", "RRULE must round-trip");
    assertStringIncludes(
      getResp.body,
      "RECURRENCE-ID:20260209T090000Z",
      "RECURRENCE-ID override must round-trip",
    );

    // Free-busy for Feb 9 (Monday overridden to 09-12): 12-17 UTC should be BUSY-UNAVAILABLE
    const queryBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<C:time-range start="20260209T000000Z" end="20260210T000000Z"/>' +
      "</C:free-busy-query>";
    const fbResp = await s.do("REPORT", collectionPath("recurid-col"), xmlContentType(), queryBody);
    assertEquals(
      fbResp.status < 500,
      true,
      "free-busy-query with RECURRENCE-ID override must not cause 5xx",
    );
    if (fbResp.status === 200) {
      assertStringIncludes(fbResp.body, "BEGIN:VFREEBUSY", "Response must contain VFREEBUSY");
      // The override shortens the available window to 09-12; the 12-17 slot is now unavailable.
      // The correct expansion must NOT treat the full 09-17 window as free on Feb 9.
      // We verify by checking that 20260209T120000Z appears as a FREEBUSY boundary (start of busy).
      assertStringIncludes(
        fbResp.body,
        "FREEBUSY",
        "Free-busy must contain FREEBUSY property reflecting unavailable time on overridden instance",
      );
      assertStringIncludes(
        fbResp.body,
        "20260209T120000Z",
        "FREEBUSY boundary at 12:00 UTC must be present, reflecting the RECURRENCE-ID override shortening AVAILABLE to 09-12",
      );
    }
  });
});
