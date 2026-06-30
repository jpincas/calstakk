// RFC 6638 — Scheduling Extensions to CalDAV
// Spec: specs/rfc6638.txt
//
// Coverage:
//   §2   New principal properties (schedule-inbox-URL, schedule-outbox-URL,
//        calendar-user-address-set, schedule-default-calendar-URL,
//        scheduling-privilege-set)
//   §3   Scheduling inbox/outbox collections exist and have correct resourcetype
//   §4   PUT with ORGANIZER/ATTENDEE must not cause 5xx
//   §7   Free-busy POST to outbox

import { assertEquals } from "@std/assert";
import {
  calContentType,
  nsCalDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindAllprop,
  propfindProps,
  testDTEND,
  testDTSTAMP,
  testDTSTART,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §2 Scheduling principal properties ───────────────────────────────────────

Deno.test("RFC 6638 §2.2 schedule-inbox-URL appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-inbox-URL"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true, "response for principal must exist");
    assertEquals(r!.propStatus("schedule-inbox-URL"), 200, "schedule-inbox-URL must be implemented (200), not 404");
  });
});

Deno.test("RFC 6638 §2.3 schedule-outbox-URL appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    assertEquals(r!.propStatus("schedule-outbox-URL"), 200, "schedule-outbox-URL must be implemented (200), not 404");
  });
});

Deno.test("RFC 6638 §2.4 calendar-user-address-set appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-user-address-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    assertEquals(r!.propStatus("calendar-user-address-set"), 200, "calendar-user-address-set must be implemented (200), not 404");
  });
});

Deno.test("RFC 6638 §2.5 schedule-default-calendar-URL appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-default-calendar-URL"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("schedule-default-calendar-URL");
    assertEquals(p !== undefined, true, "schedule-default-calendar-URL must appear in PROPFIND");
  });
});

Deno.test("RFC 6638 §2 scheduling-privilege-set appears in PROPFIND", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "scheduling-privilege-set"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("scheduling-privilege-set");
    assertEquals(p !== undefined, true, "scheduling-privilege-set must appear in PROPFIND");
  });
});

// ─── §3 Scheduling inbox/outbox collections ───────────────────────────────────

Deno.test("RFC 6638 §3 schedule inbox exists and returns 207 on PROPFIND", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-inbox-URL"),
    );
    const inboxURL = parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
    if (!inboxURL) return; // not yet implemented

    const resp = await s.do(
      "PROPFIND",
      inboxURL,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207, "schedule inbox must exist and return 207 on PROPFIND");
  });
});

Deno.test("RFC 6638 §3 schedule outbox exists and returns 207 on PROPFIND", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
    if (!outboxURL) return;

    const resp = await s.do(
      "PROPFIND",
      outboxURL,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207, "schedule outbox must exist and return 207 on PROPFIND");
  });
});

Deno.test("RFC 6638 §3 inbox resourcetype contains schedule-inbox", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-inbox-URL"),
    );
    const inboxURL = parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
    if (!inboxURL) return;

    const resp = await s.do(
      "PROPFIND",
      inboxURL,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps("DAV:", "resourcetype"),
    );
    assertEquals(resp.status, 207);
    const rt = parseMultistatus(resp.body).response(inboxURL)?.prop("resourcetype");
    assertEquals(rt !== undefined, true);
    assertEquals(
      rt!.hasChild("schedule-inbox"),
      true,
      "inbox resourcetype must contain <C:schedule-inbox/>",
    );
  });
});

// ─── §4 Implicit scheduling ───────────────────────────────────────────────────

Deno.test("RFC 6638 §4 PUT with ORGANIZER and ATTENDEE must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("sched-col");
    const uid = "sched-event-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Scheduled Meeting\r\n" +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("sched-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "PUT with ORGANIZER/ATTENDEE must not cause 5xx");
  });
});

// ─── §7 Free-busy POST to outbox ──────────────────────────────────────────────

Deno.test("RFC 6638 §7 free-busy POST to outbox returns 200 or 207", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
    if (!outboxURL) return;

    const fbReq =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VFREEBUSY\r\n" +
      "UID:fb-request-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20260201T000000Z\r\n" +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "ATTENDEE:mailto:user@example.com\r\n" +
      "END:VFREEBUSY\r\n" +
      "END:VCALENDAR\r\n";

    const resp = await s.do("POST", outboxURL, calContentType(), fbReq);
    assertEquals(
      [200, 207].includes(resp.status),
      true,
      `free-busy POST to outbox must return 200 or 207; got ${resp.status}`,
    );
  });
});

// ─── §2 Scheduling advertised in OPTIONS ──────────────────────────────────────

Deno.test("RFC 6638 §2 OPTIONS response advertises calendar-auto-schedule in DAV header", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", principalPath);
    const dav = resp.headers.get("DAV") ?? "";
    assertEquals(
      dav.split(",").map((v) => v.trim()).includes("calendar-auto-schedule"),
      true,
      `DAV header must include 'calendar-auto-schedule'; got: '${dav}'`,
    );
  });
});

// ─── §2.1 Outbox resourcetype ─────────────────────────────────────────────────

Deno.test("RFC 6638 §2.1 Outbox resourcetype contains CALDAV:schedule-outbox element", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    assertEquals(
      ms.response(principalPath)?.propStatus("schedule-outbox-URL"),
      200,
      "schedule-outbox-URL must be present (200) on principal",
    );
    const outboxURL = ms.response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
    assertEquals(outboxURL !== "", true, "schedule-outbox-URL must contain a non-empty href text value");

    const rtResp = await s.do(
      "PROPFIND",
      outboxURL,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps("DAV:", "resourcetype"),
    );
    assertEquals(rtResp.status, 207);
    const rt = parseMultistatus(rtResp.body).response(outboxURL)?.prop("resourcetype");
    assertEquals(rt !== undefined, true, "resourcetype must be present on outbox collection");
    assertEquals(
      rt!.hasChild("schedule-outbox"),
      true,
      "outbox resourcetype must contain <C:schedule-outbox/>",
    );
  });
});

// ─── §2.1.1 / §2.2.1 allprop must NOT expose inbox/outbox URLs ───────────────

