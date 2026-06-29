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
