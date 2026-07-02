// Admin / account JSON API tests (/api/me, /api/users).
//
// User provisioning has no CalDAV specification, so these are plain API tests
// rather than RFC conformance tests. They cover admin-only user management:
// create, list, update (password reset), and delete.

import { assertEquals } from "@std/assert";
import {
  depthHeader,
  userCollectionPath,
  withServer,
  xmlContentType,
} from "./conformance/harness.ts";

const jsonCT = { "Content-Type": "application/json" };

Deno.test("API /api/me returns the authenticated user's identity", async () => {
  await withServer(async (s) => {
    const resp = await s.do("GET", "/api/me");
    assertEquals(resp.status, 200);
    const me = JSON.parse(resp.body);
    assertEquals(me.username, "owner");
    assertEquals(me.isAdmin, true);
    assertEquals("passwordHash" in me, false, "password hash must never be exposed");
  });
});

Deno.test("API /api/me requires authentication", async () => {
  await withServer(async (s) => {
    const resp = await s.doNoRedirect("GET", "/api/me");
    assertEquals(resp.status, 401);
    assertEquals(resp.headers.has("WWW-Authenticate"), true, "plain clients get the Basic challenge");
  });
});

Deno.test("Auth: enabling CALSTAKK_PASSWORD on a store bootstrapped without auth adopts the new password", async () => {
  const { createHandler } = await import("../src/protocol.ts");
  const { MemoryStorage } = await import("../src/storage.ts");
  const storage = new MemoryStorage();
  const baseConfig = {
    server: { host: "localhost", port: 0, kvPath: undefined, webDir: undefined },
    user: { username: "solo", password: "", displayName: "Solo", email: "", timezone: "UTC" },
  };

  // Phase 1: no password configured — first request bootstraps the owner with an empty hash.
  const openHandler = createHandler(storage, baseConfig);
  const open = await openHandler(new Request("http://localhost/api/me"));
  assertEquals(open.status, 200);
  await open.body?.cancel();

  // Phase 2: restart with a password — the owner must be able to log in with it.
  const lockedHandler = createHandler(storage, {
    ...baseConfig,
    user: { ...baseConfig.user, password: "newpass" },
  });
  const auth = "Basic " + btoa("solo:newpass");
  const me = await lockedHandler(new Request("http://localhost/api/me", { headers: { Authorization: auth } }));
  assertEquals(me.status, 200, "owner must be able to sign in with the newly configured password");
  await me.body?.cancel();

  const wrong = await lockedHandler(new Request("http://localhost/api/me", { headers: { Authorization: "Basic " + btoa("solo:bad") } }));
  assertEquals(wrong.status, 401);
  await wrong.body?.cancel();
});

Deno.test("API 401 omits the Basic challenge for SPA requests (X-Requested-With)", async () => {
  await withServer(async (s) => {
    // Without this, browsers pop a native credentials dialog over the SPA login page.
    const resp = await s.doNoRedirect("GET", "/api/me", { "X-Requested-With": "XMLHttpRequest" });
    assertEquals(resp.status, 401);
    assertEquals(resp.headers.has("WWW-Authenticate"), false, "SPA requests must not trigger the native browser dialog");

    // Browsers stamp Sec-Fetch-Mode on every fetch() — suppress for those too,
    // so even stale bundles without X-Requested-With never pop the dialog.
    const viaFetch = await s.doNoRedirect("GET", "/api/me", { "Sec-Fetch-Mode": "cors" });
    assertEquals(viaFetch.headers.has("WWW-Authenticate"), false, "browser fetch() must not trigger the native dialog");

    // Address-bar navigation still gets the challenge (Basic prompt is correct there).
    const viaNav = await s.doNoRedirect("GET", "/api/me", { "Sec-Fetch-Mode": "navigate" });
    assertEquals(viaNav.headers.has("WWW-Authenticate"), true, "navigations keep the RFC 7235 challenge");
  });
});

Deno.test("API admin can create a user who can then authenticate and use their calendar home", async () => {
  await withServer(async (s) => {
    const create = await s.do("POST", "/api/users", jsonCT,
      JSON.stringify({ username: "dana", password: "danapass", displayName: "Dana", email: "dana@example.com" }));
    assertEquals(create.status, 201, `create failed: ${create.body}`);
    const created = JSON.parse(create.body);
    assertEquals(created.username, "dana");
    assertEquals(created.isAdmin, false, "created users are never admins");

    // The new user can authenticate and sees a default calendar
    const pf = await s.doAs("dana", "danapass", "PROPFIND", "/calendars/dana",
      { ...depthHeader("1"), ...xmlContentType() });
    assertEquals(pf.status, 207, `new user PROPFIND failed: ${pf.body}`);
    assertEquals(pf.body.includes(userCollectionPath("dana", "default")), true,
      "new user must have a default calendar");

    // And shows up as non-admin in /api/me
    const me = await s.doAs("dana", "danapass", "GET", "/api/me");
    assertEquals(JSON.parse(me.body).isAdmin, false);
  });
});