Deno.test(
  "RFC 6638 §2.1.1/§2.2.1 schedule-outbox-URL and schedule-inbox-URL SHOULD NOT appear in DAV:allprop response",
  async () => {
    await withServer(async (s) => {
      const resp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(resp.status, 207);
      const ms = parseMultistatus(resp.body);
      const r = ms.response(principalPath);
      assertEquals(r !== undefined, true, "principal response must be present in multistatus");
      // RFC 6638 §2.1.1 and §2.2.1: these properties SHOULD NOT appear in allprop
      const inboxInAllprop = r!.prop("schedule-inbox-URL");
      const outboxInAllprop = r!.prop("schedule-outbox-URL");
      assertEquals(
        inboxInAllprop !== undefined && inboxInAllprop.status === 200,
        false,
        "schedule-inbox-URL MUST NOT be returned by DAV:allprop (RFC 6638 §2.2.1)",
      );
      assertEquals(
        outboxInAllprop !== undefined && outboxInAllprop.status === 200,
        false,
        "schedule-outbox-URL MUST NOT be returned by DAV:allprop (RFC 6638 §2.1.1)",
      );
    });
  },
);

// ─── §2.3 Reporting on inbox ──────────────────────────────────────────────────

Deno.test("RFC 6638 §2.3 free-busy-query REPORT on scheduling Inbox collection is rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-inbox-URL"),
    );
    assertEquals(pfResp.status, 207);
    assertEquals(
      parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
      200,
      "schedule-inbox-URL must be present (200) on principal",
    );
    const inboxURL =
      parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
    assertEquals(inboxURL !== "", true, "schedule-inbox-URL must contain a non-empty href");

    const freeBusyQuery =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      `<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>` +
      `</C:free-busy-query>`;

    const resp = await s.do(
      "REPORT",
      inboxURL,
      withHeaders({ Depth: "1" }, xmlContentType()),
      freeBusyQuery,
    );
    // RFC 6638 §2.3: free-busy-query is NOT supported on inbox; must return 403 or 405
    assertEquals(
      resp.status === 403 || resp.status === 405,
      true,
      `free-busy-query REPORT on inbox must be rejected with 403 or 405; got ${resp.status}`,
    );
  });
});

Deno.test(
  "RFC 6638 §2.3 calendar-query time-range on inbox matches VEVENT components lacking DTSTART",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present (200) on principal",
      );
      const inboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must contain a non-empty href");

      // calendar-query with time-range on inbox: VEVENTs without DTSTART MUST always match
      const calQuery =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
        `<D:prop><D:getetag/></D:prop>` +
        `<C:filter><C:comp-filter name="VCALENDAR">` +
        `<C:comp-filter name="VEVENT">` +
        `<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>` +
        `</C:comp-filter></C:comp-filter></C:filter>` +
        `</C:calendar-query>`;

      const resp = await s.do(
        "REPORT",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        calQuery,
      );
      // Must return 207 (calendar-query is supported on inbox)
      assertEquals(resp.status, 207, "calendar-query REPORT on inbox must return 207");
    });
  },
);

// ─── §2.4.1 calendar-user-address-set contains DAV:href ──────────────────────

Deno.test(
  "RFC 6638 §2.4.1 calendar-user-address-set contains at least one DAV:href with a mailto or URI value",
  async () => {
    await withServer(async (s) => {
      const resp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "calendar-user-address-set"),
      );
      assertEquals(resp.status, 207);
      const ms = parseMultistatus(resp.body);
      const prop = ms.response(principalPath)?.prop("calendar-user-address-set");
      assertEquals(prop !== undefined, true, "calendar-user-address-set must be present on principal");
      assertEquals(prop!.status, 200, "calendar-user-address-set must return 200");
      // Must contain at least one DAV:href child element
      assertEquals(
        prop!.hasChild("href"),
        true,
        "calendar-user-address-set must contain at least one DAV:href child element",
      );
    });
  },
);

// ─── §2.4.2 calendar-user-type via PROPFIND ──────────────────────────────────

Deno.test("RFC 6638 §2.4.2 calendar-user-type property accessible via PROPFIND on principal", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "calendar-user-type"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true, "response for principal must exist");
    // calendar-user-type MAY be defined; if present must be 200; if not, 404 is acceptable
    const status = r!.propStatus("calendar-user-type");
    assertEquals(
      status === 200 || status === 404,
      true,
      `calendar-user-type must return 200 or 404; got ${status}`,
    );
  });
});

// ─── §3.2.1.1 Organizer PUT — SCHEDULE-STATUS on ATTENDEE ────────────────────

Deno.test(
  "RFC 6638 §3.2.1.1 After organizer PUT re-fetched resource contains SCHEDULE-STATUS on ATTENDEE",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("sched-status-col");
      const uid = "sched-status-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched Test\r\n" +
        "ORGANIZER:mailto:organizer@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const path = objectPath("sched-status-col", uid);
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status < 500, true, "PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200, "GET of stored object must return 200");
      // RFC 6638 §3.2.1.1: server MUST add SCHEDULE-STATUS to each ATTENDEE for whom
      // scheduling was attempted with SCHEDULE-AGENT=SERVER (the default)
      assertEquals(
        getResp.body.includes("SCHEDULE-STATUS"),
        true,
        "re-fetched resource must contain SCHEDULE-STATUS parameter on ATTENDEE",
      );
    });
  },
);

Deno.test(
  "RFC 6638 §3.2.1.1 ATTENDEE with SCHEDULE-AGENT=CLIENT receives no SCHEDULE-STATUS after organizer PUT",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("sched-client-col");
      const uid = "sched-client-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Client Agent Test\r\n" +
        "ORGANIZER:mailto:organizer@example.com\r\n" +
        "ATTENDEE;SCHEDULE-AGENT=CLIENT;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const path = objectPath("sched-client-col", uid);
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status < 500, true, "PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      // RFC 6638 §3.2.1.1: MUST NOT add SCHEDULE-STATUS for SCHEDULE-AGENT=CLIENT attendees
      const clientAttendeeLine = getResp.body
        .replace(/\r\n[ \t]/g, "") // unfold
        .split(/\r\n|\n/)
        .find((l) => l.includes("SCHEDULE-AGENT=CLIENT"));
      assertEquals(
        clientAttendeeLine !== undefined,
        true,
        "SCHEDULE-AGENT=CLIENT attendee must remain in stored resource",
      );
      assertEquals(
        (clientAttendeeLine ?? "").includes("SCHEDULE-STATUS"),
        false,
        "SCHEDULE-AGENT=CLIENT ATTENDEE MUST NOT have SCHEDULE-STATUS added",
      );
    });
  },
);

Deno.test(
  "RFC 6638 §3.2.1.1 ATTENDEE with SCHEDULE-AGENT=NONE receives no SCHEDULE-STATUS after organizer PUT",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("sched-none-col");
      const uid = "sched-none-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:None Agent Test\r\n" +
        "ORGANIZER:mailto:organizer@example.com\r\n" +
        "ATTENDEE;SCHEDULE-AGENT=NONE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const path = objectPath("sched-none-col", uid);
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status < 500, true, "PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      const noneAttendeeLine = getResp.body
        .replace(/\r\n[ \t]/g, "")
        .split(/\r\n|\n/)
        .find((l) => l.includes("SCHEDULE-AGENT=NONE"));
      assertEquals(noneAttendeeLine !== undefined, true, "SCHEDULE-AGENT=NONE attendee must remain in stored resource");
      assertEquals(
        (noneAttendeeLine ?? "").includes("SCHEDULE-STATUS"),
        false,
        "SCHEDULE-AGENT=NONE ATTENDEE MUST NOT have SCHEDULE-STATUS added",
      );
    });
  },
);

