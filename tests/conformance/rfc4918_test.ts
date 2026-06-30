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

// ─── §8.2 Malformed XML ───────────────────────────────────────────────────────

Deno.test("RFC 4918 §8.2 malformed XML request body returns 400", async () => {
  await withServer(async (s) => {
    // Send a PROPFIND with XML that is not well-formed (unclosed element).
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop>',
    );
    assertEquals(resp.status, 400, "server MUST reject malformed XML with 400 Bad Request");
  });
});

// ─── §8.3 Multistatus href format consistency ─────────────────────────────────

Deno.test("RFC 4918 §8.3 multistatus hrefs use consistent format within a single response", async () => {
  await withServer(async (s) => {
    await s.mkcol("hreffmt-col");
    await s.putTodo("hreffmt-col", "hreffmt-todo");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("hreffmt-col"),
      withHeaders(depthHeader("1"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);

    // Extract all href text values from the raw XML body.
    const hrefRe = /<[a-zA-Z_][a-zA-Z0-9_.-]*:href[^>]*>([^<]+)<\/[a-zA-Z_][a-zA-Z0-9_.-]*:href>/g;
    const allHrefs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(resp.body)) !== null) {
      allHrefs.push(m[1].trim());
    }
    assertEquals(allHrefs.length > 0, true, "multistatus must contain at least one href");

    const allAbsolute = allHrefs.every((h) => h.startsWith("http://") || h.startsWith("https://"));
    const allRelative = allHrefs.every((h) => h.startsWith("/"));
    assertEquals(
      allAbsolute || allRelative,
      true,
      `all hrefs MUST use the same format (all absolute or all path-relative); got: ${allHrefs.join(", ")}`,
    );
  });
});

// ─── §8.6 ETag stability on re-PUT ───────────────────────────────────────────

Deno.test("RFC 4918 §8.6 ETag is unchanged when resource body is re-PUT with identical content", async () => {
  await withServer(async (s) => {
    await s.mkcol("etag-stable");
    const body = vtodo("etag-stable-obj");
    const put1 = await s.do("PUT", objectPath("etag-stable", "etag-stable-obj"), calContentType(), body);
    assertEquals(put1.status, 201);
    const etag1 = put1.headers.get("ETag");
    assertEquals(etag1 !== null, true, "PUT must return ETag");

    const put2 = await s.do("PUT", objectPath("etag-stable", "etag-stable-obj"), calContentType(), body);
    assertEquals([200, 204].includes(put2.status), true, "re-PUT of identical body must succeed");
    const etag2 = put2.headers.get("ETag");
    // RFC 4918 §8.6: server SHOULD NOT change the ETag if body and location are unchanged.
    if (etag2 !== null) {
      assertEquals(etag1, etag2, "ETag SHOULD remain equal when body is re-PUT without change");
    }
  });
});

// ─── §9.1 PROPFIND — additional requirements ─────────────────────────────────

Deno.test("RFC 4918 §9.1 PROPFIND with empty body treated as allprop", async () => {
  await withServer(async (s) => {
    // An empty request body MUST be treated as an allprop request.
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      depthHeader("0"),
      // deliberately no body
    );
    assertEquals(resp.status, 207, "empty-body PROPFIND must return 207");
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r !== undefined, true, "response for target resource must be present");
    // resourcetype is a mandatory live property; it must appear in an implicit allprop.
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true, "resourcetype must appear when empty body treated as allprop");
    assertEquals(p!.status, 200);
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND without Depth header defaults to infinity behavior", async () => {
  await withServer(async (s) => {
    await s.mkcol("nodepth-col");
    await s.putTodo("nodepth-col", "nodepth-todo");

    // No Depth header — RFC says servers SHOULD treat as Depth: infinity.
    const resp = await s.do(
      "PROPFIND",
      collectionPath("nodepth-col"),
      xmlContentType(),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207, "PROPFIND without Depth must return 207");
    const ms = parseMultistatus(resp.body);
    // With infinity semantics, both the collection and its child must appear.
    assertEquals(
      ms.len() >= 2,
      true,
      "PROPFIND without Depth header should include at least the collection and its child",
    );
  });
});

Deno.test("RFC 4918 §9.1 PROPFIND response Content-Type is application/xml or text/xml", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ct = resp.headers.get("Content-Type") ?? "";
    assertEquals(
      ct.includes("application/xml") || ct.includes("text/xml"),
      true,
      `PROPFIND Content-Type must be application/xml or text/xml; got: ${ct}`,
    );
  });
});

