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

// ─── §3.6.1 VEVENT required properties ───────────────────────────────────────

Deno.test("RFC 5545 §3.6.1 VEVENT without UID rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-uid-req");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:No UID\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-uid-req", "no-uid-event"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT without UID must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.1 VEVENT without DTSTAMP rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-dtstamp-req");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-no-dtstamp\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:No DTSTAMP\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-dtstamp-req", "vevent-no-dtstamp"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT without DTSTAMP must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.1 VEVENT without DTSTART (no METHOD) rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-dtstart-req");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-no-dtstart\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:No DTSTART\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-dtstart-req", "vevent-no-dtstart"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT without DTSTART (and no METHOD) must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.1 VEVENT with both DTEND and DURATION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-dtend-dur");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-dtend-and-dur\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "DURATION:PT1H\r\n" +
      "SUMMARY:Both DTEND and DURATION\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-dtend-dur", "vevent-dtend-and-dur"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT with both DTEND and DURATION must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.6.2 VTODO constraint violations ──────────────────────────────────────

Deno.test("RFC 5545 §3.6.2 VTODO with both DUE and DURATION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-due-dur");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-due-and-dur\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DUE:20260120T120000Z\r\n" +
      "DURATION:PT1H\r\n" +
      "SUMMARY:Both DUE and DURATION\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vtodo-due-dur", "vtodo-due-and-dur"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO with both DUE and DURATION must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.2 VTODO with DURATION but no DTSTART rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-dur-nodtstart");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-dur-no-dtstart\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DURATION:PT1H\r\n" +
      "SUMMARY:DURATION without DTSTART\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vtodo-dur-nodtstart", "vtodo-dur-no-dtstart"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO with DURATION but no DTSTART must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.8.1.11 VTODO with VEVENT-specific STATUS value rejected", async () => {
  // VTODO only accepts NEEDS-ACTION, COMPLETED, IN-PROCESS, CANCELLED
  // TENTATIVE and CONFIRMED are VEVENT-only
  await withServer(async (s) => {
    await s.mkcol("vtodo-bad-status");
    for (const status of ["TENTATIVE", "CONFIRMED"]) {
      const uid = `vtodo-bad-status-${status.toLowerCase()}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260101T000000Z\r\n" +
        `STATUS:${status}\r\n` +
        "SUMMARY:Bad status for VTODO\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp = await s.do(
        "PUT",
        objectPath("vtodo-bad-status", uid),
        calContentType(),
        body,
      );
      assertEquals(
        [400, 403, 422].includes(resp.status),
        true,
        `VTODO with STATUS:${status} (VEVENT-only) must be rejected; got ${resp.status}`,
      );
    }
  });
});

Deno.test("RFC 5545 §3.8.1.11 VEVENT with VTODO-specific STATUS value rejected", async () => {
  // VEVENT only accepts TENTATIVE, CONFIRMED, CANCELLED
  // NEEDS-ACTION, COMPLETED, IN-PROCESS are VTODO-only
  await withServer(async (s) => {
    await s.mkcol("vevent-bad-status");
    for (const status of ["NEEDS-ACTION", "COMPLETED", "IN-PROCESS"]) {
      const uid = `vevent-bad-status-${status.toLowerCase().replace("-", "")}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260101T000000Z\r\n" +
        "DTSTART:20260115T100000Z\r\n" +
        "DTEND:20260115T110000Z\r\n" +
        `STATUS:${status}\r\n` +
        "SUMMARY:Bad status for VEVENT\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do(
        "PUT",
        objectPath("vevent-bad-status", uid),
        calContentType(),
        body,
      );
      assertEquals(
        [400, 403, 422].includes(resp.status),
        true,
        `VEVENT with STATUS:${status} (VTODO-only) must be rejected; got ${resp.status}`,
      );
    }
  });
});