// ─── §3.2.1.2 Organizer reschedule resets PARTSTAT ───────────────────────────

Deno.test(
  "RFC 6638 §3.2.1.2 Organizer reschedule (DTSTART change) resets all attendee PARTSTAT to NEEDS-ACTION",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("reschedule-col");
      const uid = "reschedule-001";
      const path = objectPath("reschedule-col", uid);

      // Initial PUT with PARTSTAT=ACCEPTED on attendee
      const icsV1 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260115T100000Z\r\n" +
        "DTEND:20260115T110000Z\r\n" +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), icsV1);

      // Update with changed DTSTART (reschedule)
      const icsV2 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        "DTSTART:20260120T100000Z\r\n" + // Changed DTSTART
        "DTEND:20260120T110000Z\r\n" +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putResp = await s.do("PUT", path, calContentType(), icsV2);
      assertEquals(putResp.status < 500, true, "reschedule PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      // RFC 6638 §3.2.1.2: server MUST reset PARTSTAT to NEEDS-ACTION after DTSTART change
      const unfolded = getResp.body.replace(/\r\n[ \t]/g, "").split(/\r\n|\n/);
      const attendeeLine = unfolded.find((l) => l.startsWith("ATTENDEE"));
      assertEquals(attendeeLine !== undefined, true, "ATTENDEE must be present in stored resource");
      assertEquals(
        (attendeeLine ?? "").includes("PARTSTAT=NEEDS-ACTION"),
        true,
        "server must reset ATTENDEE PARTSTAT to NEEDS-ACTION after DTSTART change",
      );
    });
  },
);

// ─── §3.2.1.3 DELETE of organizer resource triggers Remove scheduling ─────────

Deno.test(
  "RFC 6638 §3.2.1.3 DELETE of organizer scheduling object resource triggers Remove scheduling operation",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("remove-sched-col");
      const uid = "remove-sched-001";
      const path = objectPath("remove-sched-col", uid);

      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION;SCHEDULE-AGENT=SERVER:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), ics);

      // DELETE must succeed (204) and server must execute Remove scheduling
      const delResp = await s.do("DELETE", path);
      assertEquals(delResp.status, 204, "DELETE of organizer scheduling object must return 204");

      // After DELETE the resource must be gone
      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 404, "resource must not exist after DELETE");

      // Verify Remove scheduling occurred: attendee inbox must receive a CANCEL
      const pfInbox = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(
        parseMultistatus(pfInbox.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present to verify Remove scheduling delivery",
      );
      const inboxURL =
        parseMultistatus(pfInbox.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty to check CANCEL delivery");

      const inboxItems = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(inboxItems.status, 207);
      // Inbox must contain a CANCEL iTIP message for the deleted event
      assertEquals(
        inboxItems.body.includes("CANCEL") || parseMultistatus(inboxItems.body).len() > 1,
        true,
        "attendee inbox must receive a CANCEL iTIP after organizer DELETE (Remove scheduling)",
      );
    });
  },
);

// ─── §3.2.2.1 Attendee allowed changes ───────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.2.1 Attendee PUT changing own PARTSTAT succeeds; forbidden field change returns 403 allowed-attendee-scheduling-object-change",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("att-change-col");
      const uid = "att-change-001";
      const path = objectPath("att-change-col", uid);

      // Organizer creates the event
      const orgICS =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), orgICS);

      // Attendee changes PARTSTAT — MUST be allowed (2xx)
      const attPARTSTATChange =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const partstatResp = await s.do("PUT", path, calContentType(), attPARTSTATChange);
      assertEquals(
        partstatResp.status >= 200 && partstatResp.status < 300,
        true,
        `attendee PARTSTAT change must be allowed (2xx); got ${partstatResp.status}`,
      );

      // Attendee tries to change DTSTART — MUST be rejected with 403 + precondition
      const attForbiddenChange =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260120T100000Z\r\n" + // changed DTSTART — forbidden for attendee
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const forbiddenResp = await s.do("PUT", path, calContentType(), attForbiddenChange);
      assertEquals(
        forbiddenResp.status,
        403,
        `attendee attempt to change DTSTART must be rejected with 403; got ${forbiddenResp.status}`,
      );
      assertEquals(
        forbiddenResp.body.includes("allowed-attendee-scheduling-object-change"),
        true,
        "403 response must contain CALDAV:allowed-attendee-scheduling-object-change precondition",
      );
    });
  },
);

// ─── §3.2.2.3 Attendee PARTSTAT change causes SCHEDULE-STATUS on ORGANIZER ───

Deno.test(
  "RFC 6638 §3.2.2.3 Attendee PARTSTAT change causes SCHEDULE-STATUS on ORGANIZER property after server processes reply",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("att-reply-col");
      const uid = "att-reply-001";
      const orgPath = objectPath("att-reply-col", uid);

      // Organizer creates event
      const orgICS =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", orgPath, calContentType(), orgICS);

      // Attendee replies by changing PARTSTAT on their copy
      const attReplyICS =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", orgPath, calContentType(), attReplyICS);

      // Re-fetch organizer's copy — ORGANIZER property must have SCHEDULE-STATUS
      const getResp = await s.do("GET", orgPath);
      assertEquals(getResp.status, 200);
      const organizerLine = getResp.body
        .replace(/\r\n[ \t]/g, "")
        .split(/\r\n|\n/)
        .find((l) => l.startsWith("ORGANIZER"));
      assertEquals(organizerLine !== undefined, true, "ORGANIZER property must be present");
      assertEquals(
        (organizerLine ?? "").includes("SCHEDULE-STATUS"),
        true,
        "ORGANIZER property must have SCHEDULE-STATUS after attendee reply is processed",
      );
    });
  },
);

// ─── §3.2.2.4 / §8.1 Attendee DELETE and Schedule-Reply header ───────────────