Deno.test("RFC 4918 §9.1.1 PROPFIND Depth:infinity rejection uses propfind-finite-depth precondition", async () => {
  await withServer(async (s) => {
    await s.mkcol("inf-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("inf-col"),
      withHeaders(depthHeader("infinity"), xmlContentType()),
      propfindAllprop(),
    );
    // Server MAY reject Depth:infinity; if it does, it SHOULD use propfind-finite-depth.
    if (resp.status !== 207) {
      // Rejected — body must contain the precondition element.
      assertEquals(
        resp.body.includes("propfind-finite-depth"),
        true,
        "rejection of Depth:infinity PROPFIND SHOULD use propfind-finite-depth precondition in error body",
      );
    }
    // If 207, server chose to accept it — that is also conformant.
  });
});

// ─── §13 Multi-Status structural requirements ─────────────────────────────────

Deno.test("RFC 4918 §13 Multi-Status response Content-Type is application/xml", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      principalPath,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    const ct = resp.headers.get("Content-Type") ?? "";
    assertEquals(
      ct.includes("application/xml") || ct.includes("text/xml"),
      true,
      `Multi-Status Content-Type must be application/xml or text/xml; got: ${ct}`,
    );
    // Root element must be multistatus.
    assertEquals(
      resp.body.includes("multistatus"),
      true,
      "Multi-Status body must contain a multistatus root element",
    );
  });
});

