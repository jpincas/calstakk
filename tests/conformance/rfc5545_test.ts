// RFC 5545 — Internet Calendaring and Scheduling Core Object Specification
// Spec: specs/rfc5545.txt
//
// Coverage (iCalendar data validation via PUT→GET roundtrips):
//   §3.6    VCALENDAR structure (VERSION, PRODID, required components)
//   §3.6.1  VEVENT component
//   §3.6.2  VTODO component
//   §3.6.6  VALARM sub-component
//   §3.8.x  Descriptive, date/time, relationship, recurrence, change-mgmt properties

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  calContentType,
  objectPath,
  testDTEND,
  testDTSTAMP,
  testDTSTART,
  withServer,
} from "./harness.ts";

// ─── §3.6 VCALENDAR structure ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.6 VCALENDAR without VERSION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("ver-test");
    const body =
      "BEGIN:VCALENDAR\r\nPRODID:-//Test//Test//EN\r\n" +
      "BEGIN:VTODO\r\nUID:ver-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("ver-test", "ver-todo"), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR without VERSION must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6 VCALENDAR without PRODID rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("prodid-test");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
      "BEGIN:VTODO\r\nUID:prodid-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("prodid-test", "prodid-todo"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR without PRODID must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6 empty VCALENDAR (no components) rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("empty-test");
    const body = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("empty-test", "empty"), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR without any component must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.6.2 VTODO ────────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.6.2 VTODO without UID rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("uid-req");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:No UID\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("uid-req", "no-uid"), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO without UID must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.2 VTODO without DTSTAMP rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("dtstamp-req");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\nUID:dtstamp-todo\r\nSUMMARY:No DTSTAMP\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("dtstamp-req", "dtstamp-todo"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO without DTSTAMP must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.2 VTODO roundtrip preserves UID and SUMMARY", async () => {
  await withServer(async (s) => {
    await s.mkcol("rt-col");
    const uid = "roundtrip-todo-001";
    await s.putTodo("rt-col", uid);

    const resp = await s.do("GET", objectPath("rt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "BEGIN:VTODO");
    assertStringIncludes(resp.body, `UID:${uid}`);
    assertStringIncludes(resp.body, "SUMMARY:Test Todo");
  });
});

Deno.test("RFC 5545 §3.8.2.3 DUE property roundtrips correctly", async () => {
  await withServer(async (s) => {
    await s.mkcol("due-col");
    const uid = "due-todo-001";
    await s.putTodo("due-col", uid, "DUE:20260120T120000Z");

    const resp = await s.do("GET", objectPath("due-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "DUE:20260120T120000Z");
  });
});

Deno.test("RFC 5545 §3.8.2 DTSTART roundtrips on VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("dtstart-col");
    const uid = "dtstart-todo-001";
    await s.putTodo("dtstart-col", uid, "DTSTART:20260110T090000Z");

    const resp = await s.do("GET", objectPath("dtstart-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "DTSTART:20260110T090000Z");
  });
});

Deno.test("RFC 5545 §3.6.2 VTODO STATUS values roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("status-col");
    const statuses = ["NEEDS-ACTION", "COMPLETED", "IN-PROCESS", "CANCELLED"];
    for (const status of statuses) {
      const uid = `status-todo-${status}`;
      await s.putTodo("status-col", uid, `STATUS:${status}`);
      const resp = await s.do("GET", objectPath("status-col", uid));
      assertEquals(resp.status, 200, `GET after PUT with STATUS:${status} failed`);
      assertStringIncludes(resp.body, `STATUS:${status}`, `STATUS:${status} must round-trip`);
    }
  });
});

Deno.test("RFC 5545 §3.6.2 COMPLETED property roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("completed-col");
    const uid = "completed-todo";
    await s.putTodo("completed-col", uid, "STATUS:COMPLETED", "COMPLETED:20260110T120000Z");

    const resp = await s.do("GET", objectPath("completed-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "COMPLETED:20260110T120000Z");
  });
});