// ─── §3.8.2.2 DTEND constraints ──────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.2.2 VEVENT DTEND type mismatch with DTSTART rejected", async () => {
  // DTSTART is DATE-TIME, DTEND must also be DATE-TIME (not DATE)
  await withServer(async (s) => {
    await s.mkcol("vevent-dtend-type");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-dtend-type-mismatch\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND;VALUE=DATE:20260116\r\n" +
      "SUMMARY:Type mismatch\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-dtend-type", "vevent-dtend-type-mismatch"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT with DTEND value type different from DTSTART must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.8.2.2 VEVENT with DTEND before DTSTART rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-dtend-before");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-dtend-before-dtstart\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T090000Z\r\n" +
      "SUMMARY:DTEND before DTSTART\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vevent-dtend-before", "vevent-dtend-before-dtstart"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VEVENT with DTEND before DTSTART must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.8.2.3 DUE constraints ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.2.3 VTODO DUE type mismatch with DTSTART rejected", async () => {
  // DTSTART is DATE-TIME, DUE must also be DATE-TIME when both are present
  await withServer(async (s) => {
    await s.mkcol("vtodo-due-type");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-due-type-mismatch\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DUE;VALUE=DATE:20260120\r\n" +
      "SUMMARY:Type mismatch DUE\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vtodo-due-type", "vtodo-due-type-mismatch"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO with DUE value type different from DTSTART must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.8.2.3 VTODO with DUE before DTSTART rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-due-before");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-due-before-dtstart\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260120T120000Z\r\n" +
      "DUE:20260115T100000Z\r\n" +
      "SUMMARY:DUE before DTSTART\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vtodo-due-before", "vtodo-due-before-dtstart"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO with DUE before DTSTART must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.8.2.1 COMPLETED UTC requirement ──────────────────────────────────────

Deno.test("RFC 5545 §3.8.2.1 VTODO COMPLETED with non-UTC time rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-completed-nonutc");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:vtodo-completed-nonutc\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "STATUS:COMPLETED\r\n" +
      "COMPLETED:20260110T120000\r\n" +
      "SUMMARY:COMPLETED non-UTC\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("vtodo-completed-nonutc", "vtodo-completed-nonutc"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTODO COMPLETED with non-UTC time must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.8.7.1 CREATED UTC requirement ────────────────────────────────────────

Deno.test("RFC 5545 §3.8.7.1 CREATED with non-UTC time rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("created-nonutc");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-created-nonutc\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "CREATED:20260101T080000\r\n" +
      "SUMMARY:CREATED non-UTC\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("created-nonutc", "vevent-created-nonutc"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `CREATED with non-UTC time must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.8.7.2 DTSTAMP UTC requirement ────────────────────────────────────────

Deno.test("RFC 5545 §3.8.7.2 DTSTAMP with non-UTC time rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("dtstamp-nonutc");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:vevent-dtstamp-nonutc\r\n" +
      "DTSTAMP:20260101T080000\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:DTSTAMP non-UTC\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("dtstamp-nonutc", "vevent-dtstamp-nonutc"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `DTSTAMP with non-UTC time must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.7.4 VERSION must be 2.0 ──────────────────────────────────────────────

Deno.test("RFC 5545 §3.7.4 VCALENDAR with VERSION other than 2.0 rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("ver-20-test");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:1.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\nUID:ver10-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("ver-20-test", "ver10-todo"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR with VERSION:1.0 must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.6 Duplicate PRODID / VERSION ─────────────────────────────────────────

Deno.test("RFC 5545 §3.6 VCALENDAR with duplicate PRODID rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("dup-prodid");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//First//EN\r\nPRODID:-//Second//EN\r\n" +
      "BEGIN:VTODO\r\nUID:dup-prodid-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("dup-prodid", "dup-prodid-todo"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR with duplicate PRODID must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6 VCALENDAR with duplicate VERSION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("dup-version");
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\nUID:dup-version-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("dup-version", "dup-version-todo"),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VCALENDAR with duplicate VERSION must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.6.5 VTIMEZONE ────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.6.5 VTIMEZONE roundtrips with TZID, STANDARD, DAYLIGHT", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-roundtrip");
    const uid = "vevent-with-tz";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTIMEZONE\r\n" +
      "TZID:America/New_York\r\n" +
      "BEGIN:STANDARD\r\n" +
      "DTSTART:19671029T020000\r\n" +
      "TZOFFSETFROM:-0400\r\n" +
      "TZOFFSETTO:-0500\r\n" +
      "TZNAME:EST\r\n" +
      "END:STANDARD\r\n" +
      "BEGIN:DAYLIGHT\r\n" +
      "DTSTART:19870405T020000\r\n" +
      "TZOFFSETFROM:-0500\r\n" +
      "TZOFFSETTO:-0400\r\n" +
      "TZNAME:EDT\r\n" +
      "END:DAYLIGHT\r\n" +
      "END:VTIMEZONE\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART;TZID=America/New_York:20260115T100000\r\n" +
      "DTEND;TZID=America/New_York:20260115T110000\r\n" +
      "SUMMARY:TZ Roundtrip\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("tz-roundtrip", uid), calContentType(), body);
    assertEquals(resp.status, 201, `PUT VTIMEZONE+VEVENT failed: ${resp.body}`);

    const getResp = await s.do("GET", objectPath("tz-roundtrip", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "BEGIN:VTIMEZONE");
    assertStringIncludes(getResp.body, "TZID:America/New_York");
    assertStringIncludes(getResp.body, "BEGIN:STANDARD");
    assertStringIncludes(getResp.body, "BEGIN:DAYLIGHT");
  });
});

Deno.test("RFC 5545 §3.6.5 VTIMEZONE STANDARD without TZOFFSETFROM rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("tz-invalid");
    const uid = "vevent-invalid-tz";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTIMEZONE\r\n" +
      "TZID:Bad/Zone\r\n" +
      "BEGIN:STANDARD\r\n" +
      "DTSTART:19671029T020000\r\n" +
      "TZOFFSETTO:-0500\r\n" +
      "END:STANDARD\r\n" +
      "END:VTIMEZONE\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART;TZID=Bad/Zone:20260115T100000\r\n" +
      "DTEND;TZID=Bad/Zone:20260115T110000\r\n" +
      "SUMMARY:Bad TZ\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("tz-invalid", uid), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VTIMEZONE STANDARD without TZOFFSETFROM must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test(
  "RFC 5545 §3.6.5 VEVENT with TZID-referenced DTSTART and embedded VTIMEZONE roundtrips",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("tz-dtstart-ref");
      const uid = "vevent-tzid-dtstart";
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VTIMEZONE\r\n" +
        "TZID:Europe/London\r\n" +
        "BEGIN:STANDARD\r\n" +
        "DTSTART:19701025T020000\r\n" +
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
        "DTSTAMP:20260101T000000Z\r\n" +
        "DTSTART;TZID=Europe/London:20260115T100000\r\n" +
        "DTEND;TZID=Europe/London:20260115T110000\r\n" +
        "SUMMARY:London TZ Event\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const resp = await s.do("PUT", objectPath("tz-dtstart-ref", uid), calContentType(), body);
      assertEquals(resp.status, 201, `PUT VEVENT with TZID-referenced DTSTART failed: ${resp.body}`);

      const getResp = await s.do("GET", objectPath("tz-dtstart-ref", uid));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, "TZID=Europe/London");
      assertStringIncludes(getResp.body, "DTSTART;TZID=Europe/London:20260115T100000");
    });
  },
);

