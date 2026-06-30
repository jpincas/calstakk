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

// ─── §2.1.4 SEQUENCE MUST NOT be incremented in REPLY/REFRESH/COUNTER/DECLINECOUNTER ───

Deno.test(
  "RFC 5546 §2.1.4 SEQUENCE MUST NOT be incremented in REPLY/REFRESH/COUNTER/DECLINECOUNTER",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("seq214-col");

      // REPLY with incremented SEQUENCE violates §2.1.4
      const replyUid = "seq214-reply";
      const replyBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REPLY\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${replyUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Reply\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
        "SEQUENCE:3\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const replyResp = await s.do(
        "PUT",
        objectPath("seq214-col", replyUid),
        calContentType(),
        replyBody,
      );
      assertEquals(
        replyResp.status >= 400,
        true,
        `METHOD:REPLY with incremented SEQUENCE must be rejected; got ${replyResp.status}`,
      );
      assertEquals(replyResp.status < 500, true, "rejection must be 4xx not 5xx");

      // REFRESH with SEQUENCE present violates §2.1.4 and §3.2.6
      const refreshUid = "seq214-refresh";
      const refreshBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REFRESH\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${refreshUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const refreshResp = await s.do(
        "PUT",
        objectPath("seq214-col", refreshUid),
        calContentType(),
        refreshBody,
      );
      assertEquals(
        refreshResp.status >= 400,
        true,
        `METHOD:REFRESH with SEQUENCE must be rejected; got ${refreshResp.status}`,
      );
      assertEquals(refreshResp.status < 500, true, "rejection must be 4xx not 5xx");

      // COUNTER and DECLINECOUNTER MUST echo original SEQUENCE, not increment
      for (const method of ["COUNTER", "DECLINECOUNTER"]) {
        const uid = `seq214-${method.toLowerCase()}`;
        const body =
          "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
          `METHOD:${method}\r\n` +
          "BEGIN:VEVENT\r\n" +
          `UID:${uid}\r\n` +
          `DTSTAMP:${testDTSTAMP}\r\n` +
          `DTSTART:${testDTSTART}\r\n` +
          `DTEND:${testDTEND}\r\n` +
          "SUMMARY:Counter\r\n" +
          "ORGANIZER:mailto:org@example.com\r\n" +
          "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com\r\n" +
          "SEQUENCE:5\r\n" + // original was 2, incremented to 5 — violation
          "END:VEVENT\r\nEND:VCALENDAR\r\n";
        const resp = await s.do("PUT", objectPath("seq214-col", uid), calContentType(), body);
        assertEquals(
          resp.status >= 400,
          true,
          `METHOD:${method} with incremented SEQUENCE must be rejected; got ${resp.status}`,
        );
        assertEquals(resp.status < 500, true, `rejection for METHOD:${method} must be 4xx not 5xx`);
      }
    });
  },
);

// ─── §2.1.4 ADD and CANCEL SEQUENCE MUST be incremented (> 0 for ADD) ────────

