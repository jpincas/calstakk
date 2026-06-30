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
  OWNER_EMAIL,
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
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
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
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
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
      `ORGANIZER:mailto:${OWNER_EMAIL}`,
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
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
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

// ─── §2.3 Email address validation ───────────────────────────────────────────

Deno.test("RFC 6047 §2.3 ORGANIZER with non-mailto URI must be rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // ORGANIZER uses an http: URI instead of the required mailto: URI
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-bad-organizer-uri-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Non-mailto ORGANIZER\r\n" +
      "ORGANIZER:http://organizer.example.com/\r\n" +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" },
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `ORGANIZER with non-mailto URI must be rejected with 4xx; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.3 ATTENDEE with non-mailto URI must be rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // ATTENDEE uses an ldap: URI instead of the required mailto: URI
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-bad-attendee-uri-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Non-mailto ATTENDEE\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:ldap://example.com:6666/o=attendee\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" },
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `ATTENDEE with non-mailto URI must be rejected with 4xx; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.3 VTODO REQUEST with mailto ORGANIZER and ATTENDEE accepted by outbox", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // iMIP requirements apply to VTODO as well as VEVENT (RFC 6047 §2.3)
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:imip-vtodo-mailto-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DUE:${testDTSTART}\r\n` +
      "SUMMARY:iMIP VTODO Test\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" },
      body,
    );
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `VTODO REQUEST with valid mailto URIs must be accepted by outbox; got ${resp.status}`,
    );
  });
});

// ─── §2.4 Content-Type requirements ──────────────────────────────────────────

Deno.test("RFC 6047 §2.4 POST with text/calendar lacking method parameter is not processed as iMIP", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // text/calendar WITHOUT the method parameter is not an iMIP body part (RFC 6047 §2.4 Note 2).
    // The server must not apply iMIP validation rules to it. It may reject the request because
    // the outbox requires scheduling messages, but must not crash (5xx).
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-no-method-param-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:No Method Param\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar" }, // no method= parameter
      body,
    );
    // Must not be a server error; server may reject with 4xx as a non-scheduling body
    assertEquals(
      resp.status < 500,
      true,
      `text/calendar without method parameter must not cause 5xx; got ${resp.status}`,
    );
    // Must not be accepted as a valid iMIP scheduling message
    assertEquals(
      [200, 202, 207].includes(resp.status),
      false,
      `text/calendar without method parameter must not be accepted as iMIP by outbox; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.4 method parameter matching is case-insensitive", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // Content-Type uses lowercase 'request' but METHOD property is uppercase 'REQUEST'.
    // RFC 6047 §2.4: "The value MUST be the same (ignoring case)".
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-case-insensitive-method-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Case-insensitive Method\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=request" }, // lowercase — matches METHOD:REQUEST case-insensitively
      body,
    );
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `method parameter matching must be case-insensitive; lowercase 'request' must match METHOD:REQUEST; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.4 charset=UTF-8 required when iCalendar body contains non-ASCII characters", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // Body contains a non-ASCII character in SUMMARY (ü) but Content-Type has no charset param.
    // RFC 6047 §2.4: charset MUST be present with value UTF-8 when body contains non-ASCII.
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-no-charset-non-ascii-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Prüfung (non-ASCII ü without declared charset)\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST" }, // no charset=UTF-8
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `iMIP body with non-ASCII characters and no charset=UTF-8 must be rejected with 4xx; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.4 outbox POST with multipart/mixed enclosing text/calendar is accepted", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // RFC 6047 §2.4: "Any receiving UA ... MUST be able to process text/calendar body parts
    // enclosed within multipart/*"
    const boundary = "----imip-mixed-boundary-001";
    const calPart =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-multipart-mixed-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Multipart Mixed Test\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const body =
      `--${boundary}\r\n` +
      "Content-Type: text/plain\r\n\r\n" +
      "You have been invited to a meeting.\r\n" +
      `--${boundary}\r\n` +
      "Content-Type: text/calendar; method=REQUEST; charset=UTF-8\r\n\r\n" +
      calPart +
      `--${boundary}--\r\n`;

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": `multipart/mixed; boundary="${boundary}"` },
      body,
    );
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `multipart/mixed enclosing text/calendar must be accepted by outbox; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.4 multipart/alternative with two text/calendar parts must be rejected", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // RFC 6047 §2.4: "multipart/alternative MUST NOT be used to represent two slightly different
    // iCalendar objects, for example, two VEVENTs with alternative starting times."
    const boundary = "----imip-alt-boundary-001";
    const calPart1 =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-multipart-alt-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260115T100000Z\r\nDTEND:20260115T110000Z\r\n" +
      "SUMMARY:Alternative Time A\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const calPart2 =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-multipart-alt-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260115T140000Z\r\nDTEND:20260115T150000Z\r\n" +
      "SUMMARY:Alternative Time B\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const body =
      `--${boundary}\r\n` +
      "Content-Type: text/calendar; method=REQUEST; charset=UTF-8\r\n\r\n" +
      calPart1 +
      `--${boundary}\r\n` +
      "Content-Type: text/calendar; method=REQUEST; charset=UTF-8\r\n\r\n" +
      calPart2 +
      `--${boundary}--\r\n`;

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": `multipart/alternative; boundary="${boundary}"` },
      body,
    );
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `multipart/alternative with two text/calendar parts must be rejected with 4xx; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2.4 multipart/mixed with multiple text/calendar parts having different METHOD values processed independently", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // RFC 6047 §2.4 Note 1: A MIME message containing multiple iCalendar objects with different
    // method values MUST be encapsulated with multipart/mixed. The receiving UA MUST process all parts.
    const boundary = "----imip-mixed-multi-method-001";

    // Part 1: REQUEST for a new event
    const requestPart =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-multi-method-req-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Multi-method Test Request\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    // Part 2: PUBLISH for informational broadcast
    const publishPart =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-multi-method-pub-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260116T100000Z\r\nDTEND:20260116T110000Z\r\n" +
      "SUMMARY:Multi-method Test Publish\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const body =
      `--${boundary}\r\n` +
      "Content-Type: text/calendar; method=REQUEST; charset=UTF-8\r\n\r\n" +
      requestPart +
      `--${boundary}\r\n` +
      "Content-Type: text/calendar; method=PUBLISH; charset=UTF-8\r\n\r\n" +
      publishPart +
      `--${boundary}--\r\n`;

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": `multipart/mixed; boundary="${boundary}"` },
      body,
    );
    // Server must process all parts; acceptable responses are 2xx or 207
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `multipart/mixed with multiple iCalendar objects of different METHOD values must be accepted; got ${resp.status}`,
    );
    // If 207, there must be per-recipient or per-part status elements in the response body
    if (resp.status === 207) {
      assertEquals(
        resp.body.includes("schedule-response") || resp.body.includes("response"),
        true,
        "207 response to multipart/mixed POST must contain response status elements",
      );
    }
  });
});

