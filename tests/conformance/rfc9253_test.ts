// RFC 9253 — Support for iCalendar Relationships
// Spec: specs/rfc9253.txt
//
// Coverage:
//   §3   New RELTYPE parameter values (PARENT, CHILD, SIBLING, CONCEPT,
//        DEPENDS-ON, REFID, STRUCTURED-DATA)
//   §4   The GAP parameter
//   §5   The LINK property
//   calendar-query filter by RELATED-TO

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  calContentType,
  collectionPath,
  objectPath,
  parseMultistatus,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §3 RELTYPE parameter values ──────────────────────────────────────────────

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=PARENT roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("rel-col");
    const parentUID = "parent-task-001";
    const childUID = "child-task-001";
    await s.putTodo("rel-col", parentUID);
    await s.putTodo("rel-col", childUID, `RELATED-TO;RELTYPE=PARENT:${parentUID}`);

    const resp = await s.do("GET", objectPath("rel-col", childUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "PARENT");
    assertStringIncludes(resp.body, parentUID);
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=CHILD roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("child-col");
    const parentUID = "parent-ref-001";
    const childUID = "child-ref-001";
    await s.putTodo("child-col", childUID);
    await s.putTodo("child-col", parentUID, `RELATED-TO;RELTYPE=CHILD:${childUID}`);

    const resp = await s.do("GET", objectPath("child-col", parentUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CHILD");
    assertStringIncludes(resp.body, childUID);
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=SIBLING roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("sib-col");
    const uid1 = "sibling-a-001";
    const uid2 = "sibling-b-001";
    await s.putTodo("sib-col", uid1);
    await s.putTodo("sib-col", uid2, `RELATED-TO;RELTYPE=SIBLING:${uid1}`);

    const resp = await s.do("GET", objectPath("sib-col", uid2));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "SIBLING");
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=DEPENDS-ON roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("dep-col");
    const prereqUID = "prereq-task-001";
    const depUID = "dependent-task-001";
    await s.putTodo("dep-col", prereqUID);
    await s.putTodo("dep-col", depUID, `RELATED-TO;RELTYPE=DEPENDS-ON:${prereqUID}`);

    const resp = await s.do("GET", objectPath("dep-col", depUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "DEPENDS-ON");
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=CONCEPT roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("concept-col");
    const uid = "concept-task-001";
    await s.putTodo(
      "concept-col",
      uid,
      "RELATED-TO;RELTYPE=CONCEPT:urn:example:concepts:projectmanagement",
    );

    const resp = await s.do("GET", objectPath("concept-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CONCEPT");
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=REFID roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("refid-col");
    const refid = "urn:example:project:42";
    await s.putTodo("refid-col", "refid-task-001", `RELATED-TO;RELTYPE=REFID:${refid}`);
    await s.putTodo("refid-col", "refid-task-002", `RELATED-TO;RELTYPE=REFID:${refid}`);

    const resp1 = await s.do("GET", objectPath("refid-col", "refid-task-001"));
    assertEquals(resp1.status, 200);
    assertStringIncludes(resp1.body, "REFID");

    const resp2 = await s.do("GET", objectPath("refid-col", "refid-task-002"));
    assertEquals(resp2.status, 200);
    assertStringIncludes(resp2.body, "REFID");
  });
});

Deno.test("RFC 9253 §3 RELATED-TO;RELTYPE=STRUCTURED-DATA roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("sd-col");
    const uid = "sd-task-001";
    await s.putTodo(
      "sd-col",
      uid,
      "RELATED-TO;RELTYPE=STRUCTURED-DATA:https://example.com/data/42",
    );

    const resp = await s.do("GET", objectPath("sd-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "STRUCTURED-DATA");
  });
});

Deno.test("RFC 9253 §3 multiple RELATED-TO properties roundtrip", async () => {
  await withServer(async (s) => {
    await s.mkcol("multi-rel-col");
    const parentUID = "multi-parent-001";
    const depUID = "multi-dep-001";
    const taskUID = "multi-task-001";
    await s.putTodo("multi-rel-col", parentUID);
    await s.putTodo("multi-rel-col", depUID);
    await s.putTodo(
      "multi-rel-col",
      taskUID,
      `RELATED-TO;RELTYPE=PARENT:${parentUID}`,
      `RELATED-TO;RELTYPE=DEPENDS-ON:${depUID}`,
    );

    const resp = await s.do("GET", objectPath("multi-rel-col", taskUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, parentUID);
    assertStringIncludes(resp.body, depUID);
  });
});

// ─── §4 GAP parameter ─────────────────────────────────────────────────────────

Deno.test("RFC 9253 §4 GAP parameter on RELATED-TO roundtrips", async () => {
  await withServer(async (s) => {
    await s.mkcol("gap-col");
    const prereqUID = "gap-prereq-001";
    const uid = "gap-task-001";
    await s.putTodo("gap-col", prereqUID);
    await s.putTodo("gap-col", uid, `RELATED-TO;RELTYPE=DEPENDS-ON;GAP=PT1H:${prereqUID}`);

    const resp = await s.do("GET", objectPath("gap-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "GAP=PT1H");
  });
});

// ─── §5 LINK property ─────────────────────────────────────────────────────────

Deno.test("RFC 9253 §5 LINK property must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("link-col");
    const uid = "link-task-001";
    const body =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      `UID:${uid}\r\n` +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Link Test\r\n" +
      "LINK;LINKREL=related:https://example.com/related-resource\r\n" +
      "END:VTODO\r\nEND:VCALENDAR\r\n";

    const resp = await s.do("PUT", objectPath("link-col", uid), calContentType(), body);
    assertEquals(resp.status < 500, true, "PUT with LINK property must not cause 5xx");

    if (resp.status === 201) {
      const getResp = await s.do("GET", objectPath("link-col", uid));
      assertEquals(getResp.status, 200);
      assertStringIncludes(getResp.body, "LINK");
    }
  });
});

// ─── calendar-query with RELATED-TO filter ────────────────────────────────────

Deno.test("RFC 9253 §3 calendar-query filter by RELATED-TO finds child task", async () => {
  await withServer(async (s) => {
    await s.mkcol("relquery-col");
    const parentUID = "relq-parent-001";
    await s.putTodo("relquery-col", parentUID);
    await s.putTodo(
      "relquery-col",
      "relq-child-001",
      `RELATED-TO;RELTYPE=PARENT:${parentUID}`,
    );
    await s.putTodo("relquery-col", "relq-unrelated-001");

    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><D:getetag/></D:prop>` +
      `<C:filter><C:comp-filter name="VCALENDAR">` +
      `<C:comp-filter name="VTODO">` +
      `<C:prop-filter name="RELATED-TO">` +
      `<C:text-match>${parentUID}</C:text-match>` +
      `</C:prop-filter>` +
      `</C:comp-filter></C:comp-filter></C:filter>` +
      `</C:calendar-query>`;

    const resp = await s.do(
      "REPORT",
      collectionPath("relquery-col"),
      xmlContentType(),
      body,
    );
    assertEquals(resp.status, 207);

    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("relquery-col", "relq-child-001")) !== undefined,
      true,
      "child task must appear in RELATED-TO filter query",
    );
    assertEquals(
      ms.response(objectPath("relquery-col", "relq-unrelated-001")),
      undefined,
      "unrelated task must NOT appear in RELATED-TO filter query",
    );
  });
});