Deno.test(
  "RFC 5546 §2.1.4 ADD and CANCEL SEQUENCE MUST be incremented (> 0 for ADD)",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("seq214-addcancel-col");

      // METHOD:ADD with SEQUENCE:0 violates §2.1.4 (MUST be > 0)
      const addUid = "seq214-add-001";
      const addBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:ADD\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${addUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Add instance\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "SEQUENCE:0\r\n" + // MUST be > 0 for ADD
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const addResp = await s.do(
        "PUT",
        objectPath("seq214-addcancel-col", addUid),
        calContentType(),
        addBody,
      );
      assertEquals(
        addResp.status >= 400,
        true,
        `METHOD:ADD with SEQUENCE:0 must be rejected (must be > 0); got ${addResp.status}`,
      );
      assertEquals(addResp.status < 500, true, "rejection must be 4xx not 5xx");

      // METHOD:CANCEL with SEQUENCE not incremented violates §2.1.4
      // Original SEQUENCE was 0; CANCEL must use SEQUENCE >= 1
      const cancelUid = "seq214-cancel-001";
      const cancelBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${cancelUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "STATUS:CANCELLED\r\n" +
        "SEQUENCE:0\r\n" + // not incremented — violates §2.1.4
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const cancelResp = await s.do(
        "PUT",
        objectPath("seq214-addcancel-col", cancelUid),
        calContentType(),
        cancelBody,
      );
      assertEquals(
        cancelResp.status >= 400,
        true,
        `METHOD:CANCEL with non-incremented SEQUENCE must be rejected; got ${cancelResp.status}`,
      );
      assertEquals(cancelResp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §2.1.5 PUT with lower SEQUENCE MUST NOT overwrite ───────────────────────

Deno.test(
  "RFC 5546 §2.1.5 PUT with lower SEQUENCE than stored object MUST NOT overwrite (VEVENT and VTODO)",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("seq215-col");

      // VEVENT: store at SEQUENCE:5, then PUT SEQUENCE:3 — stored value must stay 5
      const eventUid = "seq215-event";
      const eventBodyHigh =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${eventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:High Sequence Event\r\n" +
        "SEQUENCE:5\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putHighResp = await s.do(
        "PUT",
        objectPath("seq215-col", eventUid),
        calContentType(),
        eventBodyHigh,
      );
      assertEquals(putHighResp.status, 201, "initial PUT VEVENT SEQUENCE:5 must succeed");

      const eventBodyLow =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${eventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Lower Sequence Event\r\n" +
        "SEQUENCE:3\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      // PUT with lower SEQUENCE — server must not overwrite
      await s.do("PUT", objectPath("seq215-col", eventUid), calContentType(), eventBodyLow);
      const getEventResp = await s.do("GET", objectPath("seq215-col", eventUid));
      assertEquals(getEventResp.status, 200);
      assertStringIncludes(
        getEventResp.body,
        "SEQUENCE:5",
        "stored VEVENT must still have SEQUENCE:5 after stale PUT with SEQUENCE:3",
      );

      // VTODO: same check
      const todoUid = "seq215-todo";
      const todoBodyHigh =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${todoUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "SUMMARY:High Sequence Todo\r\n" +
        "SEQUENCE:5\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const putTodoHighResp = await s.do(
        "PUT",
        objectPath("seq215-col", todoUid),
        calContentType(),
        todoBodyHigh,
      );
      assertEquals(putTodoHighResp.status, 201, "initial PUT VTODO SEQUENCE:5 must succeed");

      const todoBodyLow =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${todoUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "SUMMARY:Lower Sequence Todo\r\n" +
        "SEQUENCE:2\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      await s.do("PUT", objectPath("seq215-col", todoUid), calContentType(), todoBodyLow);
      const getTodoResp = await s.do("GET", objectPath("seq215-col", todoUid));
      assertEquals(getTodoResp.status, 200);
      assertStringIncludes(
        getTodoResp.body,
        "SEQUENCE:5",
        "stored VTODO must still have SEQUENCE:5 after stale PUT with SEQUENCE:2",
      );
    });
  },
);

// ─── §3.1.1 VERSION MUST be 2.0 ──────────────────────────────────────────────

Deno.test(
  "RFC 5546 §3.1.1 VCALENDAR with VERSION != 2.0 must be rejected",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("ver311-col");
      const uid = "ver311-event";
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:1.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Old version event\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("ver311-col", uid), calContentType(), body);
      assertEquals(
        resp.status >= 400,
        true,
        `VCALENDAR with VERSION:1.0 must be rejected; got ${resp.status}`,
      );
      assertEquals(resp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.1.2 VTIMEZONE MUST be present when TZID is used ─────────────────────

Deno.test(
  "RFC 5546 §3.1.2 VTIMEZONE MUST be present when TZID is used on a date-time property",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("tz312-col");
      const uid = "tz312-event";
      // DTSTART uses TZID but no VTIMEZONE component is present
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "DTSTART;TZID=America/New_York:20260115T100000\r\n" +
        "DTEND;TZID=America/New_York:20260115T110000\r\n" +
        "SUMMARY:Event with TZID but no VTIMEZONE\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("tz312-col", uid), calContentType(), body);
      assertEquals(
        resp.status >= 400,
        true,
        `VCALENDAR with TZID but no VTIMEZONE must be rejected; got ${resp.status}`,
      );
      assertEquals(resp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.1 VEVENT PUBLISH: ORGANIZER required, ATTENDEE prohibited ──────────

Deno.test(
  "RFC 5546 §3.2.1 VEVENT PUBLISH MUST have ORGANIZER and MUST NOT have ATTENDEE",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("pub321-col");

      // PUBLISH without ORGANIZER must be rejected
      const uid1 = "pub321-no-org";
      const bodyNoOrg =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Publish without Organizer\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do("PUT", objectPath("pub321-col", uid1), calContentType(), bodyNoOrg);
      assertEquals(
        resp1.status >= 400,
        true,
        `VEVENT PUBLISH without ORGANIZER must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // PUBLISH with ATTENDEE must be rejected (Presence=0)
      const uid2 = "pub321-with-att";
      const bodyWithAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Publish with Attendee\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" + // MUST NOT be present
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do("PUT", objectPath("pub321-col", uid2), calContentType(), bodyWithAtt);
      assertEquals(
        resp2.status >= 400,
        true,
        `VEVENT PUBLISH with ATTENDEE must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.2 VEVENT REQUEST: ATTENDEE required; multi-UID sets prohibited ─────

Deno.test(
  "RFC 5546 §3.2.2 VEVENT REQUEST requires ATTENDEE and prohibits multi-UID VEVENT sets",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("req322-col");

      // REQUEST without ATTENDEE must be rejected (Presence=1+)
      const uid1 = "req322-no-att";
      const bodyNoAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Request without Attendee\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do("PUT", objectPath("req322-col", uid1), calContentType(), bodyNoAtt);
      assertEquals(
        resp1.status >= 400,
        true,
        `VEVENT REQUEST without ATTENDEE must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // Two VEVENTs with different UIDs in one iCalendar REQUEST must be rejected
      const uid2 = "req322-multi-uid";
      const bodyMultiUid =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}-a\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:First event\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}-b\r\n` + // different UID — violates §3.2.2
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Second event different UID\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("req322-col", uid2),
        calContentType(),
        bodyMultiUid,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VEVENT REQUEST with multiple different UIDs must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.2 VEVENT REQUEST MUST NOT include REQUEST-STATUS ───────────────────

Deno.test(
  "RFC 5546 §3.2.2 VEVENT REQUEST MUST NOT include REQUEST-STATUS",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("reqstat322-col");
      const uid = "reqstat322-event";
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Request with REQUEST-STATUS\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "REQUEST-STATUS:2.0;Success\r\n" + // MUST NOT be present in REQUEST
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("reqstat322-col", uid), calContentType(), body);
      assertEquals(
        resp.status >= 400,
        true,
        `VEVENT REQUEST with REQUEST-STATUS must be rejected; got ${resp.status}`,
      );
      assertEquals(resp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.3 VEVENT REPLY MUST have exactly one ATTENDEE ──────────────────────

Deno.test(
  "RFC 5546 §3.2.3 VEVENT REPLY MUST have exactly one ATTENDEE and MUST NOT alter original optional properties",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("reply323-col");

      // REPLY with zero ATTENDEEs must be rejected
      const uid1 = "reply323-no-att";
      const bodyNoAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REPLY\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "SUMMARY:Reply with no attendee\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("reply323-col", uid1),
        calContentType(),
        bodyNoAtt,
      );
      assertEquals(
        resp1.status >= 400,
        true,
        `VEVENT REPLY with no ATTENDEE must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // REPLY with two ATTENDEEs must be rejected (exactly one MUST be present)
      const uid2 = "reply323-two-att";
      const bodyTwoAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REPLY\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att1@example.com\r\n" +
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:att2@example.com\r\n" + // second — violation
        "SUMMARY:Reply with two attendees\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("reply323-col", uid2),
        calContentType(),
        bodyTwoAtt,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VEVENT REPLY with two ATTENDEEs must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.5 VEVENT CANCEL STATUS constraints ─────────────────────────────────

Deno.test(
  "RFC 5546 §3.2.5 VEVENT CANCEL STATUS:CANCELLED required for full cancel; MUST NOT be present for attendee removal",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("cancel325-col");

      // Full cancel with STATUS:CANCELLED and SEQUENCE:1 — RFC-correct; MUST be accepted
      const uid1 = "cancel325-full";
      const bodyFullCancel =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        "STATUS:CANCELLED\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("cancel325-col", uid1),
        calContentType(),
        bodyFullCancel,
      );
      // RFC §3.2.5 requires this to be accepted; will be red if server rejects METHOD
      assertEquals(
        resp1.status >= 200 && resp1.status < 300,
        true,
        `VEVENT CANCEL with STATUS:CANCELLED must be accepted; got ${resp1.status}`,
      );

      // Attendee-removal cancel WITH STATUS property — STATUS MUST NOT be present
      const uid2 = "cancel325-uninvite";
      const bodyUninviteWithStatus =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:removed@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        "STATUS:CONFIRMED\r\n" + // MUST NOT be present when uninviting specific Attendees
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("cancel325-col", uid2),
        calContentType(),
        bodyUninviteWithStatus,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VEVENT CANCEL for attendee removal with STATUS must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.2.6 VEVENT REFRESH MUST NOT include SEQUENCE ─────────────────────────

Deno.test(
  "RFC 5546 §3.2.6 VEVENT REFRESH MUST NOT include SEQUENCE or most optional properties",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("refresh326-col");
      const uid = "refresh326-event";
      // REFRESH with SEQUENCE present violates §3.2.6 (Presence=0)
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REFRESH\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" + // MUST NOT be present in REFRESH
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("refresh326-col", uid), calContentType(), body);
      assertEquals(
        resp.status >= 400,
        true,
        `VEVENT REFRESH with SEQUENCE must be rejected; got ${resp.status}`,
      );
      assertEquals(resp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.4.1 VTODO PUBLISH: ORGANIZER and PRIORITY required; ATTENDEE prohibited ──

Deno.test(
  "RFC 5546 §3.4.1 VTODO PUBLISH MUST have ORGANIZER and PRIORITY; MUST NOT have ATTENDEE",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("todopub341-col");

      // VTODO PUBLISH without ORGANIZER must be rejected
      const uid1 = "todopub341-no-org";
      const bodyNoOrg =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Todo publish no organizer\r\n" +
        "PRIORITY:1\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("todopub341-col", uid1),
        calContentType(),
        bodyNoOrg,
      );
      assertEquals(
        resp1.status >= 400,
        true,
        `VTODO PUBLISH without ORGANIZER must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO PUBLISH without PRIORITY must be rejected (Presence=1)
      const uid2 = "todopub341-no-pri";
      const bodyNoPri =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Todo publish no priority\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("todopub341-col", uid2),
        calContentType(),
        bodyNoPri,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VTODO PUBLISH without PRIORITY must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO PUBLISH with ATTENDEE must be rejected (Presence=0)
      const uid3 = "todopub341-with-att";
      const bodyWithAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid3}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Todo publish with attendee\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "PRIORITY:1\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" + // MUST NOT be present
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp3 = await s.do(
        "PUT",
        objectPath("todopub341-col", uid3),
        calContentType(),
        bodyWithAtt,
      );
      assertEquals(
        resp3.status >= 400,
        true,
        `VTODO PUBLISH with ATTENDEE must be rejected; got ${resp3.status}`,
      );
      assertEquals(resp3.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.4.2 VTODO REQUEST: ATTENDEE and PRIORITY required; REQUEST-STATUS prohibited ──

Deno.test(
  "RFC 5546 §3.4.2 VTODO REQUEST requires ATTENDEE and PRIORITY; MUST NOT include REQUEST-STATUS",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("todoreq342-col");

      // VTODO REQUEST without ATTENDEE must be rejected
      const uid1 = "todoreq342-no-att";
      const bodyNoAtt =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Request todo no attendee\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "PRIORITY:1\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("todoreq342-col", uid1),
        calContentType(),
        bodyNoAtt,
      );
      assertEquals(
        resp1.status >= 400,
        true,
        `VTODO REQUEST without ATTENDEE must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO REQUEST without PRIORITY must be rejected (Presence=1)
      const uid2 = "todoreq342-no-pri";
      const bodyNoPri =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Request todo no priority\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("todoreq342-col", uid2),
        calContentType(),
        bodyNoPri,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VTODO REQUEST without PRIORITY must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO REQUEST with REQUEST-STATUS must be rejected (Presence=0)
      const uid3 = "todoreq342-with-rs";
      const bodyWithRS =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid3}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        "SUMMARY:Request todo with request-status\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "PRIORITY:1\r\n" +
        "REQUEST-STATUS:2.0;Success\r\n" + // MUST NOT be present
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp3 = await s.do(
        "PUT",
        objectPath("todoreq342-col", uid3),
        calContentType(),
        bodyWithRS,
      );
      assertEquals(
        resp3.status >= 400,
        true,
        `VTODO REQUEST with REQUEST-STATUS must be rejected; got ${resp3.status}`,
      );
      assertEquals(resp3.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.4.3 VTODO REPLY PARTSTAT PARTIAL and COMPLETED roundtrip ─────────────

Deno.test(
  "RFC 5546 §3.4.3 VTODO REPLY PARTSTAT values PARTIAL and COMPLETED must roundtrip",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("todopartstat343-col");

      // PARTSTAT=PARTIAL is valid only for VTODO (not VEVENT)
      const partStats = ["PARTIAL", "COMPLETED"];
      for (const ps of partStats) {
        const uid = `todopartstat343-${ps.toLowerCase()}`;
        const body =
          "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
          "BEGIN:VTODO\r\n" +
          `UID:${uid}\r\n` +
          `DTSTAMP:${testDTSTAMP}\r\n` +
          "SUMMARY:VTODO PARTSTAT test\r\n" +
          "ORGANIZER:mailto:org@example.com\r\n" +
          `ATTENDEE;PARTSTAT=${ps}:mailto:att@example.com\r\n` +
          "END:VTODO\r\nEND:VCALENDAR\r\n";
        const putResp = await s.do(
          "PUT",
          objectPath("todopartstat343-col", uid),
          calContentType(),
          body,
        );
        assertEquals(
          putResp.status,
          201,
          `PUT VTODO with PARTSTAT:${ps} must succeed with 201`,
        );
        const getResp = await s.do("GET", objectPath("todopartstat343-col", uid));
        assertEquals(getResp.status, 200);
        assertStringIncludes(
          getResp.body,
          `PARTSTAT=${ps}`,
          `VTODO PARTSTAT:${ps} must roundtrip`,
        );
      }

      // PARTSTAT=PARTIAL MUST NOT be accepted on a VEVENT (VTODO-only value)
      const veventUid = "todopartstat343-vevent-partial";
      const veventBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${veventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:VEVENT with VTODO-only PARTSTAT\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE;PARTSTAT=PARTIAL:mailto:att@example.com\r\n" + // not valid for VEVENT
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const veventResp = await s.do(
        "PUT",
        objectPath("todopartstat343-col", veventUid),
        calContentType(),
        veventBody,
      );
      assertEquals(
        veventResp.status >= 400,
        true,
        `VEVENT with PARTSTAT=PARTIAL (VTODO-only) must be rejected; got ${veventResp.status}`,
      );
      assertEquals(veventResp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.4.5 VTODO CANCEL STATUS and SEQUENCE constraints ─────────────────────

Deno.test(
  "RFC 5546 §3.4.5 VTODO CANCEL STATUS and SEQUENCE constraints",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("todocancel345-col");

      // Full VTODO cancel: STATUS:CANCELLED and SEQUENCE:1 must be accepted
      const uid1 = "todocancel345-full";
      const bodyFull =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        "STATUS:CANCELLED\r\n" +
        "SUMMARY:Cancelled todo\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("todocancel345-col", uid1),
        calContentType(),
        bodyFull,
      );
      // RFC requires acceptance; will be red if server rejects METHOD
      assertEquals(
        resp1.status >= 200 && resp1.status < 300,
        true,
        `VTODO CANCEL with STATUS:CANCELLED must be accepted; got ${resp1.status}`,
      );

      // Attendee-removal VTODO cancel: STATUS MUST NOT be present
      const uid2 = "todocancel345-uninvite";
      const bodyUninviteWithStatus =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:removed@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        "STATUS:NEEDS-ACTION\r\n" + // MUST NOT be present when removing specific Attendees
        "SUMMARY:Uninvite with STATUS present\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("todocancel345-col", uid2),
        calContentType(),
        bodyUninviteWithStatus,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VTODO CANCEL for attendee removal with STATUS present must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO CANCEL with SEQUENCE:0 must be rejected (MUST be present and incremented)
      const uid3 = "todocancel345-seq0";
      const bodySeq0 =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid3}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:0\r\n" + // not incremented — violates §2.1.4 and §3.4.5
        "STATUS:CANCELLED\r\n" +
        "SUMMARY:Cancel with seq 0\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp3 = await s.do(
        "PUT",
        objectPath("todocancel345-col", uid3),
        calContentType(),
        bodySeq0,
      );
      assertEquals(
        resp3.status >= 400,
        true,
        `VTODO CANCEL with SEQUENCE:0 must be rejected; got ${resp3.status}`,
      );
      assertEquals(resp3.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.4.6 VTODO REFRESH MUST NOT include ORGANIZER or SEQUENCE ─────────────

Deno.test(
  "RFC 5546 §3.4.6 VTODO REFRESH MUST NOT include ORGANIZER, SEQUENCE, or most optional properties",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("todorefresh346-col");

      // VTODO REFRESH with ORGANIZER must be rejected (Presence=0)
      const uid1 = "todorefresh346-org";
      const bodyWithOrg =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REFRESH\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid1}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "ORGANIZER:mailto:org@example.com\r\n" + // MUST NOT be present in VTODO REFRESH
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp1 = await s.do(
        "PUT",
        objectPath("todorefresh346-col", uid1),
        calContentType(),
        bodyWithOrg,
      );
      assertEquals(
        resp1.status >= 400,
        true,
        `VTODO REFRESH with ORGANIZER must be rejected; got ${resp1.status}`,
      );
      assertEquals(resp1.status < 500, true, "rejection must be 4xx not 5xx");

      // VTODO REFRESH with SEQUENCE must be rejected (Presence=0)
      const uid2 = "todorefresh346-seq";
      const bodyWithSeq =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:REFRESH\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid2}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" + // MUST NOT be present in VTODO REFRESH
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp2 = await s.do(
        "PUT",
        objectPath("todorefresh346-col", uid2),
        calContentType(),
        bodyWithSeq,
      );
      assertEquals(
        resp2.status >= 400,
        true,
        `VTODO REFRESH with SEQUENCE must be rejected; got ${resp2.status}`,
      );
      assertEquals(resp2.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.6 REQUEST-STATUS roundtrip for VTODO; error codes ────────────────────

Deno.test(
  "RFC 5546 §3.6 REQUEST-STATUS roundtrip for VTODO and for error codes (3.x/4.x/5.x)",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("rs36-col");

      const cases: Array<[string, string]> = [
        ["3.0;Unknown error", "REQUEST-STATUS:3.0;Unknown error"],
        ["4.0;No authority", "REQUEST-STATUS:4.0;No authority"],
        ["5.0;Request not supported", "REQUEST-STATUS:5.0;Request not supported"],
      ];

      for (const [code, expected] of cases) {
        const uid = `rs36-todo-${code.charAt(0)}`;
        const body =
          "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
          "BEGIN:VTODO\r\n" +
          `UID:${uid}\r\n` +
          `DTSTAMP:${testDTSTAMP}\r\n` +
          "SUMMARY:REQUEST-STATUS test\r\n" +
          `REQUEST-STATUS:${code}\r\n` +
          "END:VTODO\r\nEND:VCALENDAR\r\n";
        const putResp = await s.do("PUT", objectPath("rs36-col", uid), calContentType(), body);
        assertEquals(putResp.status, 201, `PUT VTODO with REQUEST-STATUS:${code} must succeed`);

        const getResp = await s.do("GET", objectPath("rs36-col", uid));
        assertEquals(getResp.status, 200);
        assertStringIncludes(
          getResp.body,
          expected,
          `REQUEST-STATUS:${code} must roundtrip in VTODO`,
        );
      }
    });
  },
);

// ─── §3.6 Multiple REQUEST-STATUS MUST share same top-level numeric class ─────

Deno.test(
  "RFC 5546 §3.6 Multiple REQUEST-STATUS properties in one component MUST share the same top-level numeric class",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("rs36multi-col");

      // Mixing 2.xx and 5.xx in the same component is prohibited
      const uid = "rs36multi-mixed";
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Mixed status classes\r\n" +
        "REQUEST-STATUS:2.0;Success\r\n" + // 2.xx class
        "REQUEST-STATUS:5.0;Request not supported\r\n" + // 5.xx class — violates §3.6
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("rs36multi-col", uid), calContentType(), body);
      assertEquals(
        resp.status >= 400,
        true,
        `VEVENT with mixed REQUEST-STATUS top-level classes (2.xx and 5.xx) must be rejected; got ${resp.status}`,
      );
      assertEquals(resp.status < 500, true, "rejection must be 4xx not 5xx");
    });
  },
);

// ─── §3.7.1 RECURRENCE-ID roundtrip and CANCEL with RANGE=THISANDFUTURE ──────

Deno.test(
  "RFC 5546 §3.7.1 RECURRENCE-ID roundtrip and CANCEL with RANGE=THISANDFUTURE for VEVENT and VTODO",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("recid371-col");

      // VEVENT override with RECURRENCE-ID must roundtrip
      const eventUid = "recid371-event";
      const eventBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${eventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        `RECURRENCE-ID:${testDTSTART}\r\n` +
        "SUMMARY:VEVENT override with RECURRENCE-ID\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putEventResp = await s.do(
        "PUT",
        objectPath("recid371-col", eventUid),
        calContentType(),
        eventBody,
      );
      assertEquals(putEventResp.status, 201, "PUT VEVENT with RECURRENCE-ID must succeed");
      const getEventResp = await s.do("GET", objectPath("recid371-col", eventUid));
      assertEquals(getEventResp.status, 200);
      assertStringIncludes(
        getEventResp.body,
        `RECURRENCE-ID:${testDTSTART}`,
        "RECURRENCE-ID must roundtrip in VEVENT",
      );

      // VTODO override with RECURRENCE-ID must roundtrip
      const todoUid = "recid371-todo";
      const todoBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${todoUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `RECURRENCE-ID:${testDTSTART}\r\n` +
        "SUMMARY:VTODO override with RECURRENCE-ID\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const putTodoResp = await s.do(
        "PUT",
        objectPath("recid371-col", todoUid),
        calContentType(),
        todoBody,
      );
      assertEquals(putTodoResp.status, 201, "PUT VTODO with RECURRENCE-ID must succeed");
      const getTodoResp = await s.do("GET", objectPath("recid371-col", todoUid));
      assertEquals(getTodoResp.status, 200);
      assertStringIncludes(
        getTodoResp.body,
        `RECURRENCE-ID:${testDTSTART}`,
        "RECURRENCE-ID must roundtrip in VTODO",
      );

      // CANCEL with RECURRENCE-ID;RANGE=THISANDFUTURE must be accepted (RFC §3.2.5 option a)
      const cancelUid = "recid371-cancel-taf";
      const cancelBody =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "METHOD:CANCEL\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${cancelUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "ORGANIZER:mailto:org@example.com\r\n" +
        "ATTENDEE:mailto:att@example.com\r\n" +
        "SEQUENCE:1\r\n" +
        `RECURRENCE-ID;RANGE=THISANDFUTURE:${testDTSTART}\r\n` +
        "STATUS:CANCELLED\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const cancelResp = await s.do(
        "PUT",
        objectPath("recid371-col", cancelUid),
        calContentType(),
        cancelBody,
      );
      // RFC §3.2.5 requires CANCEL with RANGE=THISANDFUTURE to be accepted;
      // will be red if server unconditionally rejects METHOD
      assertEquals(
        cancelResp.status >= 200 && cancelResp.status < 300,
        true,
        `CANCEL with RECURRENCE-ID;RANGE=THISANDFUTURE must be accepted; got ${cancelResp.status}`,
      );
    });
  },
);

// ─── §4.2.9 Stale pre-cancel update MUST be ignored ──────────────────────────

Deno.test(
  "RFC 5546 §4.2.9 Stale pre-cancel update (lower SEQUENCE than stored CANCEL) MUST be ignored for VEVENT and VTODO",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("stalecancal429-col");

      // VEVENT: store a cancellation at SEQUENCE:3, then attempt stale update at SEQUENCE:1
      const eventUid = "stalecancal429-event";
      const eventBodyCancel =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${eventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Cancelled event\r\n" +
        "STATUS:CANCELLED\r\n" +
        "SEQUENCE:3\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const putCancelResp = await s.do(
        "PUT",
        objectPath("stalecancal429-col", eventUid),
        calContentType(),
        eventBodyCancel,
      );
      assertEquals(putCancelResp.status, 201, "PUT cancelled VEVENT (SEQUENCE:3) must succeed");

      // Stale update at SEQUENCE:1 — lower than the cancel; MUST be ignored
      const eventBodyStale =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${eventUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        `DTSTART:${testDTSTART}\r\n` +
        `DTEND:${testDTEND}\r\n` +
        "SUMMARY:Stale pre-cancel update\r\n" +
        "SEQUENCE:1\r\n" + // lower than the CANCEL at SEQUENCE:3 — must be ignored
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      await s.do(
        "PUT",
        objectPath("stalecancal429-col", eventUid),
        calContentType(),
        eventBodyStale,
      );
      // The server must not have overwritten the cancelled version
      const getEventResp = await s.do("GET", objectPath("stalecancal429-col", eventUid));
      assertEquals(getEventResp.status, 200);
      assertStringIncludes(
        getEventResp.body,
        "SEQUENCE:3",
        "VEVENT must still have SEQUENCE:3 after stale pre-cancel update at SEQUENCE:1",
      );
      assertStringIncludes(
        getEventResp.body,
        "STATUS:CANCELLED",
        "VEVENT must still be CANCELLED after stale pre-cancel update",
      );

      // VTODO: same check
      const todoUid = "stalecancal429-todo";
      const todoBodyCancel =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${todoUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "SUMMARY:Cancelled todo\r\n" +
        "STATUS:CANCELLED\r\n" +
        "SEQUENCE:3\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const putTodoCancelResp = await s.do(
        "PUT",
        objectPath("stalecancal429-col", todoUid),
        calContentType(),
        todoBodyCancel,
      );
      assertEquals(putTodoCancelResp.status, 201, "PUT cancelled VTODO (SEQUENCE:3) must succeed");

      const todoBodyStale =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${todoUid}\r\n` +
        `DTSTAMP:${testDTSTAMP}\r\n` +
        "SUMMARY:Stale pre-cancel todo update\r\n" +
        "SEQUENCE:1\r\n" + // lower than the CANCEL at SEQUENCE:3 — must be ignored
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      await s.do(
        "PUT",
        objectPath("stalecancal429-col", todoUid),
        calContentType(),
        todoBodyStale,
      );
      const getTodoResp = await s.do("GET", objectPath("stalecancal429-col", todoUid));
      assertEquals(getTodoResp.status, 200);
      assertStringIncludes(
        getTodoResp.body,
        "SEQUENCE:3",
        "VTODO must still have SEQUENCE:3 after stale pre-cancel update at SEQUENCE:1",
      );
      assertStringIncludes(
        getTodoResp.body,
        "STATUS:CANCELLED",
        "VTODO must still be CANCELLED after stale pre-cancel update",
      );
    });
  },
);
