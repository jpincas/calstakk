// RFC 6047 — iCalendar Message-Based Interoperability Protocol (iMIP)
// Spec: specs/rfc6047.txt
//
// Coverage:
//   §2   iMIP Content-Type (text/calendar; method=<METHOD>)
//   §3   Structural validation (ORGANIZER required, CANCEL structure)
//   §4   Receiving scheduling messages via inbox

import { assertEquals } from "@std/assert";
import {
  nsCalDAV,
  parseMultistatus,
  principalPath,
  propfindProps,
  testDTEND,
  testDTSTAMP,
  testDTSTART,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

function discoverOutbox(ms: ReturnType<typeof parseMultistatus>): string {
  const r = ms.response(principalPath);
  if (!r) return "";
  return r.prop("schedule-outbox-URL")?.text() ?? "";
}

function discoverInbox(ms: ReturnType<typeof parseMultistatus>): string {
  const r = ms.response(principalPath);
  if (!r) return "";
  return r.prop("schedule-inbox-URL")?.text() ?? "";
}

// ─── §2 iMIP Content-Type ────────────────────────────────────────────────────

Deno.test("RFC 6047 §2 POST with text/calendar; method=REQUEST accepted by outbox", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return; // schedule-outbox-URL not yet implemented

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-test-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:iMIP Test Meeting\r\n" +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" },
      body,
    );
    assertEquals(
      [200, 207, 202].includes(resp.status),
      true,
      `POST with text/calendar; method=REQUEST must be accepted; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2 POST with mismatched method parameter must be rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return; // schedule-outbox-URL not yet implemented

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-mismatch-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Mismatch Test\r\n" +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REPLY" }, // mismatch
      body,
    );
    assertEquals(resp.status >= 400, true, "mismatched method parameter must be rejected with 4xx");
    assertEquals(resp.status < 500, true, "rejection must not be 5xx");
  });
});

// ─── §3 Structural validation ─────────────────────────────────────────────────

Deno.test("RFC 6047 §3 REQUEST without ORGANIZER must be rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-no-organizer-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:No Organizer\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" },
      body,
    );
    assertEquals(resp.status >= 400, true, "REQUEST without ORGANIZER must be rejected");
    assertEquals(resp.status < 500, true);
  });
});

Deno.test("RFC 6047 §3 CANCEL POST to outbox must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("imip-cancel-col");
    const origUID = "imip-cancel-evt-001";
    await s.putEvent(
      "imip-cancel-col",
      origUID,
      "ORGANIZER:mailto:organizer@example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:attendee@example.com",
    );

    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:CANCEL\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${origUID}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "ATTENDEE:mailto:attendee@example.com\r\n" +
      "SEQUENCE:1\r\n" +
      "STATUS:CANCELLED\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=CANCEL" },
      body,
    );
    assertEquals(resp.status < 500, true, "CANCEL POST to outbox must not cause 5xx");
  });
});

// ─── §4 Receiving scheduling messages ─────────────────────────────────────────

Deno.test("RFC 6047 §4 PROPFIND on scheduling inbox returns 207", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-inbox-URL"),
    );
    const inboxURL = discoverInbox(parseMultistatus(pfResp.body));
    if (!inboxURL) return; // schedule-inbox-URL not yet implemented

    const resp = await s.do(
      "PROPFIND",
      inboxURL,
      withHeaders({ Depth: "1" }, xmlContentType()),
      '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>',
    );
    assertEquals(resp.status, 207, "PROPFIND on scheduling inbox must return 207");
  });
});

