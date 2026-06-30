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
  calendarHomePath,
  calendarMultiget,
  collectionPath,
  nsCalDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindAllprop,
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

// ─── §3.1.1 calendar-no-timezone in DAV response header ──────────────────────

Deno.test("RFC 7809 §3.1.1 OPTIONS on calendar home collection includes calendar-no-timezone in DAV header", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", calendarHomePath);
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? "";
    assertEquals(
      dav.includes("calendar-no-timezone"),
      true,
      `DAV header '${dav}' must include 'calendar-no-timezone'`,
    );
  });
});

Deno.test("RFC 7809 §3.1.1 OPTIONS on calendar collection includes calendar-no-timezone in DAV header", async () => {
  await withServer(async (s) => {
    await s.mkcol("calntz-col");
    const resp = await s.do("OPTIONS", collectionPath("calntz-col"));
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? "";
    assertEquals(
      dav.includes("calendar-no-timezone"),
      true,
      `DAV header '${dav}' must include 'calendar-no-timezone' on calendar collection`,
    );
  });
});

// ─── §3.1.3 CalDAV-Timezones request header behaviour ────────────────────────

// Helper: build a VCALENDAR with an embedded Europe/London VTIMEZONE and a VEVENT using it.
function vcalWithVtimezone(uid: string): string {
  return (
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
    "DTSTART;TZID=Europe/London:20260601T100000\r\n" +
    "DTEND;TZID=Europe/London:20260601T110000\r\n" +
    "SUMMARY:TZ Header Test\r\n" +
    "END:VEVENT\r\nEND:VCALENDAR\r\n"
  );
}

// Helper: VCALENDAR using a non-standard/unknown TZID.
function vcalWithUnknownTzid(uid: string): string {
  return (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
    "BEGIN:VTIMEZONE\r\n" +
    "TZID:X-Custom/Unknown\r\n" +
    "BEGIN:STANDARD\r\n" +
    "DTSTART:19701025T010000\r\n" +
    "TZOFFSETFROM:+0100\r\n" +
    "TZOFFSETTO:+0000\r\n" +
    "END:STANDARD\r\n" +
    "END:VTIMEZONE\r\n" +
    "BEGIN:VEVENT\r\n" +
    `UID:${uid}\r\n` +
    `DTSTAMP:${testDTSTAMP}\r\n` +
    "DTSTART;TZID=X-Custom/Unknown:20260601T100000\r\n" +
    "DTEND;TZID=X-Custom/Unknown:20260601T110000\r\n" +
    "SUMMARY:Unknown TZID Test\r\n" +
    "END:VEVENT\r\nEND:VCALENDAR\r\n"
  );
}

Deno.test("RFC 7809 §3.1.3 server accepts CalDAV-Timezones header without error on GET", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzheader-accept-col");
    const uid = "tzheader-accept-001";
    await s.putObject(objectPath("tzheader-accept-col", uid), vcalWithVtimezone(uid));
    const resp = await s.do(
      "GET",
      objectPath("tzheader-accept-col", uid),
      { "CalDAV-Timezones": "T" },
    );
    assertEquals(
      resp.status < 400,
      true,
      `CalDAV-Timezones: T must not produce a 4xx/5xx, got ${resp.status}`,
    );
  });
});

Deno.test("RFC 7809 §3.1.3 GET with CalDAV-Timezones: T includes VTIMEZONE in response", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzt-col");
    const uid = "tzt-event-001";
    await s.putObject(objectPath("tzt-col", uid), vcalWithVtimezone(uid));
    const resp = await s.do(
      "GET",
      objectPath("tzt-col", uid),
      { "CalDAV-Timezones": "T" },
    );
    assertEquals(resp.status, 200);
    assertEquals(
      resp.body.includes("BEGIN:VTIMEZONE"),
      true,
      "CalDAV-Timezones: T response must include BEGIN:VTIMEZONE",
    );
  });
});

Deno.test("RFC 7809 §3.1.3 GET with CalDAV-Timezones: F omits standard VTIMEZONE from response", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzf-col");
    const uid = "tzf-event-001";
    await s.putObject(objectPath("tzf-col", uid), vcalWithVtimezone(uid));
    const resp = await s.do(
      "GET",
      objectPath("tzf-col", uid),
      { "CalDAV-Timezones": "F" },
    );
    assertEquals(resp.status, 200);
    assertEquals(
      resp.body.includes("BEGIN:VTIMEZONE"),
      false,
      "CalDAV-Timezones: F response must NOT include VTIMEZONE for standard/known TZID Europe/London",
    );
  });
});