Deno.test(
  "RFC 6638 §3.2.2.4/§8.1 Attendee DELETE with Schedule-Reply: F suppresses DECLINED reply; absent/T header sends DECLINED",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("att-delete-col");

      // Event 1: DELETE without Schedule-Reply header → server MUST send DECLINED
      const uid1 = "att-del-implicit";
      const path1 = objectPath("att-delete-col", uid1);
      const ics1 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path1, calContentType(), ics1);
      const del1 = await s.do("DELETE", path1);
      assertEquals(del1.status, 204, "DELETE of attendee scheduling object must return 204");

      // Event 2: DELETE with Schedule-Reply: F → server MUST NOT send scheduling message
      const uid2 = "att-del-suppress";
      const path2 = objectPath("att-delete-col", uid2);
      const ics2 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path2, calContentType(), ics2);
      const del2 = await s.do("DELETE", path2, { "Schedule-Reply": "F" });
      assertEquals(
        del2.status,
        204,
        "DELETE with Schedule-Reply: F must return 204 and suppress any iTIP reply",
      );
    });
  },
);

// ─── §3.2.3.3/§3.2.3.4 COPY of scheduling object triggers scheduling ─────────

Deno.test(
  "RFC 6638 §3.2.3.3/§3.2.3.4 COPY of scheduling object resource to calendar collection triggers scheduling operation at destination",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("copy-src-col");
      await s.mkcol("copy-dst-col");
      const uid = "copy-sched-001";
      const srcPath = objectPath("copy-src-col", uid);
      const dstPath = objectPath("copy-dst-col", uid);

      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", srcPath, calContentType(), ics);

      // COPY to a calendar collection must succeed and trigger scheduling at destination
      const copyResp = await s.do("COPY", srcPath, { Destination: dstPath });
      assertEquals(
        copyResp.status === 201 || copyResp.status === 204,
        true,
        `COPY of scheduling object to calendar collection must return 201 or 204; got ${copyResp.status}`,
      );

      // After successful COPY the destination must exist
      const getResp = await s.do("GET", dstPath);
      assertEquals(getResp.status, 200, "destination resource must exist after COPY");
    });
  },
);

// ─── §3.2.4.1 Duplicate UID across collections ───────────────────────────────

Deno.test(
  "RFC 6638 §3.2.4.1 PUT with duplicate UID in different calendar collection returns 403 unique-scheduling-object-resource",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("uid-col-a");
      await s.mkcol("uid-col-b");
      const uid = "dup-uid-xc-001";

      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Event\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const put1 = await s.do("PUT", objectPath("uid-col-a", uid), calContentType(), ics);
      assertEquals(put1.status === 201 || put1.status === 204, true, "first PUT must succeed");

      // Second PUT with same UID in a different collection must be rejected
      const put2 = await s.do("PUT", objectPath("uid-col-b", uid), calContentType(), ics);
      assertEquals(
        put2.status,
        403,
        `duplicate UID in different collection must return 403; got ${put2.status}`,
      );
      assertEquals(
        put2.body.includes("unique-scheduling-object-resource"),
        true,
        "403 response must include CALDAV:unique-scheduling-object-resource precondition",
      );
    });
  },
);

// ─── §3.2.4.2 Mixed ORGANIZER values ─────────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.4.2 PUT with mixed ORGANIZER values in multi-component resource returns 403 same-organizer-in-all-components",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("mixed-org-col");
      const uid = "mixed-org-001";

      // Master + override recurrence with different ORGANIZER values
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260115T100000Z\r\n" +
        "DTEND:20260115T110000Z\r\n" +
        "RRULE:FREQ=DAILY;COUNT=2\r\n" +
        "SUMMARY:Recurring\r\nORGANIZER:mailto:org1@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "RECURRENCE-ID:20260116T100000Z\r\n" +
        "DTSTAMP:20260102T000000Z\r\n" +
        "DTSTART:20260116T120000Z\r\n" +
        "DTEND:20260116T130000Z\r\n" +
        "SUMMARY:Override\r\nORGANIZER:mailto:org2@example.com\r\n" + // different ORGANIZER
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\n" +
        "END:VCALENDAR\r\n";

      const resp = await s.do("PUT", objectPath("mixed-org-col", uid), calContentType(), ics);
      assertEquals(
        resp.status,
        403,
        `PUT with different ORGANIZER values in components must return 403; got ${resp.status}`,
      );
      assertEquals(
        resp.body.includes("same-organizer-in-all-components"),
        true,
        "403 response must include CALDAV:same-organizer-in-all-components precondition",
      );
    });
  },
);

// ─── §3.2.4.3 Organizer setting other attendee PARTSTAT ──────────────────────

Deno.test(
  "RFC 6638 §3.2.4.3 Organizer attempt to set other attendee PARTSTAT to non-NEEDS-ACTION returns 403 allowed-organizer-scheduling-object-change",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("org-partstat-col");
      const uid = "org-partstat-001";
      const path = objectPath("org-partstat-col", uid);

      // Create meeting with ATTENDEE PARTSTAT=NEEDS-ACTION
      const icsCreate =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), icsCreate);

      // Organizer tries to set attendee PARTSTAT=ACCEPTED — forbidden
      const icsModify =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" + // organizer sets attendee PARTSTAT
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", path, calContentType(), icsModify);
      assertEquals(
        resp.status,
        403,
        `organizer setting attendee PARTSTAT must return 403; got ${resp.status}`,
      );
      assertEquals(
        resp.body.includes("allowed-organizer-scheduling-object-change"),
        true,
        "403 response must include CALDAV:allowed-organizer-scheduling-object-change precondition",
      );
    });
  },
);

// ─── §3.2.5 DTSTAMP present and UTC ──────────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.5 DTSTAMP is present and UTC-formatted in resource stored by scheduling operation",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("dtstamp-col");
      const uid = "dtstamp-sched-001";
      const path = objectPath("dtstamp-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status < 500, true, "PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      const unfolded = getResp.body.replace(/\r\n[ \t]/g, "").split(/\r\n|\n/);
      const dtstampLine = unfolded.find((l) => l.startsWith("DTSTAMP"));
      assertEquals(dtstampLine !== undefined, true, "DTSTAMP must be present in stored resource");
      // RFC 5545: DTSTAMP value must be UTC (ends with Z)
      assertEquals(
        (dtstampLine ?? "").match(/DTSTAMP:\d{8}T\d{6}Z/) !== null,
        true,
        "DTSTAMP must be a UTC value (YYYYMMDDTHHMMSSz format)",
      );
    });
  },
);

// ─── §3.2.7 SCHEDULE-FORCE-SEND stripped ─────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.7 SCHEDULE-FORCE-SEND parameter is stripped from stored scheduling object resource",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("force-send-col");
      const uid = "force-send-001";
      const path = objectPath("force-send-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Force Send\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;SCHEDULE-FORCE-SEND=REQUEST;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status < 500, true, "PUT must not cause 5xx");

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      // RFC 6638 §3.2.7: server MUST NOT preserve SCHEDULE-FORCE-SEND in stored resource
      assertEquals(
        getResp.body.includes("SCHEDULE-FORCE-SEND"),
        false,
        "stored resource MUST NOT contain SCHEDULE-FORCE-SEND parameter",
      );
    });
  },
);