Deno.test("API user creation validates input", async () => {
  await withServer(async (s) => {
    const noPass = await s.do("POST", "/api/users", jsonCT, JSON.stringify({ username: "x1" }));
    assertEquals(noPass.status, 400, "missing password must be 400");

    const badName = await s.do("POST", "/api/users", jsonCT,
      JSON.stringify({ username: "Bad Name!", password: "pw" }));
    assertEquals(badName.status, 400, "invalid username must be 400");

    const dup = await s.do("POST", "/api/users", jsonCT,
      JSON.stringify({ username: "owner", password: "pw" }));
    assertEquals(dup.status, 409, "duplicate username must be 409");

    const badJson = await s.do("POST", "/api/users", jsonCT, "{nope");
    assertEquals(badJson.status, 400, "malformed JSON must be 400");
  });
});

Deno.test("API user management is admin-only", async () => {
  await withServer(async (s) => {
    await s.createUser("eve", "eve@example.com", "evepass");

    const list = await s.doAs("eve", "evepass", "GET", "/api/users");
    assertEquals(list.status, 403, "non-admin list must be 403");

    const create = await s.doAs("eve", "evepass", "POST", "/api/users", jsonCT,
      JSON.stringify({ username: "mallory", password: "pw" }));
    assertEquals(create.status, 403, "non-admin create must be 403");

    const del = await s.doAs("eve", "evepass", "DELETE", "/api/users/owner");
    assertEquals(del.status, 403, "non-admin delete must be 403");
  });
});

Deno.test("API admin can list all users", async () => {
  await withServer(async (s) => {
    await s.createUser("frank", "frank@example.com");
    const resp = await s.do("GET", "/api/users");
    assertEquals(resp.status, 200);
    const users = JSON.parse(resp.body);
    const names = users.map((u: { username: string }) => u.username);
    assertEquals(names.includes("owner"), true);
    assertEquals(names.includes("frank"), true);
    assertEquals(users.every((u: Record<string, unknown>) => !("passwordHash" in u)), true,
      "password hashes must never be listed");
  });
});

Deno.test("API admin can reset a user's password", async () => {
  await withServer(async (s) => {
    await s.createUser("gina", "gina@example.com", "oldpass");

    const patch = await s.do("PATCH", "/api/users/gina", jsonCT,
      JSON.stringify({ password: "newpass" }));
    assertEquals(patch.status, 200, `password reset failed: ${patch.body}`);

    const oldAuth = await s.doAs("gina", "oldpass", "GET", "/api/me");
    assertEquals(oldAuth.status, 401, "old password must stop working");

    const newAuth = await s.doAs("gina", "newpass", "GET", "/api/me");
    assertEquals(newAuth.status, 200, "new password must work");
  });
});

Deno.test("API admin can update profile fields", async () => {
  await withServer(async (s) => {
    await s.createUser("hugo", "hugo@example.com");
    const patch = await s.do("PATCH", "/api/users/hugo", jsonCT,
      JSON.stringify({ displayName: "Hugo Boss", timezone: "Europe/Madrid" }));
    assertEquals(patch.status, 200);
    const updated = JSON.parse(patch.body);
    assertEquals(updated.displayName, "Hugo Boss");
    assertEquals(updated.timezone, "Europe/Madrid");
  });
});

Deno.test("API admin can delete a user, removing their access and data", async () => {
  await withServer(async (s) => {
    await s.createUser("iris", "iris@example.com", "irispass");

    const del = await s.do("DELETE", "/api/users/iris");
    assertEquals(del.status, 204);

    const gone = await s.doAs("iris", "irispass", "GET", "/api/me");
    assertEquals(gone.status, 401, "deleted user must no longer authenticate");

    const list = await s.do("GET", "/api/users");
    const names = JSON.parse(list.body).map((u: { username: string }) => u.username);
    assertEquals(names.includes("iris"), false);
  });
});

Deno.test("API the admin account cannot be deleted", async () => {
  await withServer(async (s) => {
    const resp = await s.do("DELETE", "/api/users/owner");
    assertEquals(resp.status, 403);
  });
});

Deno.test("API unknown users and paths return 404", async () => {
  await withServer(async (s) => {
    const patch = await s.do("PATCH", "/api/users/ghost", jsonCT, JSON.stringify({ password: "x" }));
    assertEquals(patch.status, 404);
    const nothing = await s.do("GET", "/api/nothing");
    assertEquals(nothing.status, 404);
  });
});

Deno.test("API deleting a user removes sharing grants in both directions", async () => {
  await withServer(async (s) => {
    await s.createUser("judy", "judy@example.com", "judypass");
    await s.mkcol("shared-with-judy");
    const acl = await s.do("ACL", "/calendars/owner/shared-with-judy", xmlContentType(),
      '<?xml version="1.0" encoding="UTF-8"?><D:acl xmlns:D="DAV:"><D:ace>' +
        "<D:principal><D:href>/principals/judy</D:href></D:principal>" +
        "<D:grant><D:privilege><D:read/></D:privilege></D:grant>" +
        "</D:ace></D:acl>");
    assertEquals(acl.status, 200);

    await s.do("DELETE", "/api/users/judy");

    // Grant is gone from the collection's ACL
    const pf = await s.do("PROPFIND", "/calendars/owner/shared-with-judy",
      { ...depthHeader("0"), ...xmlContentType() },
      '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:acl/></D:prop></D:propfind>');
    assertEquals(pf.body.includes("/principals/judy"), false, "deleted user must not linger in ACLs");
  });
});
