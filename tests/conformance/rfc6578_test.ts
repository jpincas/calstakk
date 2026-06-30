// RFC 6578 — Collection Synchronization for WebDAV
// Spec: specs/rfc6578.txt
//
// Coverage:
//   §3   The sync-token DAV property
//   §6   The sync-collection REPORT
//   §7   Error conditions (invalid-sync-token)

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  calendarHomePath,
  collectionPath,
  extractSyncToken,
  nsDAV,
  objectPath,
  propfindProps,
  syncCollectionReport,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §3 sync-token property ───────────────────────────────────────────────────

Deno.test("RFC 6578 §3 sync-token property exists on calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("sync-tok");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("sync-tok"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("sync-token"),
      true,
      "PROPFIND response must contain sync-token element",
    );
  });
});

Deno.test("RFC 6578 §3 sync-token present on calendar home", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      calendarHomePath,
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes("sync-token"), true, "calendar home must expose sync-token");
  });
});

Deno.test("RFC 6578 §3 sync-token changes after PUT", async () => {
  await withServer(async (s) => {
    await s.mkcol("tok-change");

    const resp1 = await s.do(
      "PROPFIND",
      collectionPath("tok-change"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    const tok1 = extractSyncToken(resp1.body);

    await s.putTodo("tok-change", "sync-todo1");

    const resp2 = await s.do(
      "PROPFIND",
      collectionPath("tok-change"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    const tok2 = extractSyncToken(resp2.body);

    assertNotEquals(tok1, tok2, "sync-token must change after PUT");
    assertNotEquals(tok2, "", "new sync-token must not be empty");
  });
});

Deno.test("RFC 6578 §3 sync-token changes after DELETE", async () => {
  await withServer(async (s) => {
    await s.mkcol("tok-del");
    await s.putTodo("tok-del", "del-todo");

    const resp1 = await s.do(
      "PROPFIND",
      collectionPath("tok-del"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    const tok1 = extractSyncToken(resp1.body);

    await s.do("DELETE", objectPath("tok-del", "del-todo"));

    const resp2 = await s.do(
      "PROPFIND",
      collectionPath("tok-del"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "sync-token"),
    );
    const tok2 = extractSyncToken(resp2.body);

    assertNotEquals(tok1, tok2, "sync-token must change after DELETE");
  });
});

// ─── §6 sync-collection REPORT ────────────────────────────────────────────────

Deno.test("RFC 6578 §6.1 initial sync-collection REPORT returns all resources", async () => {
  await withServer(async (s) => {
    await s.mkcol("init-sync");
    await s.putTodo("init-sync", "sync-todo1");
    await s.putTodo("init-sync", "sync-todo2");

    const resp = await s.do(
      "REPORT",
      collectionPath("init-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 207, "initial sync-collection REPORT must return 207");
    assertEquals(
      resp.body.includes("sync-todo1.ics"),
      true,
      "sync-todo1 must appear in initial sync",
    );
    assertEquals(
      resp.body.includes("sync-todo2.ics"),
      true,
      "sync-todo2 must appear in initial sync",
    );
  });
});

Deno.test("RFC 6578 §6.1 initial sync-collection REPORT returns new sync-token", async () => {
  await withServer(async (s) => {
    await s.mkcol("sync-token-resp");

    const resp = await s.do(
      "REPORT",
      collectionPath("sync-token-resp"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("sync-token"),
      true,
      "sync-collection response must contain a sync-token",
    );
  });
});

Deno.test("RFC 6578 §6.2 incremental sync returns only changed resources", async () => {
  await withServer(async (s) => {
    await s.mkcol("incr-sync");
    await s.putTodo("incr-sync", "pre-existing");

    const initResp = await s.do(
      "REPORT",
      collectionPath("incr-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(initResp.status, 207);

    const syncToken = extractSyncToken(initResp.body);
    assertNotEquals(syncToken, "", "initial sync must return a sync-token");

    await s.putTodo("incr-sync", "newly-added");

    const incrResp = await s.do(
      "REPORT",
      collectionPath("incr-sync"),
      xmlContentType(),
      syncCollectionReport(syncToken),
    );
    assertEquals(incrResp.status, 207);

    assertEquals(
      incrResp.body.includes("newly-added.ics"),
      true,
      "newly added object must appear in incremental sync",
    );
    assertEquals(
      incrResp.body.includes("pre-existing.ics"),
      false,
      "pre-existing object must NOT appear in incremental sync",
    );
  });
});

Deno.test("RFC 6578 §6.3 deleted resources reported as 404 in sync-collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-sync");
    await s.putTodo("del-sync", "to-be-deleted");

    const initResp = await s.do(
      "REPORT",
      collectionPath("del-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const syncToken = extractSyncToken(initResp.body);
    assertNotEquals(syncToken, "");

    await s.do("DELETE", objectPath("del-sync", "to-be-deleted"));

    const incrResp = await s.do(
      "REPORT",
      collectionPath("del-sync"),
      xmlContentType(),
      syncCollectionReport(syncToken),
    );
    assertEquals(incrResp.status, 207);
    assertEquals(
      incrResp.body.includes("to-be-deleted.ics"),
      true,
      "deleted resource must appear in sync-collection REPORT",
    );
    assertEquals(
      incrResp.body.includes("404"),
      true,
      "deleted resource must have 404 status in sync-collection REPORT",
    );
  });
});

// ─── §7 Error conditions ──────────────────────────────────────────────────────

Deno.test("RFC 6578 §7 invalid sync-token returns 403", async () => {
  await withServer(async (s) => {
    await s.mkcol("invalid-tok");

    const resp = await s.do(
      "REPORT",
      collectionPath("invalid-tok"),
      xmlContentType(),
      syncCollectionReport("urn:invalid-token-that-does-not-exist"),
    );
    assertEquals(resp.status, 403, "invalid sync-token must return 403 Forbidden");
  });
});

// ─── §3.2 Additional sync-collection REPORT requirements ──────────────────────

Deno.test("RFC 6578 §3.2 sync-collection listed in supported-report-set on calendar collection", async () => {
  await withServer(async (s) => {
    await s.mkcol("supported-report");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("supported-report"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsDAV, "supported-report-set"),
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("sync-collection"),
      true,
      "supported-report-set MUST list sync-collection",
    );
  });
});

Deno.test("RFC 6578 §3.2 sync-token returned by REPORT is a valid URI", async () => {
  await withServer(async (s) => {
    await s.mkcol("tok-uri");
    const resp = await s.do(
      "REPORT",
      collectionPath("tok-uri"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 207);
    const token = extractSyncToken(resp.body);
    assertNotEquals(token, "", "sync-token must not be empty");
    let valid = false;
    try {
      new URL(token);
      valid = true;
    } catch {
      valid = false;
    }
    assertEquals(valid, true, `sync-token '${token}' must be a valid URI`);
  });
});

Deno.test("RFC 6578 §3.2 sync-collection REPORT with Depth:1 returns 400", async () => {
  await withServer(async (s) => {
    await s.mkcol("depth1-bad");
    const resp = await s.do(
      "REPORT",
      collectionPath("depth1-bad"),
      withHeaders({ Depth: "1" }, xmlContentType()),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 400, "Depth:1 on sync-collection REPORT must return 400");
  });
});

Deno.test("RFC 6578 §3.2 changed-member response contains propstat and no top-level status", async () => {
  await withServer(async (s) => {
    await s.mkcol("changed-struct");

    const initResp = await s.do(
      "REPORT",
      collectionPath("changed-struct"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(initResp.body);
    assertNotEquals(token, "");

    // Add a new resource — it must appear as changed (propstat, no bare 404 status)
    await s.putTodo("changed-struct", "new-item-struct");

    const incrResp = await s.do(
      "REPORT",
      collectionPath("changed-struct"),
      xmlContentType(),
      syncCollectionReport(token),
    );
    assertEquals(incrResp.status, 207);
    // The only change is the new resource; it MUST have a propstat element
    assertEquals(
      incrResp.body.includes("propstat"),
      true,
      "changed/new member response MUST contain a propstat element",
    );
    // It MUST NOT have a bare 404 (which would indicate a removed-member response)
    assertEquals(
      incrResp.body.includes("404"),
      false,
      "changed member response MUST NOT contain a 404 status",
    );
  });
});

Deno.test("RFC 6578 §3.2 removed-member response has 404 status and no propstat", async () => {
  await withServer(async (s) => {
    await s.mkcol("removed-struct");
    await s.putTodo("removed-struct", "item-to-remove");

    const initResp = await s.do(
      "REPORT",
      collectionPath("removed-struct"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(initResp.body);
    assertNotEquals(token, "");

    await s.do("DELETE", objectPath("removed-struct", "item-to-remove"));

    const incrResp = await s.do(
      "REPORT",
      collectionPath("removed-struct"),
      xmlContentType(),
      syncCollectionReport(token),
    );
    assertEquals(incrResp.status, 207);
    // Removed member MUST have a 404 status element directly in the response
    assertEquals(
      incrResp.body.includes("404"),
      true,
      "removed member response MUST contain 404 status",
    );
    // Removed member MUST NOT have a propstat element
    assertEquals(
      incrResp.body.includes("propstat"),
      false,
      "removed member response MUST NOT contain a propstat element",
    );
  });
});

Deno.test("RFC 6578 §3.2 each member URL appears at most once in sync response", async () => {
  await withServer(async (s) => {
    await s.mkcol("url-unique");
    await s.putTodo("url-unique", "unique-item1");
    await s.putTodo("url-unique", "unique-item2");
    await s.putTodo("url-unique", "unique-item3");

    const resp = await s.do(
      "REPORT",
      collectionPath("url-unique"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 207);
    const body = resp.body;
    const countOccurrences = (str: string, sub: string): number =>
      str.split(sub).length - 1;
    for (const uid of ["unique-item1", "unique-item2", "unique-item3"]) {
      const occurrences = countOccurrences(body, `${uid}.ics`);
      assertEquals(
        occurrences <= 1,
        true,
        `'${uid}.ics' MUST appear at most once in sync response, found ${occurrences}`,
      );
    }
  });
});

Deno.test("RFC 6578 §3.2 invalid sync-token returns 403 with DAV:error containing DAV:valid-sync-token", async () => {
  await withServer(async (s) => {
    await s.mkcol("invalid-tok-err");

    const resp = await s.do(
      "REPORT",
      collectionPath("invalid-tok-err"),
      xmlContentType(),
      syncCollectionReport("urn:invalid-token-does-not-exist"),
    );
    assertEquals(resp.status, 403, "invalid sync-token must return 403");
    assertEquals(
      resp.body.includes("valid-sync-token"),
      true,
      "403 response MUST include DAV:error containing DAV:valid-sync-token",
    );
  });
});

// ─── §3.3 Depth Behavior ──────────────────────────────────────────────────────

Deno.test("RFC 6578 §3.3 sync-collection with sync-level infinite returns all descendants", async () => {
  await withServer(async (s) => {
    await s.mkcol("sync-infinite");
    await s.putTodo("sync-infinite", "inf-item1");
    await s.putTodo("sync-infinite", "inf-item2");

    const infiniteBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:sync-collection xmlns:D="DAV:">' +
      "<D:sync-token></D:sync-token>" +
      "<D:sync-level>infinite</D:sync-level>" +
      "<D:prop><D:getetag/></D:prop>" +
      "</D:sync-collection>";

    const resp = await s.do(
      "REPORT",
      collectionPath("sync-infinite"),
      xmlContentType(),
      infiniteBody,
    );
    // Server MUST return 207 with all descendants reported
    assertEquals(resp.status, 207, "sync-level infinite REPORT must return 207");
    assertEquals(
      resp.body.includes("inf-item1.ics"),
      true,
      "inf-item1 must appear in infinite sync",
    );
    assertEquals(
      resp.body.includes("inf-item2.ics"),
      true,
      "inf-item2 must appear in infinite sync",
    );
    assertEquals(
      resp.body.includes("sync-token"),
      true,
      "infinite sync response must include sync-token",
    );
  });
});

Deno.test("RFC 6578 §3.3 sync-collection REPORT with HTTP Depth:1 header returns 400", async () => {
  await withServer(async (s) => {
    await s.mkcol("depth-hdr-bad");
    // The HTTP Depth header must be '0'; any other value MUST return 400
    const resp = await s.do(
      "REPORT",
      collectionPath("depth-hdr-bad"),
      withHeaders({ Depth: "1" }, xmlContentType()),
      syncCollectionReport(""),
    );
    assertEquals(
      resp.status,
      400,
      "HTTP Depth:1 header with sync-collection REPORT must return 400",
    );
  });
});

// ─── §3.4 Initial Synchronization ─────────────────────────────────────────────

Deno.test("RFC 6578 §3.4 initial sync with empty token never reports removed resources", async () => {
  await withServer(async (s) => {
    await s.mkcol("init-no-removed");
    await s.putTodo("init-no-removed", "existing-item");

    const resp = await s.do(
      "REPORT",
      collectionPath("init-no-removed"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(resp.status, 207);
    // Initial sync MUST NOT return any removed member URLs (no 404 response elements)
    assertEquals(
      resp.body.includes("404"),
      false,
      "initial sync MUST NOT report any removed resources",
    );
  });
});

Deno.test("RFC 6578 §3.4 initial sync reports sub-collection members", async () => {
  await withServer(async (s) => {
    // Create a calendar sub-collection; initial sync on the calendar home must include it
    await s.mkcol("sub-coll-member");

    const resp = await s.do(
      "REPORT",
      calendarHomePath,
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(
      resp.status,
      207,
      "sync-collection REPORT on calendar home must return 207",
    );
    // The calendar collection (a collection-type member) must appear in the initial sync
    assertEquals(
      resp.body.includes("sub-coll-member"),
      true,
      "initial sync MUST report sub-collection members",
    );
  });
});

// ─── §3.5.1 Changed Member ────────────────────────────────────────────────────

Deno.test("RFC 6578 §3.5.1 updated resource (changed ETag) appears as changed in incremental sync", async () => {
  await withServer(async (s) => {
    await s.mkcol("update-sync");
    await s.putTodo("update-sync", "update-item");

    const initResp = await s.do(
      "REPORT",
      collectionPath("update-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(initResp.body);
    assertNotEquals(token, "");

    // PUT again to the same URL to update the resource (changes the ETag)
    const updatedBody =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:update-item\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Updated Summary\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";
    const putResp = await s.do(
      "PUT",
      objectPath("update-sync", "update-item"),
      { "Content-Type": "text/calendar; charset=utf-8" },
      updatedBody,
    );
    assertEquals(
      putResp.status === 200 || putResp.status === 201 || putResp.status === 204,
      true,
      `update PUT must succeed, got ${putResp.status}`,
    );

    const incrResp = await s.do(
      "REPORT",
      collectionPath("update-sync"),
      xmlContentType(),
      syncCollectionReport(token),
    );
    assertEquals(incrResp.status, 207);
    // Updated resource MUST appear as changed (with propstat, not as removed)
    assertEquals(
      incrResp.body.includes("update-item.ics"),
      true,
      "updated resource must appear in incremental sync",
    );
    assertEquals(
      incrResp.body.includes("propstat"),
      true,
      "updated resource MUST have propstat (reported as changed, not removed)",
    );
    assertEquals(
      incrResp.body.includes("404"),
      false,
      "updated resource MUST NOT have 404 status in sync response",
    );
  });
});

Deno.test("RFC 6578 §3.5.1 resource deleted and re-created with same URI is reported as changed not removed", async () => {
  await withServer(async (s) => {
    await s.mkcol("recreate-sync");
    await s.putTodo("recreate-sync", "recreate-item");

    const initResp = await s.do(
      "REPORT",
      collectionPath("recreate-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(initResp.body);
    assertNotEquals(token, "");

    // Delete then immediately re-create at the same URI
    await s.do("DELETE", objectPath("recreate-sync", "recreate-item"));
    await s.putTodo("recreate-sync", "recreate-item");

    const incrResp = await s.do(
      "REPORT",
      collectionPath("recreate-sync"),
      xmlContentType(),
      syncCollectionReport(token),
    );
    assertEquals(incrResp.status, 207);
    // Re-created resource MUST be reported as changed (propstat), NOT as removed (no 404)
    assertEquals(
      incrResp.body.includes("recreate-item.ics"),
      true,
      "re-created resource must appear in sync",
    );
    assertEquals(
      incrResp.body.includes("propstat"),
      true,
      "re-created resource MUST be reported as changed (propstat required)",
    );
    assertEquals(
      incrResp.body.includes("404"),
      false,
      "re-created resource MUST NOT be reported as removed (no 404 allowed)",
    );
  });
});

// ─── §3.5.2 Removed Member ────────────────────────────────────────────────────

Deno.test("RFC 6578 §3.5.2 resource added and removed between syncs reported as removed only", async () => {
  await withServer(async (s) => {
    await s.mkcol("add-del-sync");

    // Establish a baseline sync token
    const initResp = await s.do(
      "REPORT",
      collectionPath("add-del-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(initResp.body);
    assertNotEquals(token, "");

    // Add a resource and then remove it — both changes occur after the last sync
    await s.putTodo("add-del-sync", "ephemeral-item");
    await s.do("DELETE", objectPath("add-del-sync", "ephemeral-item"));

    const incrResp = await s.do(
      "REPORT",
      collectionPath("add-del-sync"),
      xmlContentType(),
      syncCollectionReport(token),
    );
    assertEquals(incrResp.status, 207);
    // The resource that was added-then-removed MUST be reported as removed (404)
    assertEquals(
      incrResp.body.includes("ephemeral-item.ics"),
      true,
      "added-then-removed resource must appear in sync",
    );
    assertEquals(
      incrResp.body.includes("404"),
      true,
      "added-then-removed resource MUST be reported as removed (404)",
    );
    // It MUST NOT be reported as changed — since the only change is this removal,
    // no propstat elements should appear in the incremental sync response
    assertEquals(
      incrResp.body.includes("propstat"),
      false,
      "added-then-removed resource MUST NOT be reported as changed (no propstat expected)",
    );
  });
});

// ─── §3.6 Truncation of Results ───────────────────────────────────────────────

Deno.test("RFC 6578 §3.6 truncated sync response returns 207 with 507 response for collection URI and partial sync-token", async () => {
  await withServer(async (s) => {
    await s.mkcol("trunc-sync");
    for (let i = 1; i <= 5; i++) {
      await s.putTodo("trunc-sync", `trunc-item${i}`);
    }

    const resp = await s.do(
      "REPORT",
      collectionPath("trunc-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    // Response MUST be 207 regardless of whether truncation occurred
    assertEquals(resp.status, 207, "sync-collection REPORT must always return 207");
    // A sync-token MUST always be present in the response
    assertEquals(
      resp.body.includes("sync-token"),
      true,
      "sync-collection REPORT must always return a sync-token",
    );
    // If the server chose to truncate, the 507 sub-response MUST have the correct structure
    if (resp.body.includes("507")) {
      assertEquals(
        resp.body.includes("number-of-matches-within-limits"),
        true,
        "truncated response MUST include DAV:number-of-matches-within-limits in 507 sub-response",
      );
      const partialToken = extractSyncToken(resp.body);
      assertNotEquals(
        partialToken,
        "",
        "truncated response MUST include a partial sync-token",
      );
    }
  });
});

// ─── §3.7 Limiting Results ────────────────────────────────────────────────────

Deno.test("RFC 6578 §3.7 sync-collection with DAV:limit the server cannot satisfy returns 507 with postcondition error", async () => {
  await withServer(async (s) => {
    await s.mkcol("limit-fail");
    // Add enough resources so that a limit of 1 requires truncation
    for (let i = 1; i <= 5; i++) {
      await s.putTodo("limit-fail", `limit-fail-item${i}`);
    }

    const syncBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:sync-collection xmlns:D="DAV:">' +
      "<D:sync-token></D:sync-token>" +
      "<D:sync-level>1</D:sync-level>" +
      "<D:limit><D:nresults>1</D:nresults></D:limit>" +
      "<D:prop><D:getetag/></D:prop>" +
      "</D:sync-collection>";

    const resp = await s.do(
      "REPORT",
      collectionPath("limit-fail"),
      xmlContentType(),
      syncBody,
    );
    // If the server cannot satisfy the limit: MUST return 507 with postcondition error.
    // If it can satisfy via truncation: MUST return 207 with 507 sub-response.
    assertEquals(
      resp.status === 507 || resp.status === 207,
      true,
      `sync-collection with DAV:limit must return 507 or 207, got ${resp.status}`,
    );
    if (resp.status === 507) {
      assertEquals(
        resp.body.includes("number-of-matches-within-limits"),
        true,
        "507 MUST include DAV:number-of-matches-within-limits postcondition error",
      );
    }
  });
});

Deno.test("RFC 6578 §3.7 sync-collection with satisfiable DAV:limit returns truncated 207 with 507 collection-level response", async () => {
  await withServer(async (s) => {
    await s.mkcol("limit-sat");
    await s.putTodo("limit-sat", "limit-sat-item1");
    await s.putTodo("limit-sat", "limit-sat-item2");
    await s.putTodo("limit-sat", "limit-sat-item3");

    const syncBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:sync-collection xmlns:D="DAV:">' +
      "<D:sync-token></D:sync-token>" +
      "<D:sync-level>1</D:sync-level>" +
      "<D:limit><D:nresults>1</D:nresults></D:limit>" +
      "<D:prop><D:getetag/></D:prop>" +
      "</D:sync-collection>";

    const resp = await s.do(
      "REPORT",
      collectionPath("limit-sat"),
      xmlContentType(),
      syncBody,
    );
    // When limit is satisfiable via truncation: MUST be 207 with 507 sub-response + sync-token.
    // When limit cannot be satisfied at all: MUST be 507 with postcondition error.
    assertEquals(
      resp.status === 207 || resp.status === 507,
      true,
      `sync-collection with satisfiable limit must return 207 or 507, got ${resp.status}`,
    );
    if (resp.status === 207 && resp.body.includes("507")) {
      assertEquals(
        resp.body.includes("number-of-matches-within-limits"),
        true,
        "truncated 207 MUST include DAV:number-of-matches-within-limits in 507 sub-response",
      );
      const partialToken = extractSyncToken(resp.body);
      assertNotEquals(
        partialToken,
        "",
        "truncated response MUST include a partial sync-token",
      );
    }
  });
});

// ─── §4 DAV:sync-token Property ───────────────────────────────────────────────

Deno.test("RFC 6578 §4 sync-token not returned in PROPFIND allprop response", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-sync");
    const allpropBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-sync"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      allpropBody,
    );
    assertEquals(resp.status, 207);
    // DAV:sync-token SHOULD NOT be returned in a PROPFIND allprop response (RFC 6578 §4)
    assertEquals(
      resp.body.includes("sync-token"),
      false,
      "DAV:sync-token SHOULD NOT be returned in PROPFIND allprop response",
    );
  });
});

Deno.test("RFC 6578 §4 PROPPATCH of sync-token is rejected as protected property", async () => {
  await withServer(async (s) => {
    await s.mkcol("proppatch-sync");
    const proppatchBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propertyupdate xmlns:D="DAV:">' +
      "<D:set><D:prop>" +
      "<D:sync-token>urn:fakesynctoken:0</D:sync-token>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("proppatch-sync"),
      xmlContentType(),
      proppatchBody,
    );
    // MUST be rejected: direct 403 or 207 multi-status with 403/409 on the property
    assertEquals(
      resp.status === 403 || resp.status === 207,
      true,
      `PROPPATCH of protected sync-token must be rejected, got ${resp.status}`,
    );
    if (resp.status === 207) {
      const hasFailure = resp.body.includes("403") || resp.body.includes("409");
      assertEquals(
        hasFailure,
        true,
        "PROPPATCH of protected sync-token MUST include 403 or 409 in 207 multi-status response",
      );
    }
  });
});

// ─── §5 DAV:sync-token Use with If Header ─────────────────────────────────────

Deno.test("RFC 6578 §5 PUT with If header containing current sync-token succeeds", async () => {
  await withServer(async (s) => {
    await s.mkcol("if-token-ok");

    const syncResp = await s.do(
      "REPORT",
      collectionPath("if-token-ok"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const token = extractSyncToken(syncResp.body);
    assertNotEquals(token, "", "initial sync must return a token");

    const colPath = collectionPath("if-token-ok");
    const newObjPath = objectPath("if-token-ok", "if-new-item");
    const calBody =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:if-new-item\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:If Token Test Todo\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";

    // If header: state token refers to the collection resource (tagged-list form per RFC 4918 §10.4)
    const ifHeader = `<${colPath}> (<${token}>)`;
    const putResp = await s.do(
      "PUT",
      newObjPath,
      withHeaders({ "Content-Type": "text/calendar; charset=utf-8", If: ifHeader }),
      calBody,
    );
    // MUST succeed: 201 Created (or 200/204 if the server considers it an update)
    assertEquals(
      putResp.status === 201 || putResp.status === 200 || putResp.status === 204,
      true,
      `PUT with matching sync-token in If header must succeed, got ${putResp.status}`,
    );
  });
});

Deno.test("RFC 6578 §5 PUT with If header containing stale sync-token returns 412 Precondition Failed", async () => {
  await withServer(async (s) => {
    await s.mkcol("if-token-stale");

    const syncResp = await s.do(
      "REPORT",
      collectionPath("if-token-stale"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    const staleToken = extractSyncToken(syncResp.body);
    assertNotEquals(staleToken, "", "initial sync must return a token");

    // Modify the collection to invalidate the captured token
    await s.putTodo("if-token-stale", "modifying-item");

    const colPath = collectionPath("if-token-stale");
    const newObjPath = objectPath("if-token-stale", "if-stale-new-item");
    const calBody =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VTODO\r\n" +
      "UID:if-stale-new-item\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "SUMMARY:Stale Token Test\r\n" +
      "END:VTODO\r\n" +
      "END:VCALENDAR\r\n";

    // Use the now-stale token in the If header — the collection has changed since
    const ifHeader = `<${colPath}> (<${staleToken}>)`;
    const putResp = await s.do(
      "PUT",
      newObjPath,
      withHeaders({ "Content-Type": "text/calendar; charset=utf-8", If: ifHeader }),
      calBody,
    );
    assertEquals(
      putResp.status,
      412,
      "PUT with stale sync-token in If header MUST return 412 Precondition Failed",
    );
  });
});

// ─── §3 VEVENT collection parity ──────────────────────────────────────────────

Deno.test("RFC 6578 §3 sync-collection REPORT works correctly for VEVENT collections (initial, incremental, delete)", async () => {
  await withServer(async (s) => {
    await s.mkcol("vevent-sync");
    await s.putEvent("vevent-sync", "vevent-pre");

    // Initial sync: must return all current members
    const initResp = await s.do(
      "REPORT",
      collectionPath("vevent-sync"),
      xmlContentType(),
      syncCollectionReport(""),
    );
    assertEquals(
      initResp.status,
      207,
      "initial sync-collection REPORT on VEVENT collection must return 207",
    );
    assertEquals(
      initResp.body.includes("vevent-pre.ics"),
      true,
      "initial sync must include pre-existing VEVENT",
    );
    const initToken = extractSyncToken(initResp.body);
    assertNotEquals(initToken, "", "initial sync must return a sync-token");

    // Incremental sync: only the newly added VEVENT must appear
    await s.putEvent("vevent-sync", "vevent-new");

    const incrResp = await s.do(
      "REPORT",
      collectionPath("vevent-sync"),
      xmlContentType(),
      syncCollectionReport(initToken),
    );
    assertEquals(incrResp.status, 207, "incremental sync-collection REPORT must return 207");
    assertEquals(
      incrResp.body.includes("vevent-new.ics"),
      true,
      "newly added VEVENT must appear in incremental sync",
    );
    assertEquals(
      incrResp.body.includes("vevent-pre.ics"),
      false,
      "pre-existing VEVENT must NOT appear in incremental sync",
    );
    const incrToken = extractSyncToken(incrResp.body);
    assertNotEquals(incrToken, "", "incremental sync must return a new sync-token");

    // Delete sync: deleted VEVENT must appear with 404
    await s.do("DELETE", objectPath("vevent-sync", "vevent-new"));

    const delResp = await s.do(
      "REPORT",
      collectionPath("vevent-sync"),
      xmlContentType(),
      syncCollectionReport(incrToken),
    );
    assertEquals(delResp.status, 207, "delete sync-collection REPORT must return 207");
    assertEquals(
      delResp.body.includes("vevent-new.ics"),
      true,
      "deleted VEVENT must appear in sync",
    );
    assertEquals(
      delResp.body.includes("404"),
      true,
      "deleted VEVENT must have 404 status in sync response",
    );
  });
});