Deno.test("RFC 7809 §3.1.3 GET with CalDAV-Timezones: F still includes VTIMEZONE for unknown TZID", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzf-unknown-col");
    const uid = "tzf-unknown-001";
    // PUT succeeds (or we allow 201/204); if server rejects unknown TZIDs via 403,
    // the VTIMEZONE-strip-on-F behaviour cannot be tested, so skip the body assertion.
    const putResp = await s.do(
      "PUT",
      objectPath("tzf-unknown-col", uid),
      calContentType(),
      vcalWithUnknownTzid(uid),
    );
    if (putResp.status === 201 || putResp.status === 204) {
      const resp = await s.do(
        "GET",
        objectPath("tzf-unknown-col", uid),
        { "CalDAV-Timezones": "F" },
      );
      assertEquals(resp.status, 200);
      assertEquals(
        resp.body.includes("BEGIN:VTIMEZONE"),
        true,
        "CalDAV-Timezones: F must still include VTIMEZONE for non-standard/unknown TZID X-Custom/Unknown",
      );
    } else {
      // Server rejected the unknown TZID — the rejection itself is acceptable per §3.1.4,
      // but the rejection must not be a 5xx.
      assertEquals(
        putResp.status < 500,
        true,
        `PUT with unknown TZID must not produce 5xx, got ${putResp.status}`,
      );
    }
  });
});

Deno.test("RFC 7809 §3.1.3 REPORT calendar-multiget with CalDAV-Timezones: T includes VTIMEZONE in multistatus body", async () => {
  await withServer(async (s) => {
    await s.mkcol("mgtz-t-col");
    const uid = "mgtz-t-001";
    await s.putObject(objectPath("mgtz-t-col", uid), vcalWithVtimezone(uid));
    const href = objectPath("mgtz-t-col", uid);
    const resp = await s.do(
      "REPORT",
      collectionPath("mgtz-t-col"),
      withHeaders({ Depth: "1", "CalDAV-Timezones": "T" }, xmlContentType()),
      calendarMultiget(href),
    );
    assertEquals(resp.status, 207);
    assertStringIncludes(
      resp.body,
      "BEGIN:VTIMEZONE",
      "calendar-multiget with CalDAV-Timezones: T must include VTIMEZONE in calendar-data",
    );
  });
});

Deno.test("RFC 7809 §3.1.3 REPORT calendar-multiget with CalDAV-Timezones: F omits standard VTIMEZONE in multistatus body", async () => {
  await withServer(async (s) => {
    await s.mkcol("mgtz-f-col");
    const uid = "mgtz-f-001";
    await s.putObject(objectPath("mgtz-f-col", uid), vcalWithVtimezone(uid));
    const href = objectPath("mgtz-f-col", uid);
    const resp = await s.do(
      "REPORT",
      collectionPath("mgtz-f-col"),
      withHeaders({ Depth: "1", "CalDAV-Timezones": "F" }, xmlContentType()),
      calendarMultiget(href),
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("BEGIN:VTIMEZONE"),
      false,
      "calendar-multiget with CalDAV-Timezones: F must NOT include VTIMEZONE for standard TZID Europe/London",
    );
  });
});

// ─── §3.1.4 PUT rejected for unknown TZID ─────────────────────────────────────

Deno.test("RFC 7809 §3.1.4 PUT rejected for unknown TZID returns 403 with CALDAV:valid-timezone precondition", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-unknown-tz-col");
    // iCalendar object with a TZID reference but no embedded VTIMEZONE and
    // a TZID that is not in any known distribution set.
    const uid = "put-unknown-tz-001";
    const ics =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART;TZID=X-Nonexistent/Timezone:20260601T100000\r\n" +
      "DTEND;TZID=X-Nonexistent/Timezone:20260601T110000\r\n" +
      "SUMMARY:Unknown TZ No VTIMEZONE\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "PUT",
      objectPath("put-unknown-tz-col", uid),
      calContentType(),
      ics,
    );
    // If the server refuses, it MUST use 403 + CALDAV:valid-timezone.
    // If the server accepts it (some servers allow it), the status is 201/204.
    if (resp.status !== 201 && resp.status !== 204) {
      assertEquals(resp.status, 403, "rejection of unknown TZID must be HTTP 403");
      assertStringIncludes(
        resp.body,
        "valid-timezone",
        "403 rejection must carry CALDAV:valid-timezone precondition XML element",
      );
    }
  });
});

// ─── §3.1.5 calendar-timezone-id and calendar-timezone co-presence ────────────