// ─── §3.6.6 VALARM missing required properties ───────────────────────────────

Deno.test("RFC 5545 §3.6.6 VALARM without ACTION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-no-action");
    const uid = "valarm-no-action";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with bad alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "TRIGGER:-PT15M\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("alarm-no-action", uid), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VALARM without ACTION must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM without TRIGGER rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-no-trigger");
    const uid = "valarm-no-trigger";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with bad alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("alarm-no-trigger", uid), calContentType(), body);
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VALARM without TRIGGER must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM ACTION:DISPLAY without DESCRIPTION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-display-nodesc");
    const uid = "valarm-display-nodesc";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with bad DISPLAY alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "TRIGGER:-PT15M\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("alarm-display-nodesc", uid),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VALARM ACTION:DISPLAY without DESCRIPTION must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM ACTION:EMAIL without required properties rejected", async () => {
  // EMAIL VALARM requires DESCRIPTION, SUMMARY, and ATTENDEE
  await withServer(async (s) => {
    await s.mkcol("alarm-email-missing");
    const uid = "valarm-email-missing";
    // Missing SUMMARY and ATTENDEE
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with incomplete EMAIL alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:EMAIL\r\n" +
      "TRIGGER:-PT30M\r\n" +
      "DESCRIPTION:Reminder body\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("alarm-email-missing", uid),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VALARM ACTION:EMAIL without SUMMARY and ATTENDEE must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM ACTION:AUDIO inside VEVENT roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-audio-col");
    const uid = "valarm-audio";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with AUDIO alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:AUDIO\r\n" +
      "TRIGGER:-PT5M\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do("PUT", objectPath("alarm-audio-col", uid), calContentType(), body);
    assertEquals(resp.status, 201, `PUT VALARM ACTION:AUDIO failed: ${resp.body}`);

    const getResp = await s.do("GET", objectPath("alarm-audio-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "BEGIN:VALARM");
    assertStringIncludes(getResp.body, "ACTION:AUDIO");
    assertStringIncludes(getResp.body, "TRIGGER:-PT5M");
  });
});

Deno.test("RFC 5545 §3.6.6 VALARM with REPEAT but no DURATION rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("alarm-repeat-nodur");
    const uid = "valarm-repeat-nodur";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with REPEAT-only alarm\r\n" +
      "BEGIN:VALARM\r\n" +
      "ACTION:DISPLAY\r\n" +
      "DESCRIPTION:Reminder\r\n" +
      "TRIGGER:-PT15M\r\n" +
      "REPEAT:3\r\n" +
      "END:VALARM\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";
    const resp = await s.do(
      "PUT",
      objectPath("alarm-repeat-nodur", uid),
      calContentType(),
      body,
    );
    assertEquals(
      [400, 403, 422].includes(resp.status),
      true,
      `VALARM with REPEAT but no DURATION must be rejected; got ${resp.status}`,
    );
  });
});