Deno.test("RFC 5545 §3.8.1.8 PERCENT-COMPLETE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("pct-col");
    const uid = "pct-todo";
    await s.putTodo("pct-col", uid, "PERCENT-COMPLETE:50");

    const resp = await s.do("GET", objectPath("pct-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "PERCENT-COMPLETE:50");
  });
});

Deno.test("RFC 5545 §3.8.1 PRIORITY roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("prio-col");
    const uid = "prio-todo";
    await s.putTodo("prio-col", uid, "PRIORITY:1");

    const resp = await s.do("GET", objectPath("prio-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "PRIORITY:1");
  });
});

Deno.test("RFC 5545 §3.8.1 DESCRIPTION roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("desc-col");
    const uid = "desc-todo";
    await s.putTodo("desc-col", uid, "DESCRIPTION:Detailed description text here");

    const resp = await s.do("GET", objectPath("desc-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "DESCRIPTION:Detailed description text here");
  });
});

Deno.test("RFC 5545 §3.8.1 CATEGORIES roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("cat-col");
    const uid = "cat-todo";
    await s.putTodo("cat-col", uid, "CATEGORIES:WORK,URGENT");

    const resp = await s.do("GET", objectPath("cat-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CATEGORIES:");
  });
});

Deno.test("RFC 5545 §3.8.1 CLASS values roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("class-col");
    for (const cls of ["PUBLIC", "PRIVATE", "CONFIDENTIAL"]) {
      const uid = `class-todo-${cls}`;
      await s.putTodo("class-col", uid, `CLASS:${cls}`);
      const resp = await s.do("GET", objectPath("class-col", uid));
      assertEquals(resp.status, 200);
      assertStringIncludes(resp.body, `CLASS:${cls}`);
    }
  });
});

Deno.test("RFC 5545 §3.8.4.5 RELATED-TO roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("related-col");
    const parentUID = "parent-todo-001";
    const childUID = "child-todo-001";
    await s.putTodo("related-col", parentUID);
    await s.putTodo("related-col", childUID, `RELATED-TO:${parentUID}`);

    const resp = await s.do("GET", objectPath("related-col", childUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, `RELATED-TO:${parentUID}`);
  });
});

Deno.test("RFC 5545 §3.8.7.4 SEQUENCE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("seq-col");
    const uid = "seq-todo";
    await s.putTodo("seq-col", uid, "SEQUENCE:3");

    const resp = await s.do("GET", objectPath("seq-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "SEQUENCE:3");
  });
});

Deno.test("RFC 5545 §3.8.7 CREATED and LAST-MODIFIED roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("cm-col");
    const uid = "cm-todo";
    await s.putTodo("cm-col", uid, "CREATED:20260101T080000Z", "LAST-MODIFIED:20260101T090000Z");

    const resp = await s.do("GET", objectPath("cm-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CREATED:20260101T080000Z");
    assertStringIncludes(resp.body, "LAST-MODIFIED:20260101T090000Z");
  });
});

// ─── §3.6.1 VEVENT ───────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.6.1 VEVENT roundtrip preserves UID, DTSTART, DTEND", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-col");
    const uid = "vevent-rt-001";
    await s.putEvent("vevent-col", uid);

    const resp = await s.do("GET", objectPath("vevent-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "BEGIN:VEVENT");
    assertStringIncludes(resp.body, `UID:${uid}`);
    assertStringIncludes(resp.body, `DTSTART:${testDTSTART}`);
    assertStringIncludes(resp.body, `DTEND:${testDTEND}`);
  });
});

Deno.test("RFC 5545 §3.6.1 VEVENT with DURATION (no DTEND) accepted", async () => {
  await withServer(async (s) => {
    await s.mkcol("dur-col");
    const uid = "dur-event";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260115T100000Z\r\n" +
      "DURATION:PT1H\r\n" +
      "SUMMARY:Duration Event\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("dur-col", uid), calContentType(), body);
    assertEquals(resp.status, 201);

    const getResp = await s.do("GET", objectPath("dur-col", uid));
    assertStringIncludes(getResp.body, "DURATION:PT1H");
  });
});