Deno.test("RFC 7809 §3.1.5 calendar-timezone-id and calendar-timezone co-present on same resource", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-copresent-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("tz-copresent-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(
        nsCalDAV, "calendar-timezone-id",
        nsCalDAV, "calendar-timezone",
      ),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("tz-copresent-col"));
    assertEquals(r !== undefined, true);
    const tzId = r!.prop("calendar-timezone-id");
    const tz = r!.prop("calendar-timezone");
    assertEquals(
      tzId !== undefined && tzId.status === 200,
      true,
      "calendar-timezone-id must be present with 200 status",
    );
    assertEquals(
      tz !== undefined && tz.status === 200,
      true,
      "calendar-timezone must be present with 200 status when calendar-timezone-id is supported",
    );
  });
});

Deno.test("RFC 7809 §3.1.5 calendar-timezone-id value matches TZID in calendar-timezone VTIMEZONE component", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-match-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("tz-match-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(
        nsCalDAV, "calendar-timezone-id",
        nsCalDAV, "calendar-timezone",
      ),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("tz-match-col"));
    assertEquals(r !== undefined, true);
    const tzIdProp = r!.prop("calendar-timezone-id");
    const tzProp = r!.prop("calendar-timezone");
    // Only assert the match if both are returned with 200 status
    if (
      tzIdProp && tzIdProp.status === 200 &&
      tzProp && tzProp.status === 200
    ) {
      const tzId = tzIdProp.text().trim();
      const tzData = tzProp.text();
      // The VTIMEZONE component in calendar-timezone must contain TZID:<tzId>
      assertEquals(
        tzData.includes(`TZID:${tzId}`) || tzData.includes(`TZID=${tzId}`),
        true,
        `calendar-timezone VTIMEZONE must contain TZID:${tzId} matching calendar-timezone-id`,
      );
    }
  });
});

Deno.test("RFC 7809 §3.1.5 PROPPATCH calendar-timezone-id updates calendar-timezone to matching VTIMEZONE data", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-proppatch-id-col");
    // Set calendar-timezone-id to Europe/Paris
    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-timezone-id>Europe/Paris</C:calendar-timezone-id>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;
    const patchResp = await s.do(
      "PROPPATCH",
      collectionPath("tz-proppatch-id-col"),
      xmlContentType(),
      patchBody,
    );
    assertEquals(patchResp.status, 207, "PROPPATCH calendar-timezone-id must return 207");
    // Now read back calendar-timezone and verify it reflects Europe/Paris
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("tz-proppatch-id-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-timezone"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("tz-proppatch-id-col"));
    assertEquals(r !== undefined, true);
    const tzProp = r!.prop("calendar-timezone");
    if (tzProp && tzProp.status === 200) {
      assertEquals(
        tzProp.text().includes("Europe/Paris") || tzProp.text().includes("Paris"),
        true,
        "calendar-timezone must reflect Europe/Paris after PROPPATCH of calendar-timezone-id",
      );
    }
  });
});

Deno.test("RFC 7809 §3.1.5 PROPPATCH calendar-timezone updates calendar-timezone-id to matching TZID", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-proppatch-tz-col");
    // Provide a minimal VTIMEZONE for America/New_York
    const vtimezone =
      "BEGIN:VTIMEZONE\\nTZID:America/New_York\\nBEGIN:STANDARD\\n" +
      "DTSTART:19701101T020000\\nTZOFFSETFROM:-0400\\nTZOFFSETTO:-0500\\n" +
      "END:STANDARD\\nEND:VTIMEZONE";
    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-timezone>${vtimezone}</C:calendar-timezone>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;
    const patchResp = await s.do(
      "PROPPATCH",
      collectionPath("tz-proppatch-tz-col"),
      xmlContentType(),
      patchBody,
    );
    assertEquals(patchResp.status, 207, "PROPPATCH calendar-timezone must return 207");
    // Now read back calendar-timezone-id and verify it reflects America/New_York
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("tz-proppatch-tz-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-timezone-id"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("tz-proppatch-tz-col"));
    assertEquals(r !== undefined, true);
    const tzIdProp = r!.prop("calendar-timezone-id");
    if (tzIdProp && tzIdProp.status === 200) {
      assertEquals(
        tzIdProp.text().trim(),
        "America/New_York",
        "calendar-timezone-id must be updated to America/New_York after PROPPATCH of calendar-timezone",
      );
    }
  });
});