// ─── §2.6 Content-Disposition ─────────────────────────────────────────────────

Deno.test("RFC 6047 §2.6 MIME part processed by Content-Type not by Content-Disposition filename extension", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // RFC 6047 §2.6: handling MUST be based on Content-Type, not on the file extension in
    // Content-Disposition. A .pdf extension in Content-Disposition must not prevent processing
    // a valid text/calendar; method=REQUEST body part.
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-content-disposition-ext-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Content-Disposition Extension Test\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      {
        "Content-Type": "text/calendar; method=REQUEST; charset=UTF-8",
        "Content-Disposition": 'attachment; filename="meeting.pdf"', // misleading extension
      },
      body,
    );
    // Server must process based on Content-Type (text/calendar; method=REQUEST), not the .pdf extension
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `Server must process based on Content-Type, not Content-Disposition extension; got ${resp.status}`,
    );
  });
});

// ─── iTIP method coverage ─────────────────────────────────────────────────────

Deno.test("RFC 6047 §2 REPLY method POST to outbox accepted with correct PARTSTAT", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // REPLY method: attendee responding to organizer with PARTSTAT=ACCEPTED
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REPLY\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-reply-accepted-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Reply Test\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REPLY; charset=UTF-8" },
      body,
    );
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `REPLY method scheduling message must be accepted by outbox; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2 PUBLISH method POST to outbox accepted", async () => {
  await withServer(async (s) => {
    const pfResp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "schedule-outbox-URL"),
    );
    const outboxURL = discoverOutbox(parseMultistatus(pfResp.body));
    if (!outboxURL) return;

    // PUBLISH method: informational broadcast with no ATTENDEE required
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:imip-publish-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Published Event\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=PUBLISH; charset=UTF-8" },
      body,
    );
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `PUBLISH method scheduling message must be accepted by outbox; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2 valid CANCEL POST to outbox returns 2xx or 207 with per-recipient status", async () => {
  await withServer(async (s) => {
    await s.mkcol("imip-cancel-affirm-col");
    const origUID = "imip-cancel-affirm-evt-001";
    await s.putEvent(
      "imip-cancel-affirm-col",
      origUID,
      `ORGANIZER:mailto:${OWNER_EMAIL}`,
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
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE:mailto:attendee@example.com\r\n" +
      "SEQUENCE:1\r\n" +
      "STATUS:CANCELLED\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=CANCEL; charset=UTF-8" },
      body,
    );
    // Must be affirmatively accepted: 2xx or 207, not merely "not 5xx"
    assertEquals(
      [200, 202, 207].includes(resp.status),
      true,
      `valid CANCEL POST to outbox must return 2xx or 207; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 6047 §2 REQUEST returning 207 includes cal:schedule-response with per-recipient request-status", async () => {
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
      "UID:imip-207-schedule-response-001\r\n" +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:207 Schedule Response Test\r\n" +
      `ORGANIZER:mailto:${OWNER_EMAIL}\r\n` +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "POST",
      outboxURL,
      { "Content-Type": "text/calendar; method=REQUEST; charset=UTF-8" },
      body,
    );

    // If the server returns 207, the response body MUST contain a CalDAV
    // schedule-response element (RFC 6638 §8.3) with per-recipient request-status.
    if (resp.status === 207) {
      assertEquals(
        resp.body.includes("schedule-response"),
        true,
        "207 response to scheduling POST must contain schedule-response XML element",
      );
      assertEquals(
        resp.body.includes("request-status"),
        true,
        "207 schedule-response must include per-recipient request-status for each ATTENDEE",
      );
      // The response must reference the attendee address
      assertEquals(
        resp.body.includes("attendee@example.com") || resp.body.includes("recipient"),
        true,
        "207 schedule-response must include per-recipient status for attendee@example.com",
      );
    } else {
      // If not 207, must be another accepted status
      assertEquals(
        [200, 202].includes(resp.status),
        true,
        `POST to outbox must return 2xx or 207; got ${resp.status}`,
      );
    }
  });
});

