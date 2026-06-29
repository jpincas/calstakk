// RFC 4918 — HTTP Extensions for Web Distributed Authoring and Versioning (WebDAV)
// Spec: specs/rfc4918.txt
//
// Coverage:
//   §9.1  PROPFIND
//   §9.2  PROPPATCH
//   §9.3  MKCOL
//   §9.4  GET/HEAD
//   §9.6  DELETE
//   §9.7  PUT + ETags
//   §9.8  COPY
//   §9.9  MOVE
//   §10.4 Conditional request headers (If-Match / If-None-Match)
//   §14   XML element definitions (multistatus, propstat, prop, etc.)
//   §15   Live properties (resourcetype, getetag, getcontentlength, etc.)

import { assertEquals } from "@std/assert";
import {
  calContentType,
  collectionPath,
  depthHeader,
  nsDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindAllprop,
  propfindPropname,
  propfindProps,
  vtodo,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §9.1 PROPFIND ────────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.1 PROPFIND returns 207 Multi-Status", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND Depth:0 returns only the target resource", async () => {
  await withServer(async (s) => {
    await s.mkcol("depth-test");
    await s.putTodo("depth-test", "todo-1");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("depth-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.len(), 1);
    assertEquals(ms.response(collectionPath("depth-test")) !== undefined, true);
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND Depth:1 returns target and immediate children", async () => {
  await withServer(async (s) => {
    await s.mkcol("depth1-col");
    await s.putTodo("depth1-col", "todo-a");
    await s.putTodo("depth1-col", "todo-b");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("depth1-col"),
      withHeaders(depthHeader("1"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.len(), 3); // collection + 2 objects
  });
});

Deno.test("RFC 4918 §9.1 allprop includes resourcetype", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true, `expected response for ${principalPath}`);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true, "expected resourcetype property");
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4918 §9.1 propname returns property names", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindPropname(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true, "resourcetype must be listed");
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND specific prop not found returns 404", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "nonexistent-property-xyz"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true);
    const p = r!.prop("nonexistent-property-xyz");
    assertEquals(p !== undefined, true, "unknown property must appear in propstat");
    assertEquals(p!.status, 404);
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND on non-existent resource returns 404", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      "/calstakk/calendars/no-such-collection",
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 404);
  });
});

Deno.test("RFC 4918 §14.20 collection resourcetype contains <DAV:collection/>", async () => {
  await withServer(async (s) => {
    await s.mkcol("rt-test");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("rt-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "resourcetype"),
    );
    assertEquals(resp.status, 207);

    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("rt-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
    assertEquals(p!.hasChild("collection"), true, "resourcetype should contain <DAV:collection/>");
  });
});

Deno.test("RFC 4918 §15.1 creationdate appears in allprop response", async () => {
  await withServer(async (s) => {
    await s.mkcol("cd-test");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("cd-test"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("cd-test"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("creationdate");
    assertEquals(p !== undefined, true, "creationdate must appear in PROPFIND allprop response");
  });
});

Deno.test("RFC 4918 §15.4 getcontentlength on calendar object", async () => {
  await withServer(async (s) => {
    await s.mkcol("cl-test");
    await s.putTodo("cl-test", "cl-todo");

    const resp = await s.do(
      "PROPFIND",
      objectPath("cl-test", "cl-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getcontentlength"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(objectPath("cl-test", "cl-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getcontentlength");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4918 §15.6 getetag present on calendar object", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-test");
    await s.putTodo("etag-test", "etag-todo");

    const resp = await s.do(
      "PROPFIND",
      objectPath("etag-test", "etag-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getetag"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(objectPath("etag-test", "etag-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getetag");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
    assertEquals(p!.text().length > 0, true, "getetag must have a non-empty value");
  });
});

// ─── §9.2 PROPPATCH ───────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.2 PROPPATCH returns 207 Multi-Status", async () => {
  await withServer(async (s) => {
    await s.mkcol("pp-test");

    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:">' +
      "<D:set><D:prop><D:displayname>My Calendar</D:displayname></D:prop></D:set>" +
      "</D:propertyupdate>";
    const resp = await s.do("PROPPATCH", collectionPath("pp-test"), xmlContentType(), body);
    assertEquals(resp.status, 207);
  });
});

Deno.test("RFC 4918 §9.2 PROPPATCH on non-existent resource returns 404", async () => {
  await withServer(async (s) => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:">' +
      "<D:set><D:prop><D:displayname>Ghost</D:displayname></D:prop></D:set>" +
      "</D:propertyupdate>";
    const resp = await s.do("PROPPATCH", "/calstakk/calendars/ghost", xmlContentType(), body);
    assertEquals(resp.status, 404);
  });
});

// ─── §9.3 MKCOL ───────────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.3 MKCOL on new path returns 201 Created", async () => {
  await withServer(async (s) => {
    const resp = await s.do("MKCOL", collectionPath("new-col"));
    assertEquals(resp.status, 201);
  });
});

Deno.test("RFC 4918 §9.3.1 MKCOL on existing path returns 405", async () => {
  await withServer(async (s) => {
    await s.mkcol("dup-col");
    const resp = await s.do("MKCOL", collectionPath("dup-col"));
    assertEquals(resp.status, 405);
  });
});

Deno.test("RFC 4918 §9.3.1 MKCOL with missing parent returns 409", async () => {
  await withServer(async (s) => {
    const resp = await s.do("MKCOL", collectionPath("missing/child"));
    assertEquals(resp.status, 409);
  });
});

// ─── §9.6 DELETE ──────────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.6 DELETE of existing object returns 204", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-test");
    await s.putTodo("del-test", "to-delete");
    const resp = await s.do("DELETE", objectPath("del-test", "to-delete"));
    assertEquals(resp.status, 204);
  });
});

