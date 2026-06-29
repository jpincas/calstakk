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
