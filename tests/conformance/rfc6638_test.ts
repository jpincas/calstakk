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
    const p = r!.prop("schedule-inbox-URL");
    assertEquals(p !== undefined, true, "schedule-inbox-URL must appear in PROPFIND");
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
    const p = r!.prop("schedule-outbox-URL");
    assertEquals(p !== undefined, true, "schedule-outbox-URL must appear in PROPFIND");
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
    const p = r!.prop("calendar-user-address-set");
    assertEquals(p !== undefined, true, "calendar-user-address-set must appear in PROPFIND");
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