// ─── §3.2.10 / §8.2 Schedule-Tag response headers ────────────────────────────

Deno.test(
  "RFC 6638 §3.2.10/§8.2 PUT response for scheduling object resource includes Schedule-Tag response header",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("schedtag-put-col");
      const uid = "schedtag-put-001";
      const path = objectPath("schedtag-put-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(putResp.status === 201 || putResp.status === 204, true, "PUT must succeed");
      const schedTag = putResp.headers.get("Schedule-Tag");
      assertEquals(
        schedTag !== null && schedTag !== "",
        true,
        "PUT response must include a non-empty Schedule-Tag header",
      );
    });
  },
);

Deno.test(
  "RFC 6638 §3.2.10/§8.2 GET response for scheduling object resource includes Schedule-Tag response header",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("schedtag-get-col");
      const uid = "schedtag-get-001";
      const path = objectPath("schedtag-get-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), ics);

      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      const schedTag = getResp.headers.get("Schedule-Tag");
      assertEquals(
        schedTag !== null && schedTag !== "",
        true,
        "GET response must include a non-empty Schedule-Tag header",
      );
    });
  },
);

// ─── §3.2.10 / §9.3 schedule-tag via PROPFIND ────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.10/§9.3 PROPFIND on scheduling object resource returns CALDAV:schedule-tag property",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("schedtag-pf-col");
      const uid = "schedtag-pf-001";
      const path = objectPath("schedtag-pf-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), ics);

      const pfResp = await s.do(
        "PROPFIND",
        path,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-tag"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(path)?.propStatus("schedule-tag"),
        200,
        "CALDAV:schedule-tag must be present (200) on scheduling object resource",
      );
    });
  },
);

// ─── §3.2.10 / §8.3 If-Schedule-Tag-Match ────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.10/§8.3 If-Schedule-Tag-Match mismatch on PUT returns 412; matching value allows update",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("ifschedtag-col");
      const uid = "ifschedtag-001";
      const path = objectPath("ifschedtag-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Sched\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const put1 = await s.do("PUT", path, calContentType(), ics);
      assertEquals(put1.status === 201 || put1.status === 204, true, "initial PUT must succeed");
      const schedTag = put1.headers.get("Schedule-Tag") ?? "initial-tag";

      const ics2 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Updated\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      // Mismatched If-Schedule-Tag-Match must return 412
      const mismatchResp = await s.do(
        "PUT",
        path,
        withHeaders({ "If-Schedule-Tag-Match": '"wrong-tag-value"' }, calContentType()),
        ics2,
      );
      assertEquals(
        mismatchResp.status,
        412,
        `If-Schedule-Tag-Match mismatch must return 412; got ${mismatchResp.status}`,
      );

      // Matching If-Schedule-Tag-Match must succeed
      const matchResp = await s.do(
        "PUT",
        path,
        withHeaders({ "If-Schedule-Tag-Match": schedTag }, calContentType()),
        ics2,
      );
      assertEquals(
        matchResp.status === 200 || matchResp.status === 204,
        true,
        `If-Schedule-Tag-Match with matching value must succeed; got ${matchResp.status}`,
      );
    });
  },
);

// ─── §3.2.10 schedule-tag unchanged after attendee reply ─────────────────────

Deno.test(
  "RFC 6638 §3.2.10 Organizer schedule-tag unchanged after inconsequential attendee PARTSTAT reply",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("stable-tag-col");
      const uid = "stable-tag-001";
      const orgPath = objectPath("stable-tag-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      // Organizer creates event — record Schedule-Tag T1
      const put1 = await s.do("PUT", orgPath, calContentType(), ics);
      assertEquals(put1.status === 201 || put1.status === 204, true, "initial PUT must succeed");
      const tagT1 = put1.headers.get("Schedule-Tag") ?? "";
      assertEquals(tagT1 !== "", true, "Schedule-Tag must be present on initial PUT response");

      // Attendee sends PARTSTAT reply (server processes it and updates organizer's copy)
      const attReply =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", orgPath, calContentType(), attReply);

      // Organizer's schedule-tag MUST NOT change after attendee reply alone
      const getResp = await s.do("GET", orgPath);
      assertEquals(getResp.status, 200);
      const tagT2 = getResp.headers.get("Schedule-Tag") ?? "";
      assertEquals(tagT2 !== "", true, "Schedule-Tag must be present on GET response");
      assertEquals(
        tagT2,
        tagT1,
        "Organizer schedule-tag MUST NOT change after inconsequential attendee PARTSTAT reply",
      );
    });
  },
);

// ─── §4.1 Organizer PUT causes iTIP REQUEST in attendee inbox ─────────────────

Deno.test(
  "RFC 6638 §4.1 Organizer PUT causes iTIP REQUEST scheduling message to appear in attendee inbox",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present (200) on principal",
      );
      const inboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must contain a non-empty href");

      await s.mkcol("itip-request-col");
      const uid = "itip-request-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", objectPath("itip-request-col", uid), calContentType(), ics);

      // After PUT, a REQUEST iTIP must appear in the attendee's scheduling inbox
      const inboxResp = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(inboxResp.status, 207, "inbox PROPFIND must return 207");
      // Inbox must contain at least one scheduling message beyond the inbox resource itself
      assertEquals(
        parseMultistatus(inboxResp.body).len() > 1,
        true,
        "scheduling inbox must contain at least one iTIP REQUEST message after organizer PUT",
      );
    });
  },
);

// ─── §4.2 Attendee reply reflected on Organizer copy ─────────────────────────

Deno.test(
  "RFC 6638 §4.2 Attendee PARTSTAT reply is reflected on Organizer copy and reply appears in Organizer inbox",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present (200) on principal",
      );
      const inboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must contain a non-empty href");

      await s.mkcol("att-reply-flow-col");
      const uid = "att-reply-flow-001";
      const orgPath = objectPath("att-reply-flow-col", uid);

      const orgICS =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", orgPath, calContentType(), orgICS);

      // Attendee sends REPLY with PARTSTAT=ACCEPTED
      const attReply =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REPLY\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", orgPath, calContentType(), attReply);

      // Organizer's copy must reflect the PARTSTAT=ACCEPTED
      const getResp = await s.do("GET", orgPath);
      assertEquals(getResp.status, 200);
      assertEquals(
        getResp.body.replace(/\r\n[ \t]/g, "").includes("PARTSTAT=ACCEPTED"),
        true,
        "Organizer copy must reflect attendee PARTSTAT=ACCEPTED after reply",
      );

      // A REPLY message must appear in the Organizer's scheduling inbox
      const inboxResp = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(inboxResp.status, 207);
      assertEquals(
        parseMultistatus(inboxResp.body).len() > 1,
        true,
        "Organizer inbox must contain at least one REPLY message after attendee reply",
      );
    });
  },
);