Deno.test("RFC 4918 §13 every response element in multistatus contains a non-empty href element", async () => {
  await withServer(async (s) => {
    await s.mkcol("ms-href-col");
    await s.putTodo("ms-href-col", "ms-href-todo");

    const resp = await s.do(
      "PROPFIND",
      collectionPath("ms-href-col"),
      withHeaders(depthHeader("1"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);

    // Every <response> block must contain a non-empty <href>.
    const responseBlockRe =
      /<[a-zA-Z_][a-zA-Z0-9_.-]*:response[^>]*>([\s\S]*?)<\/[a-zA-Z_][a-zA-Z0-9_.-]*:response>/g;
    const hrefRe = /<[a-zA-Z_][a-zA-Z0-9_.-]*:href[^>]*>([^<]+)<\/[a-zA-Z_][a-zA-Z0-9_.-]*:href>/;
    let blockMatch: RegExpExecArray | null;
    let responseCount = 0;
    while ((blockMatch = responseBlockRe.exec(resp.body)) !== null) {
      responseCount++;
      const block = blockMatch[1];
      const hrefMatch = hrefRe.exec(block);
      assertEquals(hrefMatch !== null, true, "each response element must contain an href child");
      assertEquals(
        hrefMatch !== null && hrefMatch[1].trim().length > 0,
        true,
        "href element inside response must be non-empty",
      );
    }
    assertEquals(responseCount >= 2, true, "expected at least 2 response elements (collection + child)");
  });
});

// ─── §14.22 propstat structural integrity ─────────────────────────────────────

Deno.test("RFC 4918 §14.22 propstat elements each contain exactly one prop and one status child", async () => {
  await withServer(async (s) => {
    await s.mkcol("ps-struct-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("ps-struct-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);

    // Split on propstat open tags and inspect each block for exactly one prop and one status.
    const propstatBlockRe =
      /<[a-zA-Z_][a-zA-Z0-9_.-]*:propstat[^>]*>([\s\S]*?)<\/[a-zA-Z_][a-zA-Z0-9_.-]*:propstat>/g;
    let psMatch: RegExpExecArray | null;
    let propstatCount = 0;
    while ((psMatch = propstatBlockRe.exec(resp.body)) !== null) {
      propstatCount++;
      const content = psMatch[1];
      // Count <ns:prop ...> opening tags (not propstat itself)
      const propTags = content.match(/<[a-zA-Z_][a-zA-Z0-9_.-]*:prop[\s>]/g) ?? [];
      const statusTags = content.match(/<[a-zA-Z_][a-zA-Z0-9_.-]*:status[^>]*>/g) ?? [];
      assertEquals(propTags.length, 1, `propstat must contain exactly one prop element; found ${propTags.length}`);
      assertEquals(
        statusTags.length,
        1,
        `propstat must contain exactly one status element; found ${statusTags.length}`,
      );
    }
    assertEquals(propstatCount >= 1, true, "expected at least one propstat element");
  });
});

// ─── §15.1 creationdate format ────────────────────────────────────────────────

Deno.test("RFC 4918 §15.1 creationdate value is a valid RFC 3339 date-time string", async () => {
  await withServer(async (s) => {
    await s.mkcol("crdate-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("crdate-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "creationdate"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("crdate-col"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("creationdate");
    if (p !== undefined && p.status === 200) {
      const val = p.text();
      // RFC 3339 date-time: YYYY-MM-DDTHH:MM:SS(fractional)?(Z|±HH:MM)
      const rfc3339Re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
      assertEquals(
        rfc3339Re.test(val),
        true,
        `creationdate must be a valid RFC 3339 date-time string; got: "${val}"`,
      );
    }
  });
});

// ─── §15.2 displayname ───────────────────────────────────────────────────────

Deno.test("RFC 4918 §15.2 displayname present in allprop and settable via PROPPATCH", async () => {
  await withServer(async (s) => {
    await s.mkcol("dn-col");

    // displayname should appear in allprop.
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("dn-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(pfResp.status, 207);
    const ms1 = parseMultistatus(pfResp.body);
    const r1 = ms1.response(collectionPath("dn-col"));
    assertEquals(r1 !== undefined, true);
    const dn = r1!.prop("displayname");
    assertEquals(dn !== undefined, true, "displayname must appear in allprop response");

    // displayname SHOULD NOT be protected — set a new value.
    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:">' +
      "<D:set><D:prop><D:displayname>My Test Calendar</D:displayname></D:prop></D:set>" +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("dn-col"), xmlContentType(), ppBody);
    assertEquals(ppResp.status, 207);

    // Verify the new value is retrievable.
    const pfResp2 = await s.do(
      "PROPFIND",
      collectionPath("dn-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "displayname"),
    );
    assertEquals(pfResp2.status, 207);
    const ms2 = parseMultistatus(pfResp2.body);
    const r2 = ms2.response(collectionPath("dn-col"));
    assertEquals(r2 !== undefined, true);
    const dn2 = r2!.prop("displayname");
    assertEquals(dn2 !== undefined, true);
    assertEquals(dn2!.status, 200);
    assertEquals(dn2!.text(), "My Test Calendar", "displayname must reflect the value set via PROPPATCH");
  });
});

Deno.test("RFC 4918 §15.2 displayname with XML special characters is returned as well-formed XML", async () => {
  await withServer(async (s) => {
    await s.mkcol("esc-col");

    // Set a displayname containing all XML special characters: &, <, >, "
    const specialName = 'Health & Fitness <Pro> "Edition"';
    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:">' +
      `<D:set><D:prop><D:displayname>${specialName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</D:displayname></D:prop></D:set>` +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("esc-col"), xmlContentType(), ppBody);
    assertEquals(ppResp.status, 207, "PROPPATCH should succeed");

    // PROPFIND: the response must be parseable XML (not break on &) and return the exact value.
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("esc-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "displayname"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("esc-col"));
    assertEquals(r !== undefined, true);
    const dn = r!.prop("displayname");
    assertEquals(dn !== undefined, true);
    assertEquals(dn!.status, 200);
    assertEquals(dn!.text(), specialName, "displayname must round-trip through XML escaping");
  });
});

// ─── §15.4 getcontentlength correctness ──────────────────────────────────────

Deno.test("RFC 4918 §15.4 getcontentlength value matches actual byte length of GET response body", async () => {
  await withServer(async (s) => {
    await s.mkcol("gcl-col");
    await s.putTodo("gcl-col", "gcl-todo");

    const getResp = await s.do("GET", objectPath("gcl-col", "gcl-todo"));
    assertEquals(getResp.status, 200);
    const actualLen = new TextEncoder().encode(getResp.body).byteLength;

    const pfResp = await s.do(
      "PROPFIND",
      objectPath("gcl-col", "gcl-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getcontentlength"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("gcl-col", "gcl-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getcontentlength");
    assertEquals(p !== undefined, true, "getcontentlength must be present on a calendar object");
    assertEquals(p!.status, 200);
    assertEquals(
      parseInt(p!.text()),
      actualLen,
      `getcontentlength (${p!.text()}) must equal actual GET body byte length (${actualLen})`,
    );
  });
});

// ─── §15.5 getcontenttype ────────────────────────────────────────────────────

Deno.test("RFC 4918 §15.5 getcontenttype in allprop matches GET Content-Type header", async () => {
  await withServer(async (s) => {
    await s.mkcol("gct-col");
    await s.putTodo("gct-col", "gct-todo");

    const getResp = await s.do("GET", objectPath("gct-col", "gct-todo"));
    assertEquals(getResp.status, 200);
    const getContentType = getResp.headers.get("Content-Type") ?? "";
    assertEquals(getContentType.length > 0, true, "GET must return Content-Type header");

    const pfResp = await s.do(
      "PROPFIND",
      objectPath("gct-col", "gct-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("gct-col", "gct-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getcontenttype");
    assertEquals(p !== undefined, true, "getcontenttype must appear in allprop for a non-collection resource");
    assertEquals(p!.status, 200);
    // The media-type part must match (ignore params).
    const propType = p!.text().split(";")[0].trim();
    const headerType = getContentType.split(";")[0].trim();
    assertEquals(propType, headerType, "getcontenttype must match the media-type returned by GET");
  });
});

// ─── §15.6 getetag ───────────────────────────────────────────────────────────

Deno.test("RFC 4918 §15.6 ETag from GET response matches PROPFIND getetag property", async () => {
  await withServer(async (s) => {
    await s.mkcol("getetag-match-col");
    await s.putTodo("getetag-match-col", "getetag-match-todo");

    const getResp = await s.do("GET", objectPath("getetag-match-col", "getetag-match-todo"));
    assertEquals(getResp.status, 200);
    const getETag = getResp.headers.get("ETag");
    assertEquals(getETag !== null, true, "GET must return an ETag header for a calendar object");

    const pfResp = await s.do(
      "PROPFIND",
      objectPath("getetag-match-col", "getetag-match-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "getetag"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("getetag-match-col", "getetag-match-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getetag");
    assertEquals(p !== undefined, true);
    assertEquals(p!.status, 200);
    assertEquals(p!.text(), getETag, "getetag property value must equal ETag header returned by GET");
  });
});

Deno.test("RFC 4918 §15.6 PUT update of existing resource (204) returns ETag header", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-etag-upd");
    await s.putTodo("put-etag-upd", "upd-etag-todo");

    const resp = await s.do(
      "PUT",
      objectPath("put-etag-upd", "upd-etag-todo"),
      calContentType(),
      vtodo("upd-etag-todo", "SUMMARY:Updated"),
    );
    assertEquals(resp.status, 204, "update PUT must return 204");
    assertEquals(
      resp.headers.get("ETag") !== null,
      true,
      "PUT returning 204 must include an ETag header for the new entity",
    );
  });
});

// ─── §15.7 getlastmodified ───────────────────────────────────────────────────

Deno.test("RFC 4918 §15.7 getlastmodified present in allprop and matches GET Last-Modified header", async () => {
  await withServer(async (s) => {
    await s.mkcol("glm-col");
    await s.putTodo("glm-col", "glm-todo");

    const getResp = await s.do("GET", objectPath("glm-col", "glm-todo"));
    assertEquals(getResp.status, 200);
    const lastModHeader = getResp.headers.get("Last-Modified");

    const pfResp = await s.do(
      "PROPFIND",
      objectPath("glm-col", "glm-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("glm-col", "glm-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("getlastmodified");
    assertEquals(
      p !== undefined,
      true,
      "getlastmodified must appear in allprop for a resource that returns Last-Modified in GET",
    );
    assertEquals(p!.status, 200);
    // If the GET returned a Last-Modified header, the property value must agree.
    if (lastModHeader !== null) {
      assertEquals(
        p!.text().trim(),
        lastModHeader.trim(),
        "getlastmodified property must match GET Last-Modified header",
      );
    }
  });
});

// ─── §15.9 resourcetype for non-collection ────────────────────────────────────

Deno.test("RFC 4918 §15.9 non-collection resource resourcetype is empty (no DAV:collection child)", async () => {
  await withServer(async (s) => {
    await s.mkcol("noncol-rt-col");
    await s.putTodo("noncol-rt-col", "noncol-rt-todo");

    const resp = await s.do(
      "PROPFIND",
      objectPath("noncol-rt-col", "noncol-rt-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps(nsDAV, "resourcetype"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(objectPath("noncol-rt-col", "noncol-rt-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("resourcetype");
    assertEquals(p !== undefined, true, "resourcetype must be defined on all DAV-compliant resources");
    assertEquals(p!.status, 200);
    assertEquals(
      p!.hasChild("collection"),
      false,
      "non-collection resource resourcetype must NOT contain a <DAV:collection/> child",
    );
  });
});

// ─── §9.2 PROPPATCH — additional requirements ────────────────────────────────

Deno.test("RFC 4918 §9.2 PROPPATCH set dead property is retrievable via PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("dead-prop-col");

    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:E="http://example.com/test/">' +
      "<D:set><D:prop><E:deadprop>testvalue123</E:deadprop></D:prop></D:set>" +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("dead-prop-col"), xmlContentType(), ppBody);
    assertEquals(ppResp.status, 207);

    // Retrieve via explicit PROPFIND.
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("dead-prop-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps("http://example.com/test/", "deadprop"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(collectionPath("dead-prop-col"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("deadprop");
    assertEquals(p !== undefined, true, "dead property set via PROPPATCH must be retrievable via PROPFIND");
    assertEquals(p!.status, 200);
    assertEquals(p!.text(), "testvalue123", "dead property value must round-trip correctly");
  });
});

Deno.test("RFC 4918 §9.2 PROPPATCH atomicity: partial failure rolls back all instructions", async () => {
  await withServer(async (s) => {
    await s.mkcol("atomic-col");

    // Set a dead property AND attempt to set a protected property (getetag) in the same
    // PROPPATCH. The protected property set must fail, which must also roll back the dead
    // property set — leaving nothing changed.
    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:E="http://example.com/test/">' +
      "<D:set><D:prop><E:should-not-persist>sentinel</E:should-not-persist></D:prop></D:set>" +
      "<D:set><D:prop><D:getetag>forbidden</D:getetag></D:prop></D:set>" +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("atomic-col"), xmlContentType(), ppBody);
    // Either all succeed (207 with all 200) or the whole thing fails atomically.
    // The getetag set should fail, so the response should indicate failure.
    const ms = parseMultistatus(ppResp.body);
    const r = ms.response(collectionPath("atomic-col"));
    assertEquals(r !== undefined, true);
    const etagProp = r!.prop("getetag");
    if (etagProp !== undefined && etagProp.status !== 200) {
      // getetag set failed — the dead prop must have been rolled back too.
      const pfResp = await s.do(
        "PROPFIND",
        collectionPath("atomic-col"),
        withHeaders(depthHeader("0"), xmlContentType()),
        propfindProps("http://example.com/test/", "should-not-persist"),
      );
      const ms2 = parseMultistatus(pfResp.body);
      const r2 = ms2.response(collectionPath("atomic-col"));
      assertEquals(r2 !== undefined, true);
      const dp = r2!.prop("should-not-persist");
      assertEquals(
        dp === undefined || dp.status === 404,
        true,
        "dead property must be rolled back when another instruction in the same PROPPATCH fails (atomicity)",
      );
    }
  });
});

Deno.test(
  "RFC 4918 §9.2.1 PROPPATCH attempt to set protected property returns 403 with cannot-modify-protected-property",
  async () => {
    await withServer(async (s) => {
      await s.mkcol("protected-col");

      const ppBody =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<D:propertyupdate xmlns:D="DAV:">' +
        "<D:set><D:prop><D:getetag>bad-value</D:getetag></D:prop></D:set>" +
        "</D:propertyupdate>";
      const ppResp = await s.do("PROPPATCH", collectionPath("protected-col"), xmlContentType(), ppBody);
      assertEquals(ppResp.status, 207, "PROPPATCH attempting to set a protected property returns 207");
      const ms = parseMultistatus(ppResp.body);
      const r = ms.response(collectionPath("protected-col"));
      assertEquals(r !== undefined, true);
      const p = r!.prop("getetag");
      assertEquals(p !== undefined, true);
      assertEquals(p!.status, 403, "getetag is a protected property; propstat status must be 403");
      // Server SHOULD include cannot-modify-protected-property in the error body.
      assertEquals(
        ppResp.body.includes("cannot-modify-protected-property"),
        true,
        "error body SHOULD contain cannot-modify-protected-property precondition element",
      );
    });
  },
);

Deno.test("RFC 4918 §14.23 PROPPATCH remove of non-existent property is not an error", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-noexist-col");

    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:E="http://example.com/test/">' +
      "<D:remove><D:prop><E:does-not-exist/></D:prop></D:remove>" +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("rm-noexist-col"), xmlContentType(), ppBody);
    assertEquals(ppResp.status, 207, "PROPPATCH remove of non-existent property must still return 207");
    const ms = parseMultistatus(ppResp.body);
    const r = ms.response(collectionPath("rm-noexist-col"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("does-not-exist");
    // Removal of a non-existent property must succeed (200), not 404.
    assertEquals(
      p !== undefined && p.status === 200,
      true,
      "removing a non-existent property must not be an error (expected 200 propstat status)",
    );
  });
});

Deno.test("RFC 4918 §14.26 PROPPATCH xml:lang attribute on dead property is preserved and returned by PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("xmllang-col");

    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:E="http://example.com/test/">' +
      '<D:set><D:prop><E:langprop xml:lang="fr">Bonjour</E:langprop></D:prop></D:set>' +
      "</D:propertyupdate>";
    const ppResp = await s.do("PROPPATCH", collectionPath("xmllang-col"), xmlContentType(), ppBody);
    assertEquals(ppResp.status, 207);

    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("xmllang-col"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps("http://example.com/test/", "langprop"),
    );
    assertEquals(pfResp.status, 207);
    // The xml:lang attribute must be preserved in the PROPFIND response body.
    assertEquals(
      pfResp.body.includes("xml:lang") && (pfResp.body.includes('"fr"') || pfResp.body.includes("'fr'")),
      true,
      'xml:lang="fr" attribute must be persistently stored and returned by PROPFIND',
    );
  });
});

// ─── §9.3 MKCOL — additional requirements ────────────────────────────────────

Deno.test("RFC 4918 §9.3.1 MKCOL with unsupported request body type returns 415", async () => {
  await withServer(async (s) => {
    // Sending a body with Content-Type that the server does not support for MKCOL.
    const resp = await s.do(
      "MKCOL",
      collectionPath("mkcol-body-col"),
      { "Content-Type": "application/json" },
      '{"key":"value"}',
    );
    assertEquals(resp.status, 415, "MKCOL with unsupported body type must return 415 Unsupported Media Type");
  });
});

// ─── §9.6 DELETE — additional requirements ───────────────────────────────────

Deno.test("RFC 4918 §9.6.1 DELETE collection with undeletable member returns 207 Multi-Status", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-207-col");
    await s.putTodo("del-207-col", "del-207-todo");

    // In a MemoryStorage server all members are deletable, so the expected result is 204.
    // The RFC permits 207 when some members cannot be deleted. Verify the server returns
    // either 204 (full success) or 207 (partial failure) — not any other status.
    const resp = await s.do("DELETE", collectionPath("del-207-col"));
    assertEquals(
      resp.status === 204 || resp.status === 207,
      true,
      `DELETE collection must return 204 (full success) or 207 (partial failure); got ${resp.status}`,
    );
  });
});

