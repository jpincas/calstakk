// RFC 7809 — Calendaring Extensions to WebDAV (CalDAV): Time Zones by Reference
// Spec: specs/rfc7809.txt
//
// Coverage:
//   §4   New CalDAV properties (calendar-timezone-id, timezone-service-set,
//        supported-calendar-data, timezone-collection-set)
//   §5   Referencing timezones by TZID without embedding VTIMEZONE

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  calContentType,
  collectionPath,
  nsCalDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindProps,
  testDTSTAMP,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §4 New CalDAV properties ─────────────────────────────────────────────────

Deno.test("RFC 7809 §4.1 timezone-service-set appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "timezone-service-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("timezone-service-set") !== undefined,
      true,
      "timezone-service-set must appear in PROPFIND propstat",
    );
  });
});

Deno.test("RFC 7809 §4.2 calendar-timezone-id appears in PROPFIND on collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzid-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("tzid-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-timezone-id"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("tzid-col"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("calendar-timezone-id") !== undefined,
      true,
      "calendar-timezone-id must appear in PROPFIND propstat",
    );
  });
});

Deno.test("RFC 7809 §4.2 PROPPATCH calendar-timezone-id must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzid-set-col");
    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-timezone-id>Europe/London</C:calendar-timezone-id>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;

    const resp = await s.do("PROPPATCH", collectionPath("tzid-set-col"), xmlContentType(), body);
    assertEquals(resp.status < 500, true, "PROPPATCH calendar-timezone-id must not cause 5xx");

    if (resp.status === 207) {
      const pfResp = await s.do(
        "PROPFIND",
        collectionPath("tzid-set-col"),
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "calendar-timezone-id"),
      );
      const p = parseMultistatus(pfResp.body)
        .response(collectionPath("tzid-set-col"))
        ?.prop("calendar-timezone-id");
      if (p && p.status === 200) {
        assertEquals(p.text(), "Europe/London", "calendar-timezone-id must store PROPPATCH value");
      }
    }
  });
});

Deno.test("RFC 7809 §4.3 supported-calendar-data appears in PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzref-scd-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("tzref-scd-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "supported-calendar-data"),
    );
    assertEquals(resp.status, 207);
    const r = parseMultistatus(resp.body).response(collectionPath("tzref-scd-col"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("supported-calendar-data") !== undefined,
      true,
      "supported-calendar-data must appear in PROPFIND",
    );
  });
});

Deno.test("RFC 7809 §6 timezone-collection-set appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "timezone-collection-set"),
    );
    assertEquals(resp.status, 207);
    const r = parseMultistatus(resp.body).response(principalPath);
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("timezone-collection-set") !== undefined,
      true,
      "timezone-collection-set must appear in PROPFIND propstat",
    );
  });
});

// ─── §5 Timezone references in calendar data ──────────────────────────────────

Deno.test("RFC 7809 §5 PUT with TZID but no VTIMEZONE must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzbyref-col");
    const uid = "tzref-event-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=Europe/London:20260115T100000\r\n" +
      "DTEND;TZID=Europe/London:20260115T110000\r\n" +
      "SUMMARY:TZ by Reference Test\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("tzbyref-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "PUT with TZID but no VTIMEZONE must not cause 5xx");
  });
});

Deno.test("RFC 7809 §5 PUT with embedded VTIMEZONE always accepted (201)", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtimezone-col");
    const uid = "vtimezone-event-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTIMEZONE\r\n" +
      "TZID:Europe/London\r\n" +
      "BEGIN:STANDARD\r\n" +
      "DTSTART:19701025T010000\r\n" +
      "TZOFFSETFROM:+0100\r\n" +
      "TZOFFSETTO:+0000\r\n" +
      "TZNAME:GMT\r\n" +
      "END:STANDARD\r\n" +
      "BEGIN:DAYLIGHT\r\n" +
      "DTSTART:19700329T010000\r\n" +
      "TZOFFSETFROM:+0000\r\n" +
      "TZOFFSETTO:+0100\r\n" +
      "TZNAME:BST\r\n" +
      "END:DAYLIGHT\r\n" +
      "END:VTIMEZONE\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=Europe/London:20260115T100000\r\n" +
      "DTEND;TZID=Europe/London:20260115T110000\r\n" +
      "SUMMARY:Embedded VTIMEZONE Test\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("vtimezone-col", uid), calContentType(), body);
    assertEquals(resp.status, 201, "PUT with embedded VTIMEZONE must always succeed");

    const getResp = await s.do("GET", objectPath("vtimezone-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "BEGIN:VTIMEZONE");
  });
});