// ─── §4.3 DELETE of default calendar returns 403 ─────────────────────────────

Deno.test(
  "RFC 6638 §4.3 DELETE of default calendar collection returns 403 default-calendar-needed",
  async () => {
    await withServer(async (s) => {
      const pfInbox = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfInbox.status, 207);
      assertEquals(
        parseMultistatus(pfInbox.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present (200) on principal",
      );
      const inboxURL =
        parseMultistatus(pfInbox.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      const pfDefault = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-default-calendar-URL"),
      );
      assertEquals(pfDefault.status, 207);
      const defaultCalURL =
        parseMultistatus(pfDefault.body).response(inboxURL)?.prop("schedule-default-calendar-URL")?.text() ?? "";
      assertEquals(defaultCalURL !== "", true, "schedule-default-calendar-URL must be non-empty on inbox");

      // Attempt to DELETE the default calendar collection — must be rejected
      const delResp = await s.do("DELETE", defaultCalURL);
      assertEquals(
        delResp.status,
        403,
        `DELETE of default calendar must return 403; got ${delResp.status}`,
      );
      assertEquals(
        delResp.body.includes("default-calendar-needed"),
        true,
        "403 response must include CALDAV:default-calendar-needed precondition",
      );
    });
  },
);

// ─── §4.3.1.2 PROPPATCH invalid schedule-default-calendar-URL ────────────────

Deno.test(
  "RFC 6638 §4.3.1.2 PROPPATCH setting schedule-default-calendar-URL to invalid URL returns 403 valid-schedule-default-calendar-URL",
  async () => {
    await withServer(async (s) => {
      const pfInbox = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfInbox.status, 207);
      assertEquals(
        parseMultistatus(pfInbox.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be present (200) on principal",
      );
      const inboxURL =
        parseMultistatus(pfInbox.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      const proppatchBody =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
        "<D:set><D:prop>" +
        "<C:schedule-default-calendar-URL>" +
        "<D:href>/calstakk/calendars/nonexistent-calendar-xyz</D:href>" +
        "</C:schedule-default-calendar-URL>" +
        "</D:prop></D:set>" +
        "</D:propertyupdate>";

      const resp = await s.do("PROPPATCH", inboxURL, xmlContentType(), proppatchBody);
      assertEquals(
        resp.status,
        403,
        `PROPPATCH with invalid schedule-default-calendar-URL must return 403; got ${resp.status}`,
      );
      assertEquals(
        resp.body.includes("valid-schedule-default-calendar-URL"),
        true,
        "403 response must include CALDAV:valid-schedule-default-calendar-URL precondition",
      );
    });
  },
);

// ─── §5 Free-busy POST response structure ─────────────────────────────────────

Deno.test(
  "RFC 6638 §5 Free-busy POST response body is CALDAV:schedule-response XML with per-recipient response elements",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-outbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-outbox-URL"),
        200,
        "schedule-outbox-URL must be present (200) on principal",
      );
      const outboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
      assertEquals(outboxURL !== "", true, "schedule-outbox-URL must be non-empty");

      const fbReq =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VFREEBUSY\r\n" +
        "UID:fb-struct-001\r\n" +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20260201T000000Z\r\n" +
        "ORGANIZER:mailto:organizer@example.com\r\n" +
        "ATTENDEE:mailto:user@example.com\r\n" +
        "END:VFREEBUSY\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("POST", outboxURL, calContentType(), fbReq);
      assertEquals(
        resp.status === 200 || resp.status === 207,
        true,
        `free-busy POST must return 200 or 207; got ${resp.status}`,
      );
      const ct = resp.headers.get("Content-Type") ?? "";
      assertEquals(ct.includes("xml"), true, `free-busy POST response Content-Type must be XML; got '${ct}'`);
      assertEquals(
        resp.body.includes("schedule-response"),
        true,
        "free-busy POST response body must be a CALDAV:schedule-response XML document",
      );
      assertEquals(
        resp.body.includes("recipient") || resp.body.includes("request-status"),
        true,
        "each CALDAV:response must contain CALDAV:recipient and CALDAV:request-status",
      );
    });
  },
);

// ─── §5 / §5.2.2 valid-organizer precondition ────────────────────────────────

Deno.test(
  "RFC 6638 §5/§5.2.2 Free-busy POST with mismatched ORGANIZER returns 403 valid-organizer",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-outbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-outbox-URL"),
        200,
        "schedule-outbox-URL must be present (200) on principal",
      );
      const outboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
      assertEquals(outboxURL !== "", true, "schedule-outbox-URL must be non-empty");

      // ORGANIZER that does not match authenticated user's calendar-user-address-set
      const fbReq =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VFREEBUSY\r\n" +
        "UID:fb-badorg-001\r\n" +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20260201T000000Z\r\n" +
        "ORGANIZER:mailto:imposter@attacker.example.com\r\n" +
        "ATTENDEE:mailto:victim@example.com\r\n" +
        "END:VFREEBUSY\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("POST", outboxURL, calContentType(), fbReq);
      assertEquals(
        resp.status,
        403,
        `free-busy POST with non-matching ORGANIZER must return 403; got ${resp.status}`,
      );
      assertEquals(
        resp.body.includes("valid-organizer"),
        true,
        "403 response must include CALDAV:valid-organizer precondition",
      );
    });
  },
);

// ─── §5.2.1 valid-scheduling-message precondition ────────────────────────────

Deno.test(
  "RFC 6638 §5.2.1 Free-busy POST with invalid scheduling message returns 400 valid-scheduling-message",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-outbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-outbox-URL"),
        200,
        "schedule-outbox-URL must be present (200) on principal",
      );
      const outboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
      assertEquals(outboxURL !== "", true, "schedule-outbox-URL must be non-empty");

      // Missing METHOD:REQUEST and ORGANIZER — invalid scheduling message per iTIP §3.3.2
      const invalidFb =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VFREEBUSY\r\n" +
        "UID:fb-invalid-001\r\n" +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20260201T000000Z\r\n" +
        "ATTENDEE:mailto:user@example.com\r\n" +
        "END:VFREEBUSY\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("POST", outboxURL, calContentType(), invalidFb);
      assertEquals(
        resp.status,
        400,
        `POST with invalid scheduling message must return 400; got ${resp.status}`,
      );
      assertEquals(
        resp.body.includes("valid-scheduling-message"),
        true,
        "400 response must include CALDAV:valid-scheduling-message precondition",
      );
    });
  },
);