// ─── §9.7 PUT — additional requirements ──────────────────────────────────────

Deno.test("RFC 4918 §9.7.1 PUT to path with missing parent collection returns 409", async () => {
  await withServer(async (s) => {
    // Parent collection "no-parent-col" has never been created.
    const resp = await s.do(
      "PUT",
      objectPath("no-parent-col", "orphan-todo"),
      calContentType(),
      vtodo("orphan-todo"),
    );
    assertEquals(
      resp.status,
      409,
      "PUT to a path with a missing parent collection must return 409 Conflict",
    );
  });
});

Deno.test("RFC 4918 §9.7.2 PUT to existing collection URL returns 405 Method Not Allowed", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-col-col");
    const resp = await s.do(
      "PUT",
      collectionPath("put-col-col"),
      calContentType(),
      vtodo("wont-matter"),
    );
    assertEquals(resp.status, 405, "PUT to an existing collection URL must return 405 Method Not Allowed");
  });
});

// ─── §9.8 COPY — additional requirements ─────────────────────────────────────

Deno.test("RFC 4918 §9.8 COPY without Destination header returns 400", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-nodest-col");
    await s.putTodo("copy-nodest-col", "copy-nodest-todo");

    // No Destination header.
    const resp = await s.do("COPY", objectPath("copy-nodest-col", "copy-nodest-todo"), {});
    assertEquals(resp.status, 400, "COPY without Destination header must return 400 Bad Request");
  });
});