Deno.test("RFC 4918 §9.6 deleted resource returns 404 on GET", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-test2");
    await s.putTodo("del-test2", "gone");
    await s.do("DELETE", objectPath("del-test2", "gone"));
    const resp = await s.do("GET", objectPath("del-test2", "gone"));
    assertEquals(resp.status, 404);
  });
});

Deno.test("RFC 4918 §9.6 DELETE of collection removes it and all children", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-col");
    await s.putTodo("del-col", "child");
    const delResp = await s.do("DELETE", collectionPath("del-col"));
    assertEquals(delResp.status, 204);

    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("del-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(pfResp.status, 404);
  });
});

Deno.test("RFC 4918 §9.6 DELETE of non-existent resource returns 404", async () => {
  await withServer(async (s) => {
    const resp = await s.do("DELETE", objectPath("no-col", "no-obj"));
    assertEquals(resp.status, 404);
  });
});

// ─── §9.7 PUT + ETags ─────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.7 PUT of new resource returns 201 Created", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-test");
    const resp = await s.do(
      "PUT",
      objectPath("put-test", "new-todo"),
      calContentType(),
      vtodo("new-todo"),
    );
    assertEquals(resp.status, 201);
  });
});

Deno.test("RFC 4918 §9.7 PUT update of existing resource returns 204", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-upd");
    await s.putTodo("put-upd", "upd-todo");
    const resp = await s.do(
      "PUT",
      objectPath("put-upd", "upd-todo"),
      calContentType(),
      vtodo("upd-todo", "SUMMARY:Updated Todo"),
    );
    assertEquals(resp.status, 204);
  });
});

Deno.test("RFC 4918 §15.6 PUT returns ETag header on 201 Created", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-put");
    const resp = await s.do(
      "PUT",
      objectPath("etag-put", "e1"),
      calContentType(),
      vtodo("e1"),
    );
    assertEquals(resp.status, 201);
    assertEquals(resp.headers.get("ETag") !== null, true, "PUT must return ETag on 201");
  });
});

Deno.test("RFC 4918 §15.6 ETag from PUT and PROPFIND getetag must match", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-cons");
    const putResp = await s.do(
      "PUT",
      objectPath("etag-cons", "c1"),
      calContentType(),
      vtodo("c1"),
    );
    const putETag = putResp.headers.get("ETag")!;
    assertEquals(putETag !== null, true);

    const pfResp = await s.do(
      "PROPFIND",
      objectPath("etag-cons", "c1"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getetag"),
    );
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("etag-cons", "c1"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getetag");
    assertEquals(p!.text(), putETag, "ETag from PROPFIND must match ETag from PUT");
  });
});

Deno.test("RFC 4918 §15.6 ETag changes after content update", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-chg");
    const etag1 = await s.putTodo("etag-chg", "chg-todo");
    const resp2 = await s.do(
      "PUT",
      objectPath("etag-chg", "chg-todo"),
      calContentType(),
      vtodo("chg-todo", "SUMMARY:Changed"),
    );
    assertEquals(resp2.status, 204);
    const etag2 = resp2.headers.get("ETag");
    assertEquals(etag2 !== null, true);
    assertEquals(etag1 !== etag2, true, "ETag must change after update");
  });
});

