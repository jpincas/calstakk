// RFC 5546 — iCalendar Transport-Independent Interoperability Protocol (iTIP)
// Spec: specs/rfc5546.txt
//
// Coverage:
//   §1.4  METHOD property values on stored objects
//   §3.2  VEVENT SEQUENCE-based update semantics
//   §4.2  VTODO SEQUENCE-based update semantics
//   §3.2.1 / §4.2.1 ATTENDEE PARTSTAT values

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  calContentType,
  objectPath,
  testDTEND,
  testDTSTAMP,
  testDTSTART,
  withServer,
} from "./harness.ts";

// ─── §1.4 METHOD values on stored objects ────────────────────────────────────

Deno.test("RFC 5546 §1.4 PUT with METHOD:REQUEST must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("itip-col");
    const uid = "itip-request-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Team Meeting\r\n" +
      "ORGANIZER:mailto:organizer@example.com\r\n" +
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
      "SEQUENCE:0\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("itip-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "PUT with METHOD:REQUEST must not cause 5xx");
  });
});

Deno.test("RFC 4791 §4.1 CalDAV must reject VCALENDAR with METHOD in calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("nomethod-col");
    const uid = "method-reject-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "METHOD:REQUEST\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "SUMMARY:Todo with METHOD\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("nomethod-col", uid), calContentType(), body);
    assertEquals(
      resp.status >= 400,
      true,
      `CalDAV must reject VCALENDAR with METHOD; got ${resp.status}`,
    );
    assertEquals(resp.status < 500, true, "Rejection must be 4xx not 5xx");
  });
});

// ─── §3.2 SEQUENCE-based update semantics ─────────────────────────────────────

Deno.test("RFC 5546 §3.2 SEQUENCE increment on VEVENT update succeeds (204)", async () => {
  await withServer(async (s) => {
    await s.mkcol("seq-update-col");
    const uid = "seq-update-001";
    await s.putEvent("seq-update-col", uid, "SEQUENCE:0");

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Updated Event\r\n" +
      "SEQUENCE:1\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("seq-update-col", uid), calContentType(), body);
    assertEquals(resp.status, 204, "update with incremented SEQUENCE must succeed (204)");

    const getResp = await s.do("GET", objectPath("seq-update-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "SEQUENCE:1");
  });
});

Deno.test("RFC 5546 §4.2 SEQUENCE increment on VTODO update succeeds (204)", async () => {
  await withServer(async (s) => {
    await s.mkcol("todo-seq-col");
    const uid = "todo-seq-001";
    await s.putTodo("todo-seq-col", uid, "SEQUENCE:0");

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "SUMMARY:Updated Todo\r\n" +
      "SEQUENCE:1\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("todo-seq-col", uid), calContentType(), body);
    assertEquals(resp.status, 204);

    const getResp = await s.do("GET", objectPath("todo-seq-col", uid));
    assertStringIncludes(getResp.body, "SEQUENCE:1");
  });
});

// ─── §3.2.1 / §4.2.1 PARTSTAT values ─────────────────────────────────────────

Deno.test("RFC 5546 §3.2.1 ATTENDEE PARTSTAT values roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("partstat-col");
    const partStats = ["NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"];
    for (const ps of partStats) {
      const uid = `partstat-${ps}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        `SUMMARY:PARTSTAT test ${ps}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        `ATTENDEE;PARTSTAT=${ps}:mailto:att@example.com\r\n` +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const putResp = await s.do("PUT", objectPath("partstat-col", uid), calContentType(), body);
      assertEquals(putResp.status, 201, `PUT with PARTSTAT:${ps} failed`);

      const getResp = await s.do("GET", objectPath("partstat-col", uid));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, `PARTSTAT=${ps}`, `PARTSTAT:${ps} must round-trip`);
    }
  });
});

// ─── §3 REQUEST-STATUS round-trip ─────────────────────────────────────────────

Deno.test("RFC 5546 §3 REQUEST-STATUS property roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("reqstatus-col");
    const uid = "reqstatus-event-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Request Status Test\r\n" +
      "REQUEST-STATUS:2.0;Success\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("reqstatus-col", uid), calContentType(), body);
    assertEquals(resp.status, 201);

    const getResp = await s.do("GET", objectPath("reqstatus-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "REQUEST-STATUS:2.0;Success");
  });
});