Deno.test("RFC 4918 §9.8.4 COPY with Overwrite:F to existing destination returns 412", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-ovf-src");
    await s.mkcol("copy-ovf-dst");
    await s.putTodo("copy-ovf-src", "ovf-todo");
    await s.putTodo("copy-ovf-dst", "ovf-todo"); // destination already exists

    const resp = await s.do(
      "COPY",
      objectPath("copy-ovf-src", "ovf-todo"),
      {
        Destination: s.base + objectPath("copy-ovf-dst", "ovf-todo"),
        Overwrite: "F",
      },
    );
    assertEquals(
      resp.status,
      412,
      "COPY with Overwrite:F to an existing destination must return 412 Precondition Failed",
    );
  });
});

Deno.test("RFC 4918 §9.8.4 COPY to existing destination without Overwrite header succeeds with 204", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-ov-src");
    await s.mkcol("copy-ov-dst");
    await s.putTodo("copy-ov-src", "ov-todo");
    await s.putTodo("copy-ov-dst", "ov-todo"); // destination already exists

    // Default Overwrite is T — must overwrite and return 204.
    const resp = await s.do(
      "COPY",
      objectPath("copy-ov-src", "ov-todo"),
      { Destination: s.base + objectPath("copy-ov-dst", "ov-todo") },
    );
    assertEquals(
      resp.status,
      204,
      "COPY to existing destination with default Overwrite (T) must return 204 No Content",
    );
  });
});