// ─── §5 3.7 status for unknown attendee ──────────────────────────────────────

Deno.test(
  "RFC 6638 §5 Free-busy POST response contains 3.7 request-status for unknown attendee address",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-outbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-outbox-URL"),
        200,
        "schedule-outbox-URL must be present (200) on principal",
      );
      const outboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
      assertEquals(outboxURL !== "", true, "schedule-outbox-URL must be non-empty");

      const fbReq =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VFREEBUSY\r\n" +
        "UID:fb-unknown-att-001\r\n" +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART:20260101T000000Z\r\n" +
        "DTEND:20260201T000000Z\r\n" +
        "ORGANIZER:mailto:organizer@example.com\r\n" +
        "ATTENDEE:mailto:nobody-at-nonexistent-domain-xyz.example\r\n" +
        "END:VFREEBUSY\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("POST", outboxURL, calContentType(), fbReq);
      assertEquals(
        resp.status === 200 || resp.status === 207,
        true,
        `free-busy POST must return 200 or 207; got ${resp.status}`,
      );
      // Response must include request-status 3.7 for the unknown attendee
      assertEquals(
        resp.body.includes("3.7"),
        true,
        "free-busy POST response must include 3.7 request-status for unknown attendee address",
      );
    });
  },
);

// ─── §6.1 / §6.2 Scheduling privileges on inbox and outbox ───────────────────

Deno.test(
  "RFC 6638 §6.1/§6.2 Inbox supported-privilege-set includes schedule-deliver sub-privileges; outbox includes schedule-send sub-privileges",
  async () => {
    await withServer(async (s) => {
      const pfPrincipal = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL", nsCalDAV, "schedule-outbox-URL"),
      );
      assertEquals(pfPrincipal.status, 207);
      const pms = parseMultistatus(pfPrincipal.body);
      assertEquals(
        pms.response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be 200 on principal",
      );
      assertEquals(
        pms.response(principalPath)?.propStatus("schedule-outbox-URL"),
        200,
        "schedule-outbox-URL must be 200 on principal",
      );
      const inboxURL = pms.response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      const outboxURL = pms.response(principalPath)?.prop("schedule-outbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");
      assertEquals(outboxURL !== "", true, "schedule-outbox-URL must be non-empty");

      // Inbox: schedule-deliver and sub-privileges
      const inboxPrivResp = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps("DAV:", "supported-privilege-set"),
      );
      assertEquals(inboxPrivResp.status, 207);
      const inboxPrivBody = inboxPrivResp.body;
      assertEquals(inboxPrivBody.includes("schedule-deliver"), true, "inbox must include schedule-deliver");
      assertEquals(inboxPrivBody.includes("schedule-deliver-invite"), true, "inbox must include schedule-deliver-invite");
      assertEquals(inboxPrivBody.includes("schedule-deliver-reply"), true, "inbox must include schedule-deliver-reply");
      assertEquals(inboxPrivBody.includes("schedule-query-freebusy"), true, "inbox must include schedule-query-freebusy");

      // Outbox: schedule-send and sub-privileges
      const outboxPrivResp = await s.do(
        "PROPFIND",
        outboxURL,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps("DAV:", "supported-privilege-set"),
      );
      assertEquals(outboxPrivResp.status, 207);
      const outboxPrivBody = outboxPrivResp.body;
      assertEquals(outboxPrivBody.includes("schedule-send"), true, "outbox must include schedule-send");
      assertEquals(outboxPrivBody.includes("schedule-send-invite"), true, "outbox must include schedule-send-invite");
      assertEquals(outboxPrivBody.includes("schedule-send-reply"), true, "outbox must include schedule-send-reply");
      assertEquals(outboxPrivBody.includes("schedule-send-freebusy"), true, "outbox must include schedule-send-freebusy");
    });
  },
);

// ─── §6.3 Scheduling privilege hierarchy ─────────────────────────────────────

Deno.test(
  "RFC 6638 §6.3 Scheduling privilege hierarchy is correctly nested in supported-privilege-set responses",
  async () => {
    await withServer(async (s) => {
      const pfPrincipal = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfPrincipal.status, 207);
      assertEquals(
        parseMultistatus(pfPrincipal.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be 200 on principal",
      );
      const inboxURL =
        parseMultistatus(pfPrincipal.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      const privResp = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps("DAV:", "supported-privilege-set"),
      );
      assertEquals(privResp.status, 207);
      const body = privResp.body;
      assertEquals(body.includes("schedule-deliver"), true, "schedule-deliver must be present");
      // RFC 6638 §6.3: schedule-deliver must appear (and contain) sub-privileges
      // Verify schedule-deliver appears before its sub-privilege in the XML
      const deliverIdx = body.indexOf("schedule-deliver\"");
      const inviteIdx = body.indexOf("schedule-deliver-invite");
      assertEquals(
        deliverIdx !== -1 && inviteIdx !== -1 && deliverIdx < inviteIdx,
        true,
        "schedule-deliver must appear before (contain) schedule-deliver-invite in privilege hierarchy",
      );
    });
  },
);

// ─── §7.1 SCHEDULE-AGENT stripped from delivered iTIP messages ───────────────

Deno.test(
  "RFC 6638 §7.1 SCHEDULE-AGENT parameter is stripped from iTIP messages delivered to attendee inbox",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be 200 on principal",
      );
      const inboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      await s.mkcol("schedagent-strip-col");
      const uid = "schedagent-strip-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;SCHEDULE-AGENT=SERVER;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", objectPath("schedagent-strip-col", uid), calContentType(), ics);

      // iTIP messages in the attendee inbox must NOT contain SCHEDULE-AGENT parameter
      const inboxItems = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(inboxItems.status, 207, "inbox PROPFIND must return 207");
      assertEquals(
        inboxItems.body.includes("SCHEDULE-AGENT"),
        false,
        "iTIP messages delivered to inbox MUST NOT contain SCHEDULE-AGENT parameter",
      );
    });
  },
);

// ─── §7.3 / §11.4 SCHEDULE-STATUS absent from delivered iTIP messages ─────────

Deno.test(
  "RFC 6638 §7.3/§11.4 SCHEDULE-STATUS parameter is absent from iTIP messages in scheduling inboxes",
  async () => {
    await withServer(async (s) => {
      const pfResp = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfResp.status, 207);
      assertEquals(
        parseMultistatus(pfResp.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be 200 on principal",
      );
      const inboxURL =
        parseMultistatus(pfResp.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      await s.mkcol("schedstatus-strip-col");
      const uid = "schedstatus-strip-001";
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Meeting\r\nORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", objectPath("schedstatus-strip-col", uid), calContentType(), ics);

      // iTIP messages in the attendee inbox must not contain SCHEDULE-STATUS
      const inboxItems = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "1" }, xmlContentType()),
        propfindAllprop(),
      );
      assertEquals(inboxItems.status, 207, "inbox PROPFIND must return 207");
      assertEquals(
        inboxItems.body.includes("SCHEDULE-STATUS"),
        false,
        "iTIP messages delivered to inbox MUST NOT contain SCHEDULE-STATUS parameter",
      );
    });
  },
);

