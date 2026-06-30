// RFC 6764 — Locating Services for Calendaring Extensions to WebDAV (CalDAV)
// Spec: specs/rfc6764.txt
//
// Coverage:
//   §5   Well-known URIs — /.well-known/caldav MUST redirect to the principal

import { assertEquals } from "@std/assert";
import { principalPath, withServer } from "./harness.ts";

Deno.test("RFC 6764 §5 /.well-known/caldav redirects to principal URL", async () => {
  await withServer(async (s) => {
    const resp = await s.doNoRedirect("GET", "/.well-known/caldav");
    assertEquals(
      [301, 302, 307, 308].includes(resp.status),
      true,
      `/.well-known/caldav must redirect; got ${resp.status}`,
    );
    const loc = resp.headers.get("Location") ?? "";
    assertEquals(
      loc.endsWith(principalPath) || loc === principalPath,
      true,
      `Location must point to ${principalPath}; got ${loc}`,
    );
  });
});

Deno.test("RFC 6764 §5 /.well-known/caldav redirect followed reaches principal", async () => {
  await withServer(async (s) => {
    // s.do() follows redirects
    const resp = await s.do("OPTIONS", "/.well-known/caldav");
    // After redirect, OPTIONS on the principal returns 200 with DAV header
    assertEquals(resp.status, 200);
    const dav = resp.headers.get("DAV") ?? resp.headers.get("Dav") ?? "";
    assertEquals(dav.includes("calendar-access"), true, "should land on CalDAV principal");
  });
});

Deno.test("RFC 6764 §5 PROPFIND on /.well-known/caldav (after redirect) returns 207", async () => {
  await withServer(async (s) => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
    const resp = await s.do(
      "PROPFIND",
      "/.well-known/caldav",
      { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body,
    );
    assertEquals(resp.status, 207);
  });
});

// §5 — PROPFIND sent directly to /.well-known/caldav (no redirect-following) must be redirected

Deno.test("RFC 6764 §5 PROPFIND on /.well-known/caldav without redirect-following must return a redirect (not 207)", async () => {
  await withServer(async (s) => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
    const resp = await s.doNoRedirect(
      "PROPFIND",
      "/.well-known/caldav",
      { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body,
    );
    // RFC 6764 §5: the server MUST redirect HTTP requests for that resource to the
    // actual context path — this applies to ALL HTTP methods, not just GET.
    assertEquals(
      [301, 302, 303, 307, 308].includes(resp.status),
      true,
      `PROPFIND on /.well-known/caldav must redirect (3xx); got ${resp.status}`,
    );
  });
});

// §5 — /.well-known/caldav MUST NOT act as the actual CalDAV endpoint

Deno.test("RFC 6764 §5 /.well-known/caldav must not act as actual CalDAV endpoint (direct PROPFIND must redirect, not return 207)", async () => {
  await withServer(async (s) => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
    const resp = await s.doNoRedirect(
      "PROPFIND",
      "/.well-known/caldav",
      { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body,
    );
    // RFC 6764 §5 / RFC 5785 §1.1: servers MUST NOT locate the actual CalDAV
    // service at the well-known URI — it is a stub redirector only.
    // A 207 Multi-Status would mean the server treated the well-known URI as a
    // real CalDAV resource, which is non-compliant.
    assertEquals(
      resp.status !== 207,
      true,
      `/.well-known/caldav must not respond as a real CalDAV endpoint; got 207 Multi-Status`,
    );
  });
});

// §5 — redirect status code must include 303 in the accepted set

Deno.test("RFC 6764 §5 /.well-known/caldav redirect must accept 303 as a valid redirect status code", async () => {
  await withServer(async (s) => {
    const resp = await s.doNoRedirect("GET", "/.well-known/caldav");
    // RFC 6764 §5 explicitly lists 301, 303, or 307 as example redirect mechanisms.
    // The redirect status must be one of the RFC-permitted values; 303 is explicitly valid.
    const rfcPermitted = [301, 303, 307, 308];
    assertEquals(
      rfcPermitted.includes(resp.status),
      true,
      `/.well-known/caldav redirect status must be one of ${rfcPermitted.join(", ")} per RFC 6764 §5; got ${resp.status}`,
    );
  });
});

// §5 — redirect response SHOULD include Cache-Control

Deno.test("RFC 6764 §5 /.well-known/caldav redirect response should include a Cache-Control header", async () => {
  await withServer(async (s) => {
    const resp = await s.doNoRedirect("GET", "/.well-known/caldav");
    // RFC 6764 §5: Servers SHOULD set an appropriate Cache-Control header value
    // (as per Section 14.9 of RFC 2616) in the redirect response.
    const cc = resp.headers.get("Cache-Control");
    assertEquals(
      cc !== null && cc.length > 0,
      true,
      `/.well-known/caldav redirect must include a Cache-Control header; got none`,
    );
  });
});

// §5 — redirect Location header must be an absolute URI

Deno.test("RFC 6764 §5 /.well-known/caldav redirect Location header must be an absolute URI (scheme + host + path)", async () => {
  await withServer(async (s) => {
    const resp = await s.doNoRedirect("GET", "/.well-known/caldav");
    const loc = resp.headers.get("Location") ?? "";
    // RFC 2616 §14.30: the Location field value must be an absoluteURI, i.e.
    // it must include the scheme (http:// or https://) and authority (host).
    const isAbsolute = /^https?:\/\/.+/.test(loc);
    assertEquals(
      isAbsolute,
      true,
      `Location header in /.well-known/caldav redirect must be an absolute URI; got "${loc}"`,
    );
  });
});

// §7 — unauthenticated access to DAV:current-user-principal must return 401

Deno.test("RFC 6764 §7 unauthenticated PROPFIND for DAV:current-user-principal must return 401 Unauthorized", async () => {
  await withServer(async (s) => {
    // RFC 6764 §7: Servers MUST force authentication for PROPFIND requests that
    // retrieve the DAV:current-user-principal property to ensure that the returned
    // value corresponds to the principal-URL of the authenticated user.
    // A request without any Authorization header must be rejected with 401.
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<D:propfind xmlns:D="DAV:">' +
      "<D:prop><D:current-user-principal/></D:prop>" +
      "</D:propfind>";
    const resp = await s.doNoRedirect(
      "PROPFIND",
      principalPath,
      { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body,
    );
    assertEquals(
      resp.status,
      401,
      `Unauthenticated PROPFIND for DAV:current-user-principal must return 401; got ${resp.status}`,
    );
  });
});