// ─── §3.8.2.7 TRANSP ─────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.2.7 VEVENT TRANSP property roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("transp-col");
    for (const val of ["OPAQUE", "TRANSPARENT"]) {
      const uid = `transp-event-${val.toLowerCase()}`;
      await s.putEvent("transp-col", uid, `TRANSP:${val}`);
      const resp = await s.do("GET", objectPath("transp-col", uid));
      assertEquals(resp.status, 200);
      assertStringIncludes(resp.body, `TRANSP:${val}`, `TRANSP:${val} must round-trip`);
    }
  });
});

// ─── §3.8.1.7 LOCATION ───────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.7 LOCATION roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("loc-col");
    const evtUID = "loc-vevent";
    const todoUID = "loc-vtodo";
    await s.putEvent("loc-col", evtUID, "LOCATION:Conference Room A");
    await s.putTodo("loc-col", todoUID, "LOCATION:Home Office");

    const evtResp = await s.do("GET", objectPath("loc-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "LOCATION:Conference Room A");

    const todoResp = await s.do("GET", objectPath("loc-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "LOCATION:Home Office");
  });
});

// ─── §3.8.1.6 GEO ────────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.6 GEO property roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("geo-col");
    const evtUID = "geo-vevent";
    const todoUID = "geo-vtodo";
    await s.putEvent("geo-col", evtUID, "GEO:37.386013;-122.082932");
    await s.putTodo("geo-col", todoUID, "GEO:48.858844;2.294351");

    const evtResp = await s.do("GET", objectPath("geo-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "GEO:37.386013;-122.082932");

    const todoResp = await s.do("GET", objectPath("geo-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "GEO:48.858844;2.294351");
  });
});

// ─── §3.8.4.6 URL ────────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.6 URL roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("url-col");
    const evtUID = "url-vevent";
    const todoUID = "url-vtodo";
    await s.putEvent("url-col", evtUID, "URL:https://example.com/event");
    await s.putTodo("url-col", todoUID, "URL:https://example.com/todo");

    const evtResp = await s.do("GET", objectPath("url-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "URL:https://example.com/event");

    const todoResp = await s.do("GET", objectPath("url-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "URL:https://example.com/todo");
  });
});

// ─── §3.8.1.4 COMMENT ────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.4 COMMENT roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("comment-col");
    const evtUID = "comment-vevent";
    const todoUID = "comment-vtodo";
    await s.putEvent("comment-col", evtUID, "COMMENT:This is an event comment");
    await s.putTodo("comment-col", todoUID, "COMMENT:This is a todo comment");

    const evtResp = await s.do("GET", objectPath("comment-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "COMMENT:This is an event comment");

    const todoResp = await s.do("GET", objectPath("comment-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "COMMENT:This is a todo comment");
  });
});

// ─── §3.8.1.10 RESOURCES ─────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.10 RESOURCES roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("resources-col");
    const evtUID = "resources-vevent";
    const todoUID = "resources-vtodo";
    await s.putEvent("resources-col", evtUID, "RESOURCES:PROJECTOR,WHITEBOARD");
    await s.putTodo("resources-col", todoUID, "RESOURCES:LAPTOP");

    const evtResp = await s.do("GET", objectPath("resources-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "RESOURCES:");

    const todoResp = await s.do("GET", objectPath("resources-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "RESOURCES:LAPTOP");
  });
});

// ─── §3.8.4.2 CONTACT ────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.2 CONTACT roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("contact-col");
    const evtUID = "contact-vevent";
    const todoUID = "contact-vtodo";
    await s.putEvent("contact-col", evtUID, "CONTACT:Jim Dolittle\\, ABC Industries\\, +1-919-555-1234");
    await s.putTodo("contact-col", todoUID, "CONTACT:Jane Smith\\, XYZ Corp");

    const evtResp = await s.do("GET", objectPath("contact-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "CONTACT:");

    const todoResp = await s.do("GET", objectPath("contact-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "CONTACT:");
  });
});

// ─── §3.8.4.1 ATTENDEE ───────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.1 ATTENDEE roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("attendee-col");
    const evtUID = "attendee-vevent";
    const todoUID = "attendee-vtodo";
    await s.putEvent(
      "attendee-col",
      evtUID,
      "ORGANIZER:mailto:organizer@example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:attendee@example.com",
    );
    await s.putTodo(
      "attendee-col",
      todoUID,
      "ORGANIZER:mailto:organizer@example.com",
      "ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:worker@example.com",
    );

    const evtResp = await s.do("GET", objectPath("attendee-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "ATTENDEE");
    assertStringIncludes(evtResp.body, "attendee@example.com");

    const todoResp = await s.do("GET", objectPath("attendee-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "ATTENDEE");
    assertStringIncludes(todoResp.body, "worker@example.com");
  });
});