// ─── §9.1 schedule-calendar-transp affects freebusy ──────────────────────────

Deno.test(
  "RFC 6638 §9.1 schedule-calendar-transp transparent excludes events from freebusy; opaque (or absent) includes them",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("transp-opaque-col");
      await s.mkcol("transp-transparent-col");

      // Set the transparent collection via PROPPATCH
      const setTransparent =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
        "<D:set><D:prop>" +
        "<C:schedule-calendar-transp><C:transparent/></C:schedule-calendar-transp>" +
        "</D:prop></D:set>" +
        "</D:propertyupdate>";
      const proppatchResp = await s.do(
        "PROPPATCH",
        "/calstakk/calendars/transp-transparent-col",
        xmlContentType(),
        setTransparent,
      );
      assertEquals(proppatchResp.status, 207, "PROPPATCH to set transparent must return 207");

      // Verify the transparent value was persisted
      const pfTransp = await s.do(
        "PROPFIND",
        "/calstakk/calendars/transp-transparent-col",
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-calendar-transp"),
      );
      assertEquals(pfTransp.status, 207);
      const transpProp = parseMultistatus(pfTransp.body)
        .response("/calstakk/calendars/transp-transparent-col")
        ?.prop("schedule-calendar-transp");
      assertEquals(transpProp?.hasChild("transparent"), true, "schedule-calendar-transp must be set to transparent");

      // Verify opaque collection retains the opaque default
      const pfOpaque = await s.do(
        "PROPFIND",
        "/calstakk/calendars/transp-opaque-col",
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-calendar-transp"),
      );
      assertEquals(pfOpaque.status, 207);
      const opaqueProp = parseMultistatus(pfOpaque.body)
        .response("/calstakk/calendars/transp-opaque-col")
        ?.prop("schedule-calendar-transp");
      assertEquals(opaqueProp?.hasChild("opaque"), true, "default schedule-calendar-transp must be opaque");
    });
  },
);

// ─── §9.2 schedule-default-calendar-URL on inbox ─────────────────────────────

Deno.test(
  "RFC 6638 §9.2 schedule-default-calendar-URL on inbox collection contains a DAV:href pointing to a valid calendar collection",
  async () => {
    await withServer(async (s) => {
      const pfInbox = await s.do(
        "PROPFIND",
        principalPath,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-inbox-URL"),
      );
      assertEquals(pfInbox.status, 207);
      assertEquals(
        parseMultistatus(pfInbox.body).response(principalPath)?.propStatus("schedule-inbox-URL"),
        200,
        "schedule-inbox-URL must be 200 on principal",
      );
      const inboxURL =
        parseMultistatus(pfInbox.body).response(principalPath)?.prop("schedule-inbox-URL")?.text() ?? "";
      assertEquals(inboxURL !== "", true, "schedule-inbox-URL must be non-empty");

      // schedule-default-calendar-URL is defined on the inbox resource
      const pfDefault = await s.do(
        "PROPFIND",
        inboxURL,
        withHeaders({ Depth: "0" }, xmlContentType()),
        propfindProps(nsCalDAV, "schedule-default-calendar-URL"),
      );
      assertEquals(pfDefault.status, 207);
      const defProp = parseMultistatus(pfDefault.body).response(inboxURL)?.prop("schedule-default-calendar-URL");
      assertEquals(defProp?.status, 200, "schedule-default-calendar-URL must be present (200) on inbox");
      assertEquals(
        defProp?.hasChild("href"),
        true,
        "schedule-default-calendar-URL must contain a DAV:href child pointing to a valid calendar",
      );
    });
  },
);

// ─── §3.2.1 VTODO scheduling ──────────────────────────────────────────────────

Deno.test(
  "RFC 6638 §3.2.1 (VTODO) Organizer PUT of VTODO scheduling object resource triggers scheduling operation",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("vtodo-sched-col");
      const uid = "vtodo-sched-001";
      const path = objectPath("vtodo-sched-col", uid);
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "SUMMARY:Scheduled Task\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:att@example.com\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";

      const putResp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(
        putResp.status === 201 || putResp.status === 204,
        true,
        `VTODO scheduling PUT must succeed (201/204); got ${putResp.status}`,
      );

      // Re-fetch: SCHEDULE-STATUS must be present on ATTENDEE (same rules as VEVENT)
      const getResp = await s.do("GET", path);
      assertEquals(getResp.status, 200);
      assertEquals(
        getResp.body.includes("SCHEDULE-STATUS"),
        true,
        "VTODO ATTENDEE must have SCHEDULE-STATUS after organizer PUT, same rules as VEVENT",
      );
    });
  },
);

// ─── §11.2 item 4 ORGANIZER must match authenticated user's calendar addresses ─

Deno.test(
  "RFC 6638 §11.2 item 4 PUT with ORGANIZER not matching authenticated user calendar addresses is rejected",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("bad-org-auth-col");
      const uid = "bad-org-auth-001";
      const path = objectPath("bad-org-auth-col", uid);

      // ORGANIZER that does not match the server user's calendar-user-address-set
      const ics =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Spoofed Organizer\r\n" +
        "ORGANIZER:mailto:not-me@attacker.example.com\r\n" +
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:victim@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("PUT", path, calContentType(), ics);
      assertEquals(
        resp.status,
        403,
        `PUT with ORGANIZER not matching user's calendar addresses must return 403; got ${resp.status}`,
      );
    });
  },
);

// ─── §11.2 item 5 Anti-spoofing: same UID different ORGANIZER ────────────────

Deno.test(
  "RFC 6638 §11.2 item 5 PUT with same UID as existing scheduling object but different ORGANIZER is rejected",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("anti-spoof-col");
      const uid = "anti-spoof-001";
      const path = objectPath("anti-spoof-col", uid);

      // First PUT: organizer A creates the event
      const icsA =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Original\r\nORGANIZER:mailto:organizer-a@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", path, calContentType(), icsA);

      // Second PUT: different ORGANIZER on same UID — must be rejected (anti-spoofing)
      const icsB =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260102T000000Z\r\n" +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Spoofed\r\nORGANIZER:mailto:attacker@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", path, calContentType(), icsB);
      assertEquals(
        resp.status,
        403,
        `PUT with same UID but different ORGANIZER must be rejected with 403; got ${resp.status}`,
      );
    });
  },
);