Deno.test("RFC 4918 §9.8.5 COPY with source equal to destination returns 403", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-same-col");
    await s.putTodo("copy-same-col", "same-todo");

    const src = objectPath("copy-same-col", "same-todo");
    const resp = await s.do("COPY", src, { Destination: s.base + src });
    assertEquals(resp.status, 403, "COPY where source equals destination must return 403 Forbidden");
  });
});

Deno.test("RFC 4918 §9.8.5 COPY to destination with missing parent collection returns 409", async () => {
  await withServer(async (s) => {
    await s.mkcol("copy-409-src");
    await s.putTodo("copy-409-src", "copy-409-todo");

    // Destination parent "copy-409-missing" does not exist.
    const resp = await s.do(
      "COPY",
      objectPath("copy-409-src", "copy-409-todo"),
      { Destination: s.base + objectPath("copy-409-missing", "copy-409-todo") },
    );
    assertEquals(
      resp.status,
      409,
      "COPY to destination with missing parent collection must return 409 Conflict",
    );
  });
});

// ─── §9.9 MOVE — additional requirements ─────────────────────────────────────

Deno.test("RFC 4918 §9.9 MOVE without Destination header returns 400", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-nodest-col");
    await s.putTodo("move-nodest-col", "move-nodest-todo");

    const resp = await s.do("MOVE", objectPath("move-nodest-col", "move-nodest-todo"), {});
    assertEquals(resp.status, 400, "MOVE without Destination header must return 400 Bad Request");
  });
});

