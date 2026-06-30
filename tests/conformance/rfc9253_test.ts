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
  vtodo,
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

// ─── §6.1 LINKREL parameter requirements ──────────────────────────────────────

Deno.test("RFC 9253 §6.1 LINK without LINKREL parameter is rejected or stored with error", async () => {
  // RFC 9253 §6.1: The LINKREL parameter MUST be specified on all LINK properties.
  // There is no default relation type, so a LINK missing LINKREL MUST be rejected.
  await withServer(async (s) => {
    await s.mkcol("link-no-linkrel-col");
    const uid = "link-no-linkrel-001";
    const body = vtodo(uid, "LINK;VALUE=URI:https://example.com/resource");

    const resp = await s.do("PUT", objectPath("link-no-linkrel-col", uid), calContentType(), body);
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `LINK without LINKREL MUST be rejected with 4xx, got ${resp.status}`,
    );
  });
});

Deno.test("RFC 9253 §6.1 LINK with extension LINKREL (quoted URI) roundtrips", async () => {
  // RFC 9253 §6.1: LINKREL may take an extension relation type expressed as a quoted URI.
  await withServer(async (s) => {
    await s.mkcol("link-ext-linkrel-col");
    const uid = "link-ext-linkrel-001";
    const linkLine =
      'LINK;VALUE=URI;LINKREL="https://example.com/linkrel/derivedFrom":https://example.com/source-resource';
    await s.putTodo("link-ext-linkrel-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-ext-linkrel-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "https://example.com/linkrel/derivedFrom");
    assertStringIncludes(resp.body, "https://example.com/source-resource");
  });
});

// ─── §8.2 LINK property ───────────────────────────────────────────────────────

Deno.test("RFC 9253 §8.2 LINK without VALUE parameter is rejected", async () => {
  // RFC 9253 §8.2: The VALUE parameter is REQUIRED on the LINK property.
  await withServer(async (s) => {
    await s.mkcol("link-no-value-col");
    const uid = "link-no-value-001";
    const body = vtodo(uid, "LINK;LINKREL=related:https://example.com/resource");

    const resp = await s.do("PUT", objectPath("link-no-value-col", uid), calContentType(), body);
    assertEquals(
      resp.status >= 400 && resp.status < 500,
      true,
      `LINK without VALUE MUST be rejected with 4xx, got ${resp.status}`,
    );
  });
});

Deno.test("RFC 9253 §8.2 LINK;VALUE=URI;LINKREL=... roundtrips with all parameters intact", async () => {
  // RFC 9253 §8.2: LINK with VALUE=URI roundtrips with LINKREL, VALUE, FMTTYPE, LABEL, LANGUAGE preserved.
  await withServer(async (s) => {
    await s.mkcol("link-full-col");
    const uid = "link-full-001";
    const linkLine =
      "LINK;VALUE=URI;LINKREL=related;FMTTYPE=text/html;LABEL=Resource;LANGUAGE=en:https://example.com/full-resource";
    await s.putTodo("link-full-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-full-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "VALUE=URI");
    assertStringIncludes(resp.body, "LINKREL=related");
    assertStringIncludes(resp.body, "FMTTYPE=text/html");
    assertStringIncludes(resp.body, "LABEL=Resource");
    assertStringIncludes(resp.body, "LANGUAGE=en");
    assertStringIncludes(resp.body, "https://example.com/full-resource");
  });
});

Deno.test("RFC 9253 §8.2 LINK;VALUE=UID roundtrips and refers to component in same collection", async () => {
  // RFC 9253 §8.2 / §2 / §7: LINK;VALUE=UID links to another component UID within the same collection.
  await withServer(async (s) => {
    await s.mkcol("link-uid-col");
    const targetUID = "link-uid-target-001";
    const sourceUID = "link-uid-source-001";
    await s.putTodo("link-uid-col", targetUID);
    const linkLine = `LINK;VALUE=UID;LINKREL=related:${targetUID}`;
    await s.putTodo("link-uid-col", sourceUID, linkLine);

    const resp = await s.do("GET", objectPath("link-uid-col", sourceUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "VALUE=UID");
    assertStringIncludes(resp.body, "LINKREL=related");
    assertStringIncludes(resp.body, targetUID);
  });
});

Deno.test("RFC 9253 §8.2 LINK;VALUE=XML-REFERENCE roundtrips intact", async () => {
  // RFC 9253 §8.2 / §2 / §7: LINK;VALUE=XML-REFERENCE is a URI with an XPointer anchor.
  await withServer(async (s) => {
    await s.mkcol("link-xmlref-col");
    const uid = "link-xmlref-001";
    const linkLine =
      "LINK;VALUE=XML-REFERENCE;LINKREL=related:https://example.com/doc.xml#xpointer(id('intro'))";
    await s.putTodo("link-xmlref-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-xmlref-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "VALUE=XML-REFERENCE");
    assertStringIncludes(resp.body, "https://example.com/doc.xml");
  });
});

Deno.test("RFC 9253 §8.2 multiple LINK properties on a single component all roundtrip", async () => {
  // RFC 9253 §8.2: LINK may be specified zero or more times on a single component.
  await withServer(async (s) => {
    await s.mkcol("link-multi-col");
    const uid = "link-multi-001";
    const link1 = "LINK;VALUE=URI;LINKREL=related:https://example.com/resource-one";
    const link2 = "LINK;VALUE=URI;LINKREL=describedby:https://example.com/resource-two";
    const link3 = "LINK;VALUE=URI;LINKREL=enclosure:https://example.com/resource-three";
    await s.putTodo("link-multi-col", uid, link1, link2, link3);

    const resp = await s.do("GET", objectPath("link-multi-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "https://example.com/resource-one");
    assertStringIncludes(resp.body, "https://example.com/resource-two");
    assertStringIncludes(resp.body, "https://example.com/resource-three");
  });
});

Deno.test("RFC 9253 §8.2 LINK property on VEVENT roundtrips", async () => {
  // RFC 9253 §8.2: LINK property is valid on VEVENT components.
  await withServer(async (s) => {
    await s.mkcol("link-vevent-col");
    const uid = "link-vevent-001";
    const linkLine = "LINK;VALUE=URI;LINKREL=related:https://example.com/event-resource";
    await s.putEvent("link-vevent-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-vevent-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "LINKREL=related");
    assertStringIncludes(resp.body, "https://example.com/event-resource");
  });
});

Deno.test("RFC 9253 §8.2 LINK;FMTTYPE=... parameter roundtrips intact", async () => {
  // RFC 9253 §8.2: LINK FMTTYPE parameter is preserved on roundtrip.
  await withServer(async (s) => {
    await s.mkcol("link-fmttype-col");
    const uid = "link-fmttype-001";
    const linkLine =
      "LINK;VALUE=URI;LINKREL=enclosure;FMTTYPE=application/pdf:https://example.com/document.pdf";
    await s.putTodo("link-fmttype-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-fmttype-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "FMTTYPE=application/pdf");
    assertStringIncludes(resp.body, "https://example.com/document.pdf");
  });
});

Deno.test("RFC 9253 §8.2 LINK;LABEL=... parameter roundtrips intact", async () => {
  // RFC 9253 §8.2: LINK LABEL parameter (defined in RFC 7986) is preserved on roundtrip.
  await withServer(async (s) => {
    await s.mkcol("link-label-col");
    const uid = "link-label-001";
    const linkLine =
      "LINK;VALUE=URI;LINKREL=related;LABEL=Meeting Notes:https://example.com/notes";
    await s.putTodo("link-label-col", uid, linkLine);

    const resp = await s.do("GET", objectPath("link-label-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "LINK");
    assertStringIncludes(resp.body, "LABEL=Meeting Notes");
    assertStringIncludes(resp.body, "https://example.com/notes");
  });
});

// ─── §8.1 CONCEPT property ────────────────────────────────────────────────────

Deno.test("RFC 9253 §8.1 CONCEPT property on VTODO roundtrips as URI", async () => {
  // RFC 9253 §8.1: CONCEPT is a standalone iCalendar property with a URI value,
  // distinct from RELATED-TO;RELTYPE=CONCEPT.
  await withServer(async (s) => {
    await s.mkcol("concept-prop-col");
    const uid = "concept-prop-001";
    await s.putTodo("concept-prop-col", uid, "CONCEPT:https://example.com/concepts/project-management");

    const resp = await s.do("GET", objectPath("concept-prop-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CONCEPT:");
    assertStringIncludes(resp.body, "https://example.com/concepts/project-management");
  });
});

Deno.test("RFC 9253 §8.1 CONCEPT property on VEVENT roundtrips", async () => {
  // RFC 9253 §8.1: CONCEPT property is valid on VEVENT components.
  await withServer(async (s) => {
    await s.mkcol("concept-vevent-col");
    const uid = "concept-vevent-001";
    await s.putEvent("concept-vevent-col", uid, "CONCEPT:https://example.com/concepts/meeting");

    const resp = await s.do("GET", objectPath("concept-vevent-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "CONCEPT:");
    assertStringIncludes(resp.body, "https://example.com/concepts/meeting");
  });
});

Deno.test("RFC 9253 §8.1 multiple CONCEPT properties on a single component all roundtrip", async () => {
  // RFC 9253 §8.1: Multiple CONCEPT properties can be specified on a single component.
  await withServer(async (s) => {
    await s.mkcol("concept-multi-col");
    const uid = "concept-multi-001";
    await s.putTodo(
      "concept-multi-col",
      uid,
      "CONCEPT:https://example.com/concepts/planning",
      "CONCEPT:https://example.com/concepts/review",
      "CONCEPT:urn:example:category:high-priority",
    );

    const resp = await s.do("GET", objectPath("concept-multi-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "https://example.com/concepts/planning");
    assertStringIncludes(resp.body, "https://example.com/concepts/review");
    assertStringIncludes(resp.body, "urn:example:category:high-priority");
  });
});

// ─── §8.3 REFID property ──────────────────────────────────────────────────────

Deno.test("RFC 9253 §8.3 REFID property on VTODO roundtrips as text", async () => {
  // RFC 9253 §8.3: REFID is a standalone iCalendar property with a TEXT value,
  // distinct from RELATED-TO;RELTYPE=REFID.
  await withServer(async (s) => {
    await s.mkcol("refid-prop-col");
    const uid = "refid-prop-001";
    await s.putTodo("refid-prop-col", uid, "REFID:project-sprint-42");

    const resp = await s.do("GET", objectPath("refid-prop-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "REFID:");
    assertStringIncludes(resp.body, "project-sprint-42");
  });
});

Deno.test("RFC 9253 §8.3 REFID property on VEVENT roundtrips", async () => {
  // RFC 9253 §8.3: REFID property is valid on VEVENT components.
  await withServer(async (s) => {
    await s.mkcol("refid-vevent-col");
    const uid = "refid-vevent-001";
    await s.putEvent("refid-vevent-col", uid, "REFID:event-series-007");

    const resp = await s.do("GET", objectPath("refid-vevent-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "REFID:");
    assertStringIncludes(resp.body, "event-series-007");
  });
});

Deno.test("RFC 9253 §8.3 multiple REFID properties on a single component all roundtrip", async () => {
  // RFC 9253 §8.3: Multiple REFID properties can be specified on a single component.
  await withServer(async (s) => {
    await s.mkcol("refid-multi-col");
    const uid = "refid-multi-001";
    await s.putTodo(
      "refid-multi-col",
      uid,
      "REFID:project-alpha",
      "REFID:sprint-3",
      "REFID:milestone-beta",
    );

    const resp = await s.do("GET", objectPath("refid-multi-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "project-alpha");
    assertStringIncludes(resp.body, "sprint-3");
    assertStringIncludes(resp.body, "milestone-beta");
  });
});

// ─── §4 Temporal RELTYPE values ───────────────────────────────────────────────

Deno.test("RFC 9253 §4 RELATED-TO;RELTYPE=FINISHTOSTART roundtrips", async () => {
  // RFC 9253 §4: FINISHTOSTART — successor cannot start until predecessor finishes.
  await withServer(async (s) => {
    await s.mkcol("fts-col");
    const predUID = "fts-pred-001";
    const succUID = "fts-succ-001";
    await s.putTodo("fts-col", predUID);
    await s.putTodo("fts-col", succUID, `RELATED-TO;RELTYPE=FINISHTOSTART:${predUID}`);

    const resp = await s.do("GET", objectPath("fts-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=FINISHTOSTART");
    assertStringIncludes(resp.body, predUID);
  });
});

Deno.test("RFC 9253 §4 RELATED-TO;RELTYPE=FINISHTOFINISH roundtrips", async () => {
  // RFC 9253 §4: FINISHTOFINISH — successor cannot finish until predecessor finishes.
  await withServer(async (s) => {
    await s.mkcol("ftf-col");
    const predUID = "ftf-pred-001";
    const succUID = "ftf-succ-001";
    await s.putTodo("ftf-col", predUID);
    await s.putTodo("ftf-col", succUID, `RELATED-TO;RELTYPE=FINISHTOFINISH:${predUID}`);

    const resp = await s.do("GET", objectPath("ftf-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=FINISHTOFINISH");
    assertStringIncludes(resp.body, predUID);
  });
});

Deno.test("RFC 9253 §4 RELATED-TO;RELTYPE=STARTTOFINISH roundtrips", async () => {
  // RFC 9253 §4: STARTTOFINISH — successor cannot finish until predecessor starts.
  await withServer(async (s) => {
    await s.mkcol("stf-col");
    const predUID = "stf-pred-001";
    const succUID = "stf-succ-001";
    await s.putTodo("stf-col", predUID);
    await s.putTodo("stf-col", succUID, `RELATED-TO;RELTYPE=STARTTOFINISH:${predUID}`);

    const resp = await s.do("GET", objectPath("stf-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=STARTTOFINISH");
    assertStringIncludes(resp.body, predUID);
  });
});

Deno.test("RFC 9253 §4 RELATED-TO;RELTYPE=STARTTOSTART roundtrips", async () => {
  // RFC 9253 §4: STARTTOSTART — successor cannot start until predecessor starts.
  await withServer(async (s) => {
    await s.mkcol("sts-col");
    const predUID = "sts-pred-001";
    const succUID = "sts-succ-001";
    await s.putTodo("sts-col", predUID);
    await s.putTodo("sts-col", succUID, `RELATED-TO;RELTYPE=STARTTOSTART:${predUID}`);

    const resp = await s.do("GET", objectPath("sts-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=STARTTOSTART");
    assertStringIncludes(resp.body, predUID);
  });
});

// ─── §5 Ordering RELTYPE values ───────────────────────────────────────────────

Deno.test("RFC 9253 §5 RELATED-TO;RELTYPE=FIRST roundtrips", async () => {
  // RFC 9253 §5: FIRST ordering relationship — the referenced component is first in a series.
  await withServer(async (s) => {
    await s.mkcol("first-col");
    const firstUID = "series-first-001";
    const currentUID = "series-current-001";
    await s.putTodo("first-col", firstUID);
    await s.putTodo("first-col", currentUID, `RELATED-TO;RELTYPE=FIRST:${firstUID}`);

    const resp = await s.do("GET", objectPath("first-col", currentUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=FIRST");
    assertStringIncludes(resp.body, firstUID);
  });
});

Deno.test("RFC 9253 §5 RELATED-TO;RELTYPE=NEXT roundtrips", async () => {
  // RFC 9253 §5: NEXT ordering relationship — the referenced component is next in a series.
  await withServer(async (s) => {
    await s.mkcol("next-col");
    const nextUID = "series-next-001";
    const currentUID = "series-item-001";
    await s.putTodo("next-col", nextUID);
    await s.putTodo("next-col", currentUID, `RELATED-TO;RELTYPE=NEXT:${nextUID}`);

    const resp = await s.do("GET", objectPath("next-col", currentUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=NEXT");
    assertStringIncludes(resp.body, nextUID);
  });
});

// ─── §9.1 RELATED-TO value type extensions ────────────────────────────────────

Deno.test("RFC 9253 §9.1 RELATED-TO;VALUE=URI roundtrips", async () => {
  // RFC 9253 §9.1: RELATED-TO is extended to allow VALUE=URI in addition to UID and TEXT.
  await withServer(async (s) => {
    await s.mkcol("rel-uri-col");
    const uid = "rel-uri-001";
    await s.putTodo(
      "rel-uri-col",
      uid,
      "RELATED-TO;VALUE=URI;RELTYPE=DEPENDS-ON:https://example.com/related/task",
    );

    const resp = await s.do("GET", objectPath("rel-uri-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "VALUE=URI");
    assertStringIncludes(resp.body, "https://example.com/related/task");
  });
});

Deno.test("RFC 9253 §9.1 RELATED-TO;RELTYPE=PARENT/CHILD/SIBLING MUST use VALUE=UID", async () => {
  // RFC 9253 §9.1: PARENT, SIBLING, and CHILD relationships MUST use VALUE=UID for
  // backwards compatibility. VALUE=URI MUST be rejected with these RELTYPE values.
  await withServer(async (s) => {
    await s.mkcol("rel-pcs-col");

    // Correct: PARENT with implicit UID value MUST be accepted.
    const parentUID = "rel-pcs-parent-001";
    const childUID = "rel-pcs-child-001";
    await s.putTodo("rel-pcs-col", parentUID);
    await s.putTodo("rel-pcs-col", childUID, `RELATED-TO;RELTYPE=PARENT:${parentUID}`);

    const getResp = await s.do("GET", objectPath("rel-pcs-col", childUID));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, parentUID);

    // Invalid: PARENT with VALUE=URI MUST be rejected.
    const badUID = "rel-pcs-bad-001";
    const body = vtodo(badUID, "RELATED-TO;RELTYPE=PARENT;VALUE=URI:https://example.com/bad-parent");
    const putResp = await s.do(
      "PUT",
      objectPath("rel-pcs-col", badUID),
      calContentType(),
      body,
    );
    assertEquals(
      putResp.status >= 400 && putResp.status < 500,
      true,
      `RELATED-TO;RELTYPE=PARENT;VALUE=URI MUST be rejected with 4xx, got ${putResp.status}`,
    );
  });
});

// ─── §6.2 GAP parameter extensions ───────────────────────────────────────────

Deno.test("RFC 9253 §6.2 GAP parameter with negative duration (lead time) roundtrips", async () => {
  // RFC 9253 §6.2: GAP supports negative duration values indicating lead time,
  // where the successor starts before the predecessor finishes.
  await withServer(async (s) => {
    await s.mkcol("gap-neg-col");
    const predUID = "gap-neg-pred-001";
    const succUID = "gap-neg-succ-001";
    await s.putTodo("gap-neg-col", predUID);
    await s.putTodo("gap-neg-col", succUID, `RELATED-TO;RELTYPE=DEPENDS-ON;GAP=-PT1H:${predUID}`);

    const resp = await s.do("GET", objectPath("gap-neg-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "GAP=-PT1H");
    assertStringIncludes(resp.body, predUID);
  });
});

Deno.test("RFC 9253 §4/§6.2 GAP parameter combined with temporal RELTYPE (FINISHTOSTART) roundtrips", async () => {
  // RFC 9253 §4/§6.2: GAP is used together with temporal RELTYPE values such as FINISHTOSTART.
  await withServer(async (s) => {
    await s.mkcol("gap-temporal-col");
    const predUID = "gap-temporal-pred-001";
    const succUID = "gap-temporal-succ-001";
    await s.putTodo("gap-temporal-col", predUID);
    await s.putTodo(
      "gap-temporal-col",
      succUID,
      `RELATED-TO;RELTYPE=FINISHTOSTART;GAP=PT2H:${predUID}`,
    );

    const resp = await s.do("GET", objectPath("gap-temporal-col", succUID));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=FINISHTOSTART");
    assertStringIncludes(resp.body, "GAP=PT2H");
    assertStringIncludes(resp.body, predUID);
  });
});

// ─── §3/§9.1 RELATED-TO on VEVENT ────────────────────────────────────────────

Deno.test("RFC 9253 §9.1 RELATED-TO with new RELTYPE values roundtrips on VEVENT", async () => {
  // RFC 9253 §3/§9.1: RELATED-TO properties with all new RELTYPE values are valid on VEVENT.
  await withServer(async (s) => {
    await s.mkcol("reltype-vevent-col");
    const depUID = "reltype-vevent-dep-001";
    const uid = "reltype-vevent-001";
    await s.putEvent("reltype-vevent-col", depUID);
    await s.putEvent(
      "reltype-vevent-col",
      uid,
      `RELATED-TO;RELTYPE=DEPENDS-ON:${depUID}`,
      `RELATED-TO;RELTYPE=FINISHTOSTART:${depUID}`,
      `RELATED-TO;RELTYPE=FIRST:${depUID}`,
    );

    const resp = await s.do("GET", objectPath("reltype-vevent-col", uid));
    assertEquals(resp.status, 200);
    assertStringIncludes(resp.body, "RELTYPE=DEPENDS-ON");
    assertStringIncludes(resp.body, "RELTYPE=FINISHTOSTART");
    assertStringIncludes(resp.body, "RELTYPE=FIRST");
  });
});

// ─── §8.3 calendar-query filter by REFID ─────────────────────────────────────

Deno.test("RFC 9253 §8.3 calendar-query prop-filter by REFID property retrieves matching components", async () => {
  // RFC 9253 §8.3: Calendar-query REPORT can filter components by REFID property value.
  await withServer(async (s) => {
    await s.mkcol("refid-query-col");
    const sharedRefid = "sprint-99";
    await s.putTodo("refid-query-col", "refid-match-001", `REFID:${sharedRefid}`);
    await s.putTodo("refid-query-col", "refid-match-002", `REFID:${sharedRefid}`);
    await s.putTodo("refid-query-col", "refid-nomatch-001", "REFID:different-sprint");
    await s.putTodo("refid-query-col", "refid-none-001");

    const queryBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><D:getetag/></D:prop>` +
      `<C:filter><C:comp-filter name="VCALENDAR">` +
      `<C:comp-filter name="VTODO">` +
      `<C:prop-filter name="REFID">` +
      `<C:text-match>${sharedRefid}</C:text-match>` +
      `</C:prop-filter>` +
      `</C:comp-filter></C:comp-filter></C:filter>` +
      `</C:calendar-query>`;

    const resp = await s.do(
      "REPORT",
      collectionPath("refid-query-col"),
      xmlContentType(),
      queryBody,
    );
    assertEquals(resp.status, 207);

    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("refid-query-col", "refid-match-001")) !== undefined,
      true,
      "first matching REFID component must appear in results",
    );
    assertEquals(
      ms.response(objectPath("refid-query-col", "refid-match-002")) !== undefined,
      true,
      "second matching REFID component must appear in results",
    );
    assertEquals(
      ms.response(objectPath("refid-query-col", "refid-nomatch-001")),
      undefined,
      "component with different REFID must NOT appear in results",
    );
    assertEquals(
      ms.response(objectPath("refid-query-col", "refid-none-001")),
      undefined,
      "component without REFID must NOT appear in results",
    );
  });
});

// ─── §8.1 calendar-query filter by CONCEPT ────────────────────────────────────

Deno.test("RFC 9253 §8.1 calendar-query prop-filter by CONCEPT property retrieves matching components", async () => {
  // RFC 9253 §8.1: Calendar-query REPORT can filter components by CONCEPT property value.
  await withServer(async (s) => {
    await s.mkcol("concept-query-col");
    const conceptURI = "https://example.com/concepts/development";
    await s.putTodo("concept-query-col", "concept-match-001", `CONCEPT:${conceptURI}`);
    await s.putTodo("concept-query-col", "concept-match-002", `CONCEPT:${conceptURI}`);
    await s.putTodo(
      "concept-query-col",
      "concept-nomatch-001",
      "CONCEPT:https://example.com/concepts/other",
    );
    await s.putTodo("concept-query-col", "concept-none-001");

    const queryBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><D:getetag/></D:prop>` +
      `<C:filter><C:comp-filter name="VCALENDAR">` +
      `<C:comp-filter name="VTODO">` +
      `<C:prop-filter name="CONCEPT">` +
      `<C:text-match>${conceptURI}</C:text-match>` +
      `</C:prop-filter>` +
      `</C:comp-filter></C:comp-filter></C:filter>` +
      `</C:calendar-query>`;

    const resp = await s.do(
      "REPORT",
      collectionPath("concept-query-col"),
      xmlContentType(),
      queryBody,
    );
    assertEquals(resp.status, 207);

    const ms = parseMultistatus(resp.body);
    assertEquals(
      ms.response(objectPath("concept-query-col", "concept-match-001")) !== undefined,
      true,
      "first matching CONCEPT component must appear in results",
    );
    assertEquals(
      ms.response(objectPath("concept-query-col", "concept-match-002")) !== undefined,
      true,
      "second matching CONCEPT component must appear in results",
    );
    assertEquals(
      ms.response(objectPath("concept-query-col", "concept-nomatch-001")),
      undefined,
      "component with different CONCEPT must NOT appear in results",
    );
    assertEquals(
      ms.response(objectPath("concept-query-col", "concept-none-001")),
      undefined,
      "component without CONCEPT must NOT appear in results",
    );
  });
});