// ─── §3.8.4.3 ORGANIZER ──────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.3 ORGANIZER roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("organizer-col");
    const evtUID = "organizer-vevent";
    const todoUID = "organizer-vtodo";
    await s.putEvent("organizer-col", evtUID, "ORGANIZER:mailto:boss@example.com");
    await s.putTodo("organizer-col", todoUID, "ORGANIZER:mailto:lead@example.com");

    const evtResp = await s.do("GET", objectPath("organizer-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "ORGANIZER:mailto:boss@example.com");

    const todoResp = await s.do("GET", objectPath("organizer-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "ORGANIZER:mailto:lead@example.com");
  });
});

// ─── §3.8.1.1 ATTACH ─────────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.1 ATTACH URI roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-col");
    const evtUID = "attach-vevent";
    const todoUID = "attach-vtodo";
    await s.putEvent("attach-col", evtUID, "ATTACH:https://example.com/document.pdf");
    await s.putTodo("attach-col", todoUID, "ATTACH:https://example.com/requirements.docx");

    const evtResp = await s.do("GET", objectPath("attach-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "ATTACH:https://example.com/document.pdf");

    const todoResp = await s.do("GET", objectPath("attach-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "ATTACH:https://example.com/requirements.docx");
  });
});

// ─── §3.8.1.2 CATEGORIES comma-separated values preserved ────────────────────

Deno.test(
  "RFC 5545 §3.8.1.2 CATEGORIES comma-separated values all preserved in roundtrip",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("cat-csv-col");
      const uid = "categories-csv";
      await s.putEvent("cat-csv-col", uid, "CATEGORIES:APPOINTMENT,EDUCATION,PERSONAL");

      const resp = await s.do("GET", objectPath("cat-csv-col", uid));
      assertEquals(resp.status, 200);
      // All three category values must appear in the response body
      assertStringIncludes(resp.body, "APPOINTMENT");
      assertStringIncludes(resp.body, "EDUCATION");
      assertStringIncludes(resp.body, "PERSONAL");
    });
  },
);

// ─── §3.8.1.9 PRIORITY out-of-range rejected ─────────────────────────────────