Deno.test("RFC 7809 §3.1.5 PROPPATCH with unknown calendar-timezone-id returns CALDAV:valid-timezone error", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-unknown-id-col");
    const patchBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:set><D:prop>` +
      `<C:calendar-timezone-id>X-Nonexistent/Timezone</C:calendar-timezone-id>` +
      `</D:prop></D:set>` +
      `</D:propertyupdate>`;
    const resp = await s.do(
      "PROPPATCH",
      collectionPath("tz-unknown-id-col"),
      xmlContentType(),
      patchBody,
    );
    // Server must either return 207 with a per-property 403+valid-timezone error,
    // or a top-level 403/422 with valid-timezone precondition.
    const isRejection =
      (resp.status === 207 && resp.body.includes("valid-timezone")) ||
      (resp.status === 403 && resp.body.includes("valid-timezone")) ||
      (resp.status === 422 && resp.body.includes("valid-timezone"));
    assertEquals(
      isRejection,
      true,
      `PROPPATCH with unknown calendar-timezone-id must fail with valid-timezone; got ${resp.status}: ${resp.body}`,
    );
  });
});

// ─── §3.1.6 calendar-query REPORT with CALDAV:timezone-id ────────────────────

Deno.test("RFC 7809 §3.1.6 calendar-query REPORT accepts CALDAV:timezone-id element for time-based filtering", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzid-query-col");
    await s.putEvent("tzid-query-col", "tzid-query-001");
    // Build a calendar-query with a C:timezone-id element supplying Europe/London
    const reportBody =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
      `<C:timezone-id>Europe/London</C:timezone-id>` +
      `<C:filter><C:comp-filter name="VCALENDAR">` +
      `<C:comp-filter name="VEVENT"/>` +
      `</C:comp-filter></C:filter>` +
      `</C:calendar-query>`;
    const resp = await s.do(
      "REPORT",
      collectionPath("tzid-query-col"),
      withHeaders({ Depth: "1" }, xmlContentType()),
      reportBody,
    );
    assertEquals(
      resp.status < 500,
      true,
      `calendar-query with timezone-id must not produce 5xx; got ${resp.status}`,
    );
    // Must not return 400 Bad Request due to the timezone-id element being unrecognised
    assertEquals(
      resp.status !== 400,
      true,
      `calendar-query with timezone-id CALDAV:timezone-id element must not be rejected with 400`,
    );
  });
});

Deno.test("RFC 7809 §3.1.6 calendar-query REPORT with unknown timezone-id returns CALDAV:valid-timezone error", async () => {
  await withServer(async (s) => {
    await s.mkcol("tzid-unknown-query-col");
    await s.putEvent("tzid-unknown-query-col", "tzid-unknown-001");
    const reportBody =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
      `<C:timezone-id>X-Nonexistent/Timezone</C:timezone-id>` +
      `<C:filter><C:comp-filter name="VCALENDAR">` +
      `<C:comp-filter name="VEVENT">` +
      `<C:time-range start="20260101T000000Z" end="20270101T000000Z"/>` +
      `</C:comp-filter>` +
      `</C:comp-filter></C:filter>` +
      `</C:calendar-query>`;
    const resp = await s.do(
      "REPORT",
      collectionPath("tzid-unknown-query-col"),
      withHeaders({ Depth: "1" }, xmlContentType()),
      reportBody,
    );
    assertStringIncludes(
      resp.body,
      "valid-timezone",
      `calendar-query with unknown timezone-id must return CALDAV:valid-timezone; got ${resp.status}: ${resp.body}`,
    );
  });
});

// ─── §5.1 timezone-service-set property ──────────────────────────────────────

Deno.test("RFC 7809 §5.1 timezone-service-set present on calendar home collection via PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      calendarHomePath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "timezone-service-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(calendarHomePath);
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("timezone-service-set") !== undefined,
      true,
      "timezone-service-set SHOULD be present on calendar home collection",
    );
  });
});

Deno.test("RFC 7809 §5.1 timezone-service-set contains at least one DAV:href with a URI", async () => {
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
    const prop = r!.prop("timezone-service-set");
    if (prop && prop.status === 200) {
      assertEquals(
        prop.hasChild("href"),
        true,
        "timezone-service-set must contain at least one DAV:href child element",
      );
    }
  });
});

Deno.test("RFC 7809 §5.1 timezone-service-set is absent from DAV:allprop PROPFIND response", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      calendarHomePath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    // timezone-service-set SHOULD NOT appear in allprop responses
    assertEquals(
      resp.body.includes("timezone-service-set"),
      false,
      "timezone-service-set must NOT be returned in DAV:allprop PROPFIND response",
    );
  });
});

// ─── §5.2 calendar-timezone-id property ──────────────────────────────────────

Deno.test("RFC 7809 §5.2 calendar-timezone-id is absent from DAV:allprop PROPFIND response", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-tzid-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-tzid-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    // calendar-timezone-id SHOULD NOT appear in allprop responses
    assertEquals(
      resp.body.includes("calendar-timezone-id"),
      false,
      "calendar-timezone-id must NOT be returned in DAV:allprop PROPFIND response",
    );
  });
});