Deno.test("RFC 4918 §9.9 successful MOVE removes the source resource", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-src-col");
    await s.mkcol("move-dst-col");
    await s.putTodo("move-src-col", "move-src-todo");

    const moveResp = await s.do(
      "MOVE",
      objectPath("move-src-col", "move-src-todo"),
      { Destination: s.base + objectPath("move-dst-col", "move-src-todo") },
    );
    assertEquals(
      [201, 204].includes(moveResp.status),
      true,
      `MOVE must return 201 or 204 on success; got ${moveResp.status}`,
    );

    // Source must no longer exist.
    const getResp = await s.do("GET", objectPath("move-src-col", "move-src-todo"));
    assertEquals(getResp.status, 404, "source resource must return 404 after successful MOVE");
  });
});

Deno.test("RFC 4918 §9.9 successful MOVE makes resource accessible at destination", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-acc-src");
    await s.mkcol("move-acc-dst");
    await s.putTodo("move-acc-src", "move-acc-todo");

    const moveResp = await s.do(
      "MOVE",
      objectPath("move-acc-src", "move-acc-todo"),
      { Destination: s.base + objectPath("move-acc-dst", "move-acc-todo") },
    );
    assertEquals(
      [201, 204].includes(moveResp.status),
      true,
      `MOVE must return 201 or 204 on success; got ${moveResp.status}`,
    );

    // Destination must be accessible.
    const getResp = await s.do("GET", objectPath("move-acc-dst", "move-acc-todo"));
    assertEquals(getResp.status, 200, "resource must be accessible at destination after successful MOVE");
    assertEquals(getResp.body.includes("BEGIN:VCALENDAR"), true, "destination body must contain the moved resource");
  });
});

Deno.test("RFC 4918 §9.9.3 MOVE with Overwrite:F to existing destination returns 412", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-ovf-src");
    await s.mkcol("move-ovf-dst");
    await s.putTodo("move-ovf-src", "movf-todo");
    await s.putTodo("move-ovf-dst", "movf-todo"); // destination already exists

    const resp = await s.do(
      "MOVE",
      objectPath("move-ovf-src", "movf-todo"),
      {
        Destination: s.base + objectPath("move-ovf-dst", "movf-todo"),
        Overwrite: "F",
      },
    );
    assertEquals(
      resp.status,
      412,
      "MOVE with Overwrite:F to an existing destination must return 412 Precondition Failed",
    );
  });
});