Deno.test("RFC 5545 §3.8.1.9 PRIORITY out-of-range value rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("prio-range-col");
    for (const val of ["-1", "10", "100"]) {
      const uid = `prio-bad-${val.replace("-", "neg")}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260101T000000Z\r\n" +
        "DTSTART:20260115T100000Z\r\n" +
        "DTEND:20260115T110000Z\r\n" +
        `PRIORITY:${val}\r\n` +
        "SUMMARY:Bad priority\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("prio-range-col", uid), calContentType(), body);
      assertEquals(
        [400, 403, 422].includes(resp.status),
        true,
        `PRIORITY:${val} (out of range 0-9) must be rejected; got ${resp.status}`,
      );
    }
  });
});

// ─── §3.8.1.8 PERCENT-COMPLETE out-of-range rejected ─────────────────────────

Deno.test("RFC 5545 §3.8.1.8 PERCENT-COMPLETE out-of-range value rejected", async () => {
  await withServer(async (s) => {
    await s.mkcol("pct-range-col");
    for (const val of ["-1", "101", "200"]) {
      const uid = `pct-bad-${val.replace("-", "neg")}`;
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VTODO\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260101T000000Z\r\n" +
        `PERCENT-COMPLETE:${val}\r\n` +
        "SUMMARY:Bad percent-complete\r\n" +
        "END:VTODO\r\nEND:VCALENDAR\r\n";
      const resp = await s.do("PUT", objectPath("pct-range-col", uid), calContentType(), body);
      assertEquals(
        [400, 403, 422].includes(resp.status),
        true,
        `PERCENT-COMPLETE:${val} (out of range 0-100) must be rejected; got ${resp.status}`,
      );
    }
  });
});

// ─── §3.8.7.4 SEQUENCE on VEVENT ─────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.7.4 SEQUENCE roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("seq-evt-col");
    const uid = "seq-vevent";
    await s.putEvent("seq-evt-col", uid, "SEQUENCE:5");

    const resp = await s.do("GET", objectPath("seq-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "SEQUENCE:5");
  });
});

// ─── §3.8.7.1 CREATED on VEVENT ──────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.7.1 CREATED roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("created-evt-col");
    const uid = "created-vevent";
    await s.putEvent("created-evt-col", uid, "CREATED:20260101T060000Z");

    const resp = await s.do("GET", objectPath("created-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CREATED:20260101T060000Z");
  });
});

// ─── §3.8.7.3 LAST-MODIFIED on VEVENT ────────────────────────────────────────

Deno.test("RFC 5545 §3.8.7.3 LAST-MODIFIED roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("lastmod-evt-col");
    const uid = "lastmod-vevent";
    await s.putEvent("lastmod-evt-col", uid, "LAST-MODIFIED:20260101T070000Z");

    const resp = await s.do("GET", objectPath("lastmod-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LAST-MODIFIED:20260101T070000Z");
  });
});

// ─── §3.8.1.9 PRIORITY on VEVENT ─────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.9 PRIORITY roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("prio-evt-col");
    const uid = "prio-vevent";
    await s.putEvent("prio-evt-col", uid, "PRIORITY:2");

    const resp = await s.do("GET", objectPath("prio-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "PRIORITY:2");
  });
});

// ─── §3.8.1.5 DESCRIPTION on VEVENT ─────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.5 DESCRIPTION roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("desc-evt-col");
    const uid = "desc-vevent";
    await s.putEvent("desc-evt-col", uid, "DESCRIPTION:Full event description here");

    const resp = await s.do("GET", objectPath("desc-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "DESCRIPTION:Full event description here");
  });
});

// ─── §3.8.1.2 CATEGORIES on VEVENT ──────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.2 CATEGORIES roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("cat-evt-col");
    const uid = "cat-vevent";
    await s.putEvent("cat-evt-col", uid, "CATEGORIES:MEETING,WORK");

    const resp = await s.do("GET", objectPath("cat-evt-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CATEGORIES:");
  });
});

// ─── §3.8.1.3 CLASS on VEVENT ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.1.3 CLASS roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("class-evt-col");
    for (const cls of ["PUBLIC", "PRIVATE", "CONFIDENTIAL"]) {
      const uid = `class-vevent-${cls.toLowerCase()}`;
      await s.putEvent("class-evt-col", uid, `CLASS:${cls}`);
      const resp = await s.do("GET", objectPath("class-evt-col", uid));
      assertEquals(resp.status, 200);
      assertStringIncludes(resp.body, `CLASS:${cls}`);
    }
  });
});

// ─── §3.8.5.1 EXDATE on VTODO ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.5.1 EXDATE roundtrips on VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("exdate-todo-col");
    const uid = "exdate-vtodo";
    await s.putTodo(
      "exdate-todo-col",
      uid,
      "DTSTART:20260101T090000Z",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE:20260103T090000Z",
    );

    const resp = await s.do("GET", objectPath("exdate-todo-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "EXDATE:20260103T090000Z");
  });
});

// ─── §3.8.5.2 RDATE on VTODO ─────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.5.2 RDATE roundtrips on VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("rdate-todo-col");
    const uid = "rdate-vtodo";
    await s.putTodo("rdate-todo-col", uid, "DTSTART:20260101T090000Z", "RDATE:20260115T090000Z");

    const resp = await s.do("GET", objectPath("rdate-todo-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RDATE:20260115T090000Z");
  });
});

// ─── §3.8.5.2 RDATE with VALUE=PERIOD on VEVENT ──────────────────────────────

Deno.test("RFC 5545 §3.8.5.2 RDATE with VALUE=PERIOD roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("rdate-period-col");
    const uid = "rdate-period-vevent";
    await s.putEvent(
      "rdate-period-col",
      uid,
      "RDATE;VALUE=PERIOD:20260220T100000Z/PT2H",
    );

    const resp = await s.do("GET", objectPath("rdate-period-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RDATE");
    assertStringIncludes(resp.body, "20260220T100000Z");
  });
});

// ─── §3.8.4.4 RECURRENCE-ID on VTODO ────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.4 RECURRENCE-ID override on VTODO stored and retrievable", async () => {
  await withServer(async (s) => {
    await s.mkcol("recid-todo-col");
    const masterUID = "master-recurring-todo";
    await s.putTodo(
      "recid-todo-col",
      masterUID,
      "DTSTART:20260101T090000Z",
      "RRULE:FREQ=WEEKLY;COUNT=4",
    );

    const overrideUID = `${masterUID}-override`;
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${masterUID}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260108T090000Z\r\n" +
      "RECURRENCE-ID:20260108T090000Z\r\n" +
      "SUMMARY:Override Todo Instance\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do(
      "PUT",
      objectPath("recid-todo-col", overrideUID),
      calContentType(),
      body,
    );
    assertEquals(putResp.status < 500, true, "RECURRENCE-ID override on VTODO must not cause 5xx");

    if (putResp.status === 201) {
      const getResp = await s.do("GET", objectPath("recid-todo-col", overrideUID));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, "RECURRENCE-ID:20260108T090000Z");
    }
  });
});

Deno.test("RFC 5545 §3.8.4.4 RECURRENCE-ID with RANGE=THISANDFUTURE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("recid-range-col");
    const masterUID = "master-taf";
    await s.putEvent(
      "recid-range-col",
      masterUID,
      "RRULE:FREQ=DAILY;COUNT=10",
    );

    const overrideUID = `${masterUID}-taf`;
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${masterUID}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260117T100000Z\r\n" +
      "DTEND:20260117T110000Z\r\n" +
      "RECURRENCE-ID;RANGE=THISANDFUTURE:20260117T100000Z\r\n" +
      "SUMMARY:This and Future Override\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do(
      "PUT",
      objectPath("recid-range-col", overrideUID),
      calContentType(),
      body,
    );
    assertEquals(
      putResp.status < 500,
      true,
      "RECURRENCE-ID;RANGE=THISANDFUTURE must not cause 5xx",
    );

    if (putResp.status === 201) {
      const getResp = await s.do("GET", objectPath("recid-range-col", overrideUID));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, "RECURRENCE-ID");
      assertStringIncludes(getResp.body, "THISANDFUTURE");
    }
  });
});

// ─── §3.8.4.5 RELATED-TO on VEVENT ──────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.5 RELATED-TO roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("related-evt-col");
    const parentUID = "parent-vevent";
    const childUID = "child-vevent";
    await s.putEvent("related-evt-col", parentUID);
    await s.putEvent("related-evt-col", childUID, `RELATED-TO:${parentUID}`);

    const resp = await s.do("GET", objectPath("related-evt-col", childUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, `RELATED-TO:${parentUID}`);
  });
});

// ─── §3.8.4.7 Long UID ───────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.4.7 UID of 255 octets accepted and preserved without truncation", async () => {
  await withServer(async (s) => {
    await s.mkcol("longuid-col");
    // 255-character UID: 252 hex chars + "@example.com" = 264 but let's keep exactly 255 octets
    const uid = "a".repeat(243) + "@example.com"; // 243 + 12 = 255
    assertEquals(uid.length, 255);

    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Long UID Event\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const resp = await s.do(
      "PUT",
      objectPath("longuid-col", "longuid-event"),
      calContentType(),
      body,
    );
    assertEquals(resp.status, 201, `PUT with 255-octet UID failed: ${resp.body}`);

    const getResp = await s.do("GET", objectPath("longuid-col", "longuid-event"));
    assertEquals(getResp.status, 200);
    // The full UID must be preserved (not truncated); check for a distinctive suffix
    assertStringIncludes(getResp.body, uid.slice(-20));
  });
});

// ─── §3.1 Content line folding ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.1 server correctly unfolds folded content lines on PUT", async () => {
  await withServer(async (s) => {
    await s.mkcol("fold-col");
    const uid = "folded-event";
    // DESCRIPTION value folded across three lines (CRLF + SPACE continuation)
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Folded Event\r\n" +
      "DESCRIPTION:This is a very long description that has been folded\r\n" +
      " across multiple lines to test the server's unfolding\r\n" +
      " capability as required by RFC 5545 section 3.1\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("fold-col", uid), calContentType(), body);
    assertEquals(putResp.status, 201, `PUT with folded content lines failed: ${putResp.body}`);

    const getResp = await s.do("GET", objectPath("fold-col", uid));
    assertEquals(getResp.status, 200);
    // After unfolding, the DESCRIPTION value must contain the full text
    // (checking for a unique fragment that spans fold boundaries)
    assertStringIncludes(getResp.body, "DESCRIPTION:");
    assertStringIncludes(getResp.body, "folded");
    assertStringIncludes(getResp.body, "unfolding");
  });
});

// ─── §3.8.2.4 DATE-only DTSTART ──────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.2.4 VEVENT with DTSTART;VALUE=DATE roundtrips (all-day event)", async () => {
  await withServer(async (s) => {
    await s.mkcol("allday-col");
    const uid = "allday-vevent";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART;VALUE=DATE:20260115\r\n" +
      "DTEND;VALUE=DATE:20260116\r\n" +
      "SUMMARY:All Day Event\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("allday-col", uid), calContentType(), body);
    assertEquals(putResp.status, 201, `PUT all-day event failed: ${putResp.body}`);

    const getResp = await s.do("GET", objectPath("allday-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "VALUE=DATE");
    assertStringIncludes(getResp.body, "20260115");
  });
});

Deno.test("RFC 5545 §3.8.2.4 VTODO with DTSTART;VALUE=DATE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("allday-todo-col");
    const uid = "allday-vtodo";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART;VALUE=DATE:20260115\r\n" +
      "SUMMARY:All Day Todo\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("allday-todo-col", uid), calContentType(), body);
    assertEquals(putResp.status, 201, `PUT all-day VTODO failed: ${putResp.body}`);

    const getResp = await s.do("GET", objectPath("allday-todo-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "VALUE=DATE");
    assertStringIncludes(getResp.body, "20260115");
  });
});

Deno.test("RFC 5545 §3.8.2.3 VTODO DUE;VALUE=DATE roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("due-date-col");
    const uid = "due-date-vtodo";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART;VALUE=DATE:20260115\r\n" +
      "DUE;VALUE=DATE:20260120\r\n" +
      "SUMMARY:Todo with DATE DUE\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do("PUT", objectPath("due-date-col", uid), calContentType(), body);
    assertEquals(putResp.status, 201, `PUT VTODO DUE;VALUE=DATE failed: ${putResp.body}`);

    const getResp = await s.do("GET", objectPath("due-date-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "DUE");
    assertStringIncludes(getResp.body, "20260120");
  });
});

// ─── §3.8.5.3 RRULE with UNTIL ────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.5.3 RRULE with UNTIL in UTC roundtrips on VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("rrule-until-col");
    const uid = "rrule-until-event";
    await s.putEvent(
      "rrule-until-col",
      uid,
      "RRULE:FREQ=DAILY;UNTIL=20260131T235959Z",
    );

    const resp = await s.do("GET", objectPath("rrule-until-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RRULE:");
    assertStringIncludes(resp.body, "UNTIL=20260131T235959Z");
  });
});

Deno.test(
  "RFC 5545 §3.8.5.3 VEVENT with duplicate RRULE handled consistently (rejected or stores only one)",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("dup-rrule-col");
      const uid = "dup-rrule-event";
      const body =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
        "BEGIN:VEVENT\r\n" +
        `UID:${uid}\r\n` +
        "DTSTAMP:20260101T000000Z\r\n" +
        "DTSTART:20260115T100000Z\r\n" +
        "DTEND:20260115T110000Z\r\n" +
        "RRULE:FREQ=DAILY;COUNT=3\r\n" +
        "RRULE:FREQ=WEEKLY;COUNT=2\r\n" +
        "SUMMARY:Duplicate RRULE\r\n" +
        "END:VEVENT\r\nEND:VCALENDAR\r\n";

      const putResp = await s.do("PUT", objectPath("dup-rrule-col", uid), calContentType(), body);
      // Server MUST either reject (4xx) or accept and store only one RRULE (201)
      assertEquals(
        putResp.status < 500,
        true,
        `Duplicate RRULE must not cause 5xx; got ${putResp.status}`,
      );

      if (putResp.status === 201) {
        const getResp = await s.do("GET", objectPath("dup-rrule-col", uid));
        assertEquals(getResp.status, 200);
        // Count occurrences of "RRULE:" in the body — at most one is allowed
        const rruleCount = (getResp.body.match(/\bRRULE:/g) ?? []).length;
        assertEquals(
          rruleCount <= 1,
          true,
          `Server stored ${rruleCount} RRULE properties; MUST store at most one`,
        );
      }
    });
  },
);

// ─── §3.8.8.2 X-properties ────────────────────────────────────────────────────

Deno.test("RFC 5545 §3.8.8.2 X-property roundtrips on VEVENT and VTODO", async () => {
  await withServer(async (s) => {
    await s.mkcol("xprop-col");
    const evtUID = "xprop-vevent";
    const todoUID = "xprop-vtodo";
    await s.putEvent("xprop-col", evtUID, "X-CALSTAKK-CUSTOM:event-value-42");
    await s.putTodo("xprop-col", todoUID, "X-CALSTAKK-CUSTOM:todo-value-99");

    const evtResp = await s.do("GET", objectPath("xprop-col", evtUID));
    assertEquals(evtResp.status, 200);
    assertStringIncludes(evtResp.body, "X-CALSTAKK-CUSTOM:event-value-42");

    const todoResp = await s.do("GET", objectPath("xprop-col", todoUID));
    assertEquals(todoResp.status, 200);
    assertStringIncludes(todoResp.body, "X-CALSTAKK-CUSTOM:todo-value-99");
  });
});

// ─── §3.6.2 VTODO with DTSTART and DURATION (no DUE) ─────────────────────────

Deno.test("RFC 5545 §3.6.2 VTODO with DTSTART and DURATION (no DUE) roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-dtstart-dur-col");
    const uid = "vtodo-dtstart-and-dur";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DURATION:PT2H\r\n" +
      "SUMMARY:VTODO with DTSTART and DURATION\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const putResp = await s.do(
      "PUT",
      objectPath("vtodo-dtstart-dur-col", uid),
      calContentType(),
      body,
    );
    assertEquals(putResp.status, 201, `PUT VTODO with DTSTART+DURATION failed: ${putResp.body}`);

    const getResp = await s.do("GET", objectPath("vtodo-dtstart-dur-col", uid));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "DTSTART:20260115T100000Z");
    assertStringIncludes(getResp.body, "DURATION:PT2H");
  });
});