// ─── §10.4 Conditional requests ───────────────────────────────────────────────

Deno.test("RFC 4918 §10.4 If-None-Match: * fails with 412 if resource exists", async () => {
  await withServer(async (s) => {
    await s.mkcol("inm-test");
    await s.putTodo("inm-test", "inm-todo");

    const resp = await s.do(
      "PUT",
      objectPath("inm-test", "inm-todo"),
      withHeaders(calContentType(), { "If-None-Match": "*" }),
      vtodo("inm-todo"),
    );
    assertEquals(resp.status, 412);
  });
});

Deno.test("RFC 4918 §10.4 If-Match with stale ETag fails with 412", async () => {
  await withServer(async (s) => {
    await s.mkcol("im-test");
    await s.putTodo("im-test", "im-todo");
    // Update to advance ETag
    await s.do(
      "PUT",
      objectPath("im-test", "im-todo"),
      calContentType(),
      vtodo("im-todo", "SUMMARY:v2"),
    );

    const resp = await s.do(
      "PUT",
      objectPath("im-test", "im-todo"),
      withHeaders(calContentType(), { "If-Match": '"stale-etag-xyz"' }),
      vtodo("im-todo", "SUMMARY:v3"),
    );
    assertEquals(resp.status, 412);
  });
});

// ─── §9.8 COPY ────────────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.8 COPY returns 201, 403, or 501", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-src");
    await s.mkcol("copy-dst");
    await s.putTodo("copy-src", "cp-todo");

    const resp = await s.do(
      "COPY",
      objectPath("copy-src", "cp-todo"),
      { Destination: s.base + objectPath("copy-dst", "cp-todo") },
    );
    assertEquals(
      [201, 403, 501].includes(resp.status),
      true,
      `COPY must return 201, 403, or 501; got ${resp.status}`,
    );
  });
});

// ─── §9.9 MOVE ────────────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.9 MOVE returns 201, 204, 403, or 501", async () => {
  await withServer(async (s) => {
    await s.mkcol("mv-src");
    await s.mkcol("mv-dst");
    await s.putTodo("mv-src", "mv-todo");

    const resp = await s.do(
      "MOVE",
      objectPath("mv-src", "mv-todo"),
      { Destination: s.base + objectPath("mv-dst", "mv-todo") },
    );
    assertEquals(
      [201, 204, 403, 501].includes(resp.status),
      true,
      `MOVE must return 201, 204, 403, or 501; got ${resp.status}`,
    );
  });
});

// ─── §9.4 GET / HEAD ──────────────────────────────────────────────────────────

Deno.test("RFC 4918 §9.4 GET on calendar object returns 200 with iCal body", async () => {
  await withServer(async (s) => {
    await s.mkcol("get-test");
    await s.putTodo("get-test", "get-todo");

    const resp = await s.do("GET", objectPath("get-test", "get-todo"));
    assertEquals(resp.status, 200);
    assertEquals(resp.body.includes("BEGIN:VCALENDAR"), true);
    assertEquals(resp.body.includes("BEGIN:VTODO"), true);
  });
});

Deno.test("RFC 4918 §9.4 GET returns ETag header", async () => {
  await withServer(async (s) => {
    await s.mkcol("get-etag");
    await s.putTodo("get-etag", "ge-todo");
    const resp = await s.do("GET", objectPath("get-etag", "ge-todo"));
    assertEquals(resp.headers.get("ETag") !== null, true);
  });
});

Deno.test("RFC 4918 §9.4 HEAD returns same headers as GET but no body", async () => {
  await withServer(async (s) => {
    await s.mkcol("head-test");
    await s.putTodo("head-test", "h-todo");

    const getResp = await s.do("GET", objectPath("head-test", "h-todo"));
    const headResp = await s.do("HEAD", objectPath("head-test", "h-todo"));

    assertEquals(getResp.status, headResp.status);
    assertEquals(getResp.headers.get("ETag"), headResp.headers.get("ETag"));
    assertEquals(getResp.headers.get("Content-Type"), headResp.headers.get("Content-Type"));
    assertEquals(headResp.body, "", "HEAD response must have no body");
  });
});

// ─── OPTIONS ──────────────────────────────────────────────────────────────────

Deno.test("RFC 4918 OPTIONS returns DAV: 1 compliance header", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", principalPath);
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(dav.includes("1"), true, "DAV header must include compliance class 1");
  });
});