Deno.test("RFC 4918 §9.9.1 MOVE preserves dead properties at destination", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-dp-src");
    await s.mkcol("move-dp-dst");
    await s.putTodo("move-dp-src", "move-dp-todo");

    // Set a dead property on the source object.
    const ppBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:E="http://example.com/test/">' +
      "<D:set><D:prop><E:moveprop>movevalue</E:moveprop></D:prop></D:set>" +
      "</D:propertyupdate>";
    const ppResp = await s.do(
      "PROPPATCH",
      objectPath("move-dp-src", "move-dp-todo"),
      xmlContentType(),
      ppBody,
    );
    assertEquals(ppResp.status, 207);

    // Move the resource.
    const moveResp = await s.do(
      "MOVE",
      objectPath("move-dp-src", "move-dp-todo"),
      { Destination: s.base + objectPath("move-dp-dst", "move-dp-todo") },
    );
    assertEquals(
      [201, 204].includes(moveResp.status),
      true,
      `MOVE must succeed; got ${moveResp.status}`,
    );

    // Dead property must be present at destination.
    const pfResp = await s.do(
      "PROPFIND",
      objectPath("move-dp-dst", "move-dp-todo"),
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindProps("http://example.com/test/", "moveprop"),
    );
    assertEquals(pfResp.status, 207);
    const ms = parseMultistatus(pfResp.body);
    const r = ms.response(objectPath("move-dp-dst", "move-dp-todo"));
    assertEquals(r !== undefined, true);
    const p = r!.prop("moveprop");
    assertEquals(p !== undefined, true, "dead property must be present at destination after MOVE");
    assertEquals(p!.status, 200);
    assertEquals(p!.text(), "movevalue", "dead property value must be preserved after MOVE");
  });
});

Deno.test("RFC 4918 §9.9.4 MOVE to destination with missing parent collection returns 409", async () => {
  await withServer(async (s) => {
    await s.mkcol("move-409-src");
    await s.putTodo("move-409-src", "move-409-todo");

    // Destination parent "move-409-missing" does not exist.
    const resp = await s.do(
      "MOVE",
      objectPath("move-409-src", "move-409-todo"),
      { Destination: s.base + objectPath("move-409-missing", "move-409-todo") },
    );
    assertEquals(
      resp.status,
      409,
      "MOVE to destination with missing parent collection must return 409 Conflict",
    );
  });
});

// ─── §10.1 OPTIONS compliance class on all resources ─────────────────────────

Deno.test("RFC 4918 §10.1 OPTIONS on collection and calendar object URLs returns DAV:1 header", async () => {
  await withServer(async (s) => {
    await s.mkcol("opts-col");
    await s.putTodo("opts-col", "opts-todo");

    // OPTIONS on the collection.
    const colResp = await s.do("OPTIONS", collectionPath("opts-col"));
    assertEquals(colResp.status, 200);
    const colDav = colResp.headers.get("DAV") ?? colResp.headers.get("Dav") ?? "";
    assertEquals(colDav.includes("1"), true, "OPTIONS on collection must include DAV: 1");

    // OPTIONS on an individual calendar object.
    const objResp = await s.do("OPTIONS", objectPath("opts-col", "opts-todo"));
    assertEquals(objResp.status, 200);
    const objDav = objResp.headers.get("DAV") ?? objResp.headers.get("Dav") ?? "";
    assertEquals(objDav.includes("1"), true, "OPTIONS on calendar object must include DAV: 1");
  });
});

// ─── §10.4 WebDAV If header ───────────────────────────────────────────────────

Deno.test("RFC 4918 §10.4 WebDAV If header with non-matching ETag condition returns 412", async () => {
  await withServer(async (s) => {
    await s.mkcol("wdav-if-col");
    await s.putTodo("wdav-if-col", "wdav-if-todo");

    // The WebDAV If header uses the form: If: (["<entity-tag>"])
    // An entity-tag that does not match the current ETag must cause 412.
    const resp = await s.do(
      "PUT",
      objectPath("wdav-if-col", "wdav-if-todo"),
      withHeaders(calContentType(), { If: '(["non-matching-etag-value-xyz"])' }),
      vtodo("wdav-if-todo", "SUMMARY:Should Not Save"),
    );
    assertEquals(
      resp.status,
      412,
      "WebDAV If header with a non-matching ETag condition must result in 412 Precondition Failed",
    );
  });
});

// ─── §5.2 Collection URL trailing-slash ──────────────────────────────────────

Deno.test("RFC 4918 §5.2 collection URL without trailing slash returns Content-Location with trailing slash", async () => {
  await withServer(async (s) => {
    await s.mkcol("slash-col");

    // collectionPath returns the path without a trailing slash.
    const path = collectionPath("slash-col"); // e.g. /calstakk/calendars/slash-col
    const resp = await s.do(
      "PROPFIND",
      path,
      withHeaders(depthHeader("0"), xmlContentType()),
      propfindAllprop(),
    );
    assertEquals(resp.status, 207);
    // Server SHOULD return Content-Location pointing to the URI with a trailing slash.
    const cl = resp.headers.get("Content-Location") ?? "";
    assertEquals(
      cl !== "" && cl.endsWith("/"),
      true,
      `server SHOULD return Content-Location header ending with '/' when collection accessed without trailing slash; got: "${cl}"`,
    );
  });
});