Deno.test("RFC 5545 §3.6.1 VEVENT STATUS values roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("evt-status-col");
    for (const status of ["TENTATIVE", "CONFIRMED", "CANCELLED"]) {
      const uid = `evt-status-${status}`;
      await s.putEvent("evt-status-col", uid, `STATUS:${status}`);
      const resp = await s.do("GET", objectPath("evt-status-col", uid));
      assertEquals(resp.status, 200);
      assertStringIncludes(resp.body, `STATUS:${status}`);
    }
  });
});

// ─── §3.8.5 Recurrence (RRULE / RDATE / EXDATE) ─────────────────────────────

Deno.test("RFC 5545 §3.8.5.3 RRULE on VTODO roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("rrule-col");
    const uid = "rrule-todo";
    await s.putTodo("rrule-col", uid, "DTSTART:20260101T090000Z", "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO");

    const resp = await s.do("GET", objectPath("rrule-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO");
  });
});

Deno.test("RFC 5545 §3.8.5.3 RRULE on VEVENT roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("evt-rrule-col");
    const uid = "rrule-event";
    await s.putEvent("evt-rrule-col", uid, "RRULE:FREQ=DAILY;COUNT=3");

    const resp = await s.do("GET", objectPath("evt-rrule-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RRULE:FREQ=DAILY;COUNT=3");
  });
});

Deno.test("RFC 5545 §3.8.5.1 EXDATE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("exdate-col");
    const uid = "exdate-event";
    await s.putEvent("exdate-col", uid, "RRULE:FREQ=DAILY;COUNT=5", "EXDATE:20260116T100000Z");

    const resp = await s.do("GET", objectPath("exdate-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "EXDATE:20260116T100000Z");
  });
});

Deno.test("RFC 5545 §3.8.5.2 RDATE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("rdate-col");
    const uid = "rdate-event";
    await s.putEvent("rdate-col", uid, "RDATE:20260220T100000Z");

    const resp = await s.do("GET", objectPath("rdate-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RDATE:20260220T100000Z");
  });
});

// ─── §3.6.6 VALARM ───────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.6.6 VALARM inside VTODO roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-col");
    const uid = "alarm-todo";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "SUMMARY:Alarm Todo\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "TRIGGER:-PT15M\r\n" +
      "END:VALARM\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("alarm-col", uid), calContentType(), body);
    assertEquals(resp.status, 201);

    const getResp = await s.do("GET", objectPath("alarm-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "BEGIN:VALARM");
    assertStringIncludes(getResp.body, "ACTION:DISPLAY");
    assertStringIncludes(getResp.body, "TRIGGER:-PT15M");
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM inside VEVENT roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("evt-alarm-col");
    const uid = "alarm-event";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      `DTSTART:${testDTSTART}\r\n` +
      `DTEND:${testDTEND}\r\n` +
      "SUMMARY:Alarm Event\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:EMAIL\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "SUMMARY:Meeting Reminder\r\n" +
      "TRIGGER:-PT30M\r\n" +
      "ATTENDEE:mailto:user@example.com\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("evt-alarm-col", uid), calContentType(), body);
    assertEquals(resp.status, 201);

    const getResp = await s.do("GET", objectPath("evt-alarm-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "BEGIN:VALARM");
    assertStringIncludes(getResp.body, "ACTION:EMAIL");
  });
});

// ─── §3.8.4.4 RECURRENCE-ID ──────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.4 RECURRENCE-ID override must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("recid-col");
    const masterUID = "master-recurring-001";
    await s.putEvent("recid-col", masterUID, "RRULE:FREQ=DAILY;COUNT=5");

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${masterUID}\r\n` +
      `DTSTAMP:${testDTSTAMP}\r\n` +
      "DTSTART:20260116T100000Z\r\n" +
      "DTEND:20260116T110000Z\r\n" +
      "RECURRENCE-ID:20260116T100000Z\r\n" +
      "SUMMARY:Override\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "PUT",
      objectPath("recid-col", `${masterUID}-override`),
      calContentType(),
      body,
    );
    assertEquals(resp.status < 500, true, "RECURRENCE-ID override must not cause 5xx");
  });
});
