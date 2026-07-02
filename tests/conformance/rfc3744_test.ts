// RFC 3744 (WebDAV Access Control Protocol) — conformance tests for the
// implemented subset: the ACL method on calendar collections, access-control
// properties (DAV:owner, DAV:acl, DAV:current-user-privilege-set), principal
// properties, principal reports (§9), and privilege enforcement for sharing
// calendar collections between users. Also covers RFC 5397
// (current-user-principal) correctness for non-owner requesters.

import { assertEquals } from "@std/assert";
import {
  calendarMultiget,
  calendarQueryByComp,
  collectionPath,
  depthHeader,
  nsCalDAV,
  nsDAV,
  objectPath,
  parseMultistatus,
  principalPath,
  propfindProps,
  userCollectionPath,
  userPrincipalPath,
  vevent,
  withServer,
  xmlContentType,
} from "./harness.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Build a DAV:acl body granting each principal the listed privileges. */
function aclBody(...aces: Array<{ principal: string; privileges: string[] }>): string {
  const aceXML = aces.map((a) => {
    const privs = a.privileges.map((p) => `<D:privilege><D:${p}/></D:privilege>`).join("");
    return `<D:ace><D:principal><D:href>${a.principal}</D:href></D:principal><D:grant>${privs}</D:grant></D:ace>`;
  }).join("");
  return XML_HEADER + `<D:acl xmlns:D="DAV:">${aceXML}</D:acl>`;
}

function principalPropertySearch(matchProp: string, match: string, ...requested: string[]): string {
  const reqProps = requested.map((p) => `<D:${p}/>`).join("");
  return XML_HEADER +
    `<D:principal-property-search xmlns:D="DAV:">` +
    `<D:property-search><D:prop><D:${matchProp}/></D:prop><D:match>${match}</D:match></D:property-search>` +
    `<D:prop>${reqProps}</D:prop>` +
    `</D:principal-property-search>`;
}

const BOB = "bob";
const BOB_PASS = "bobpass";
const CAROL = "carol";
const CAROL_PASS = "carolpass";

// ─── §7.2 Compliance advertising ──────────────────────────────────────────────

Deno.test("RFC 3744 §7.2 OPTIONS DAV header includes access-control compliance class", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", collectionPath("default"));
    const dav = resp.headers.get("DAV") ?? "";
    assertEquals(dav.includes("access-control"), true, `DAV header '${dav}' must include access-control`);
    const allow = resp.headers.get("Allow") ?? "";
    assertEquals(allow.includes("ACL"), true, `Allow header '${allow}' must include ACL`);
  });
});

// ─── §8.1 ACL method ──────────────────────────────────────────────────────────

Deno.test("RFC 3744 §8.1 ACL grants DAV:read — sharee can read the collection and its objects", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("shared-read");
    await s.putEvent("shared-read", "ev1");

    const aclResp = await s.do("ACL", collectionPath("shared-read"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));
    assertEquals(aclResp.status, 200, `ACL failed: ${aclResp.body}`);

    // Sharee can PROPFIND the collection
    const pf = await s.doAs(BOB, BOB_PASS, "PROPFIND", collectionPath("shared-read"),
      { ...depthHeader("1"), ...xmlContentType() }, propfindProps(nsDAV, "resourcetype"));
    assertEquals(pf.status, 207, `sharee PROPFIND must succeed: ${pf.body}`);

    // Sharee can GET an object
    const get = await s.doAs(BOB, BOB_PASS, "GET", objectPath("shared-read", "ev1"));
    assertEquals(get.status, 200, "sharee GET of shared object must succeed");
    assertEquals(get.body.includes("BEGIN:VEVENT"), true);
  });
});

Deno.test("RFC 3744 §7.1.1 DAV:read grant does not confer DAV:write — mutations are 403", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("read-only");
    await s.putEvent("read-only", "ev1");
    await s.do("ACL", collectionPath("read-only"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const put = await s.doAs(BOB, BOB_PASS, "PUT", objectPath("read-only", "ev2"),
      { "Content-Type": "text/calendar" }, vevent("ev2"));
    assertEquals(put.status, 403, "PUT with a read-only grant must be 403");

    const del = await s.doAs(BOB, BOB_PASS, "DELETE", objectPath("read-only", "ev1"));
    assertEquals(del.status, 403, "DELETE with a read-only grant must be 403");

    const pp = await s.doAs(BOB, BOB_PASS, "PROPPATCH", collectionPath("read-only"), xmlContentType(),
      XML_HEADER + '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:displayname>Hacked</D:displayname></D:prop></D:set></D:propertyupdate>');
    assertEquals(pp.status, 403, "PROPPATCH with a read-only grant must be 403");
  });
});

Deno.test("RFC 3744 §8.1 ACL grants DAV:read + DAV:write — sharee can create, modify, and delete objects", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("shared-rw");
    await s.do("ACL", collectionPath("shared-rw"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read", "write"] }));

    const put = await s.doAs(BOB, BOB_PASS, "PUT", objectPath("shared-rw", "bob-ev"),
      { "Content-Type": "text/calendar" }, vevent("bob-ev"));
    assertEquals(put.status, 201, `read-write sharee PUT must succeed: ${put.body}`);

    const put2 = await s.doAs(BOB, BOB_PASS, "PUT", objectPath("shared-rw", "bob-ev"),
      { "Content-Type": "text/calendar" }, vevent("bob-ev", "SUMMARY:Updated"));
    assertEquals(put2.status, 204, "read-write sharee update must succeed");

    const del = await s.doAs(BOB, BOB_PASS, "DELETE", objectPath("shared-rw", "bob-ev"));
    assertEquals(del.status, 204, "read-write sharee DELETE must succeed");
  });
});

Deno.test("RFC 3744 §8.1 setting DAV:acl replaces the previous ACE set — revocation removes access", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("revoke-me");
    await s.putEvent("revoke-me", "ev1");
    await s.do("ACL", collectionPath("revoke-me"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const before = await s.doAs(BOB, BOB_PASS, "GET", objectPath("revoke-me", "ev1"));
    assertEquals(before.status, 200);

    // Empty ACE list (owner ACE is protected/implicit) revokes bob's grant
    const revoke = await s.do("ACL", collectionPath("revoke-me"), xmlContentType(),
      XML_HEADER + '<D:acl xmlns:D="DAV:"></D:acl>');
    assertEquals(revoke.status, 200, `revoking ACL failed: ${revoke.body}`);

    const after = await s.doAs(BOB, BOB_PASS, "GET", objectPath("revoke-me", "ev1"));
    assertEquals(after.status, 403, "revoked sharee must lose access");
  });
});

Deno.test("RFC 3744 §8.1.1 deny ACEs are rejected with DAV:grant-only", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("no-deny");
    const resp = await s.do("ACL", collectionPath("no-deny"), xmlContentType(),
      XML_HEADER + `<D:acl xmlns:D="DAV:"><D:ace>` +
        `<D:principal><D:href>${userPrincipalPath(BOB)}</D:href></D:principal>` +
        `<D:deny><D:privilege><D:read/></D:privilege></D:deny>` +
        `</D:ace></D:acl>`);
    assertEquals(resp.status, 403);
    assertEquals(resp.body.includes("grant-only"), true, "error body must carry DAV:grant-only");
  });
});

Deno.test("RFC 3744 §8.1.1 ACE for an unknown principal is rejected with DAV:recognized-principal", async () => {
  await withServer(async (s) => {
    await s.mkcol("bad-principal");
    const resp = await s.do("ACL", collectionPath("bad-principal"), xmlContentType(),
      aclBody({ principal: "/principals/nobody-here", privileges: ["read"] }));
    assertEquals(resp.status, 403);
    assertEquals(resp.body.includes("recognized-principal"), true, "error body must carry DAV:recognized-principal");
  });
});

Deno.test("RFC 3744 §8.1 only the owner (DAV:write-acl) may change the ACL", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    await s.mkcol("owner-acl");
    await s.do("ACL", collectionPath("owner-acl"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read", "write"] }));

    // Even a read-write sharee cannot grant access onward
    const resp = await s.doAs(BOB, BOB_PASS, "ACL", collectionPath("owner-acl"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(CAROL), privileges: ["read"] }));
    assertEquals(resp.status, 403, "non-owner ACL must be 403");
  });
});

// ─── §5 Access-control properties ─────────────────────────────────────────────

Deno.test("RFC 3744 §5.1 DAV:owner on a calendar collection is the owner's principal URL", async () => {
  await withServer(async (s) => {
    await s.mkcol("owned");
    const resp = await s.do("PROPFIND", collectionPath("owned"),
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsDAV, "owner"));
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(collectionPath("owned"));
    const ownerProp = r?.prop("owner");
    assertEquals(ownerProp?.status, 200, "DAV:owner must be present");
    assertEquals(ownerProp?.text().includes(principalPath), true,
      `DAV:owner must reference ${principalPath}, got: ${ownerProp?.text()}`);
  });
});

Deno.test("RFC 3744 §5.4 DAV:current-user-privilege-set reflects the requester's effective privileges", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    await s.mkcol("privs");
    await s.do("ACL", collectionPath("privs"), xmlContentType(), aclBody(
      { principal: userPrincipalPath(BOB), privileges: ["read"] },
      { principal: userPrincipalPath(CAROL), privileges: ["read", "write"] },
    ));

    const body = propfindProps(nsDAV, "current-user-privilege-set");
    const hdrs = { ...depthHeader("0"), ...xmlContentType() };

    // Owner: all privileges
    const ownerResp = await s.do("PROPFIND", collectionPath("privs"), hdrs, body);
    const ownerCups = parseMultistatus(ownerResp.body).response(collectionPath("privs"))?.prop("current-user-privilege-set");
    assertEquals(ownerCups?.status, 200);
    assertEquals(ownerCups?.hasChild("privilege"), true);
    assertEquals(ownerResp.body.includes("<D:all/>"), true, "owner privileges must include DAV:all");

    // Read-only sharee: read but no write
    const bobResp = await s.doAs(BOB, BOB_PASS, "PROPFIND", collectionPath("privs"), hdrs, body);
    assertEquals(bobResp.status, 207);
    assertEquals(bobResp.body.includes("<D:read/>"), true, "read sharee must hold DAV:read");
    assertEquals(bobResp.body.includes("<D:write/>"), false, "read sharee must not hold DAV:write");
    assertEquals(bobResp.body.includes("<D:all/>"), false, "read sharee must not hold DAV:all");

    // Read-write sharee: read + write, still not all
    const carolResp = await s.doAs(CAROL, CAROL_PASS, "PROPFIND", collectionPath("privs"), hdrs, body);
    assertEquals(carolResp.body.includes("<D:read/>"), true, "rw sharee must hold DAV:read");
    assertEquals(carolResp.body.includes("<D:write/>"), true, "rw sharee must hold DAV:write");
    assertEquals(carolResp.body.includes("<D:all/>"), false, "rw sharee must not hold DAV:all");
  });
});

Deno.test("RFC 3744 §5.5 DAV:acl lists the protected owner ACE plus granted ACEs (owner view)", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("acl-prop");
    await s.do("ACL", collectionPath("acl-prop"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read", "write"] }));

    const resp = await s.do("PROPFIND", collectionPath("acl-prop"),
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsDAV, "acl"));
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes(principalPath), true, "acl must include the owner principal");
    assertEquals(resp.body.includes(userPrincipalPath(BOB)), true, "acl must include the sharee principal");
    assertEquals(resp.body.includes("<D:protected/>"), true, "owner ACE must be protected");

    // §5.5: reading DAV:acl requires DAV:read-acl — sharees don't hold it
    const bobResp = await s.doAs(BOB, BOB_PASS, "PROPFIND", collectionPath("acl-prop"),
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsDAV, "acl"));
    const bobAcl = parseMultistatus(bobResp.body).response(collectionPath("acl-prop"))?.prop("acl");
    assertEquals(bobAcl?.status, 404, "DAV:acl must not be readable without DAV:read-acl");
  });
});

Deno.test("RFC 3744 §5.1 DAV:owner and DAV:current-user-privilege-set are protected from PROPPATCH", async () => {
  await withServer(async (s) => {
    await s.mkcol("protected-props");
    const resp = await s.do("PROPPATCH", collectionPath("protected-props"), xmlContentType(),
      XML_HEADER + '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop>' +
        `<D:owner><D:href>/principals/someone-else</D:href></D:owner>` +
        "</D:prop></D:set></D:propertyupdate>");
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes("403"), true, "PROPPATCH of DAV:owner must fail with 403");
    assertEquals(resp.body.includes("cannot-modify-protected-property"), true);
  });
});

Deno.test("RFC 3744 §4 principal resources expose DAV:principal-URL and DAV:principal-collection-set", async () => {
  await withServer(async (s) => {
    const resp = await s.do("PROPFIND", principalPath,
      { ...depthHeader("0"), ...xmlContentType() },
      propfindProps(nsDAV, "principal-URL", nsDAV, "principal-collection-set"));
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(principalPath);
    assertEquals(r?.prop("principal-URL")?.status, 200, "principal-URL must be present");
    assertEquals(r?.prop("principal-URL")?.text().includes(principalPath), true);
    assertEquals(r?.prop("principal-collection-set")?.status, 200, "principal-collection-set must be present");
    assertEquals(r?.prop("principal-collection-set")?.text().includes("/principals/"), true);
  });
});

// ─── Privilege enforcement for non-granted users ──────────────────────────────

Deno.test("RFC 3744 §5.4 users without a grant are denied — 403 on read and write", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    await s.mkcol("private");
    await s.putEvent("private", "secret");
    // Grant only to bob
    await s.do("ACL", collectionPath("private"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const get = await s.doAs(CAROL, CAROL_PASS, "GET", objectPath("private", "secret"));
    assertEquals(get.status, 403, "non-granted user GET must be 403");

    const pf = await s.doAs(CAROL, CAROL_PASS, "PROPFIND", collectionPath("private"),
      { ...depthHeader("1"), ...xmlContentType() }, propfindProps(nsDAV, "resourcetype"));
    assertEquals(pf.status, 403, "non-granted user PROPFIND must be 403");

    const rep = await s.doAs(CAROL, CAROL_PASS, "REPORT", collectionPath("private"),
      xmlContentType(), calendarQueryByComp("VEVENT"));
    assertEquals(rep.status, 403, "non-granted user REPORT must be 403");
  });
});

Deno.test("RFC 3744 calendar-multiget enforces per-href privileges without leaking data", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    await s.mkcol("mg-shared");
    await s.putEvent("mg-shared", "ev1");
    await s.do("ACL", collectionPath("mg-shared"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const href = objectPath("mg-shared", "ev1");

    // Granted sharee gets calendar data via multiget on the owner's collection
    const bobResp = await s.doAs(BOB, BOB_PASS, "REPORT", collectionPath("mg-shared"),
      xmlContentType(), calendarMultiget(href));
    assertEquals(bobResp.status, 207);
    assertEquals(bobResp.body.includes("BEGIN:VEVENT"), true, "granted sharee must receive calendar-data");

    // Non-granted user targeting the same href from their own collection gets no data
    const carolResp = await s.doAs(CAROL, CAROL_PASS, "REPORT", userCollectionPath(CAROL, "default"),
      xmlContentType(), calendarMultiget(href));
    assertEquals(carolResp.status, 207);
    assertEquals(carolResp.body.includes("BEGIN:VEVENT"), false,
      "multiget must not leak calendar data across users without a grant");
  });
});

Deno.test("RFC 3744 read-write sharee still cannot delete the shared collection (DAV:unbind on home)", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("undeletable");
    await s.do("ACL", collectionPath("undeletable"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read", "write"] }));

    const del = await s.doAs(BOB, BOB_PASS, "DELETE", collectionPath("undeletable"));
    assertEquals(del.status, 403, "sharee DELETE of the collection itself must be 403");
  });
});

// ─── Discovery of shared collections ──────────────────────────────────────────

Deno.test("RFC 4791 §6.2.1 sharee's calendar-home-set gains the owner's home after a grant", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("discoverable");
    await s.do("ACL", collectionPath("discoverable"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const resp = await s.doAs(BOB, BOB_PASS, "PROPFIND", userPrincipalPath(BOB),
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsCalDAV, "calendar-home-set"));
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes(`/calendars/${BOB}`), true, "own home must be listed");
    assertEquals(resp.body.includes("/calendars/owner"), true, "owner's home must be listed after grant");
  });
});

Deno.test("RFC 3744 sharee browsing the owner's home sees only granted collections", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("visible");
    await s.mkcol("invisible");
    await s.do("ACL", collectionPath("visible"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const resp = await s.doAs(BOB, BOB_PASS, "PROPFIND", "/calendars/owner",
      { ...depthHeader("1"), ...xmlContentType() }, propfindProps(nsDAV, "resourcetype"));
    assertEquals(resp.status, 207, `sharee PROPFIND of owner home must succeed: ${resp.body}`);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.response(collectionPath("visible")) !== undefined, true, "granted collection must be listed");
    assertEquals(ms.response(collectionPath("invisible")), undefined, "non-granted collection must not be listed");
    assertEquals(ms.response(collectionPath("default")), undefined, "owner default calendar must not be listed");
  });
});

Deno.test("RFC 5397 current-user-principal on a shared collection is the requester's principal", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("cup-check");
    await s.do("ACL", collectionPath("cup-check"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const resp = await s.doAs(BOB, BOB_PASS, "PROPFIND", collectionPath("cup-check"),
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsDAV, "current-user-principal"));
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const cup = ms.response(collectionPath("cup-check"))?.prop("current-user-principal");
    assertEquals(cup?.status, 200);
    assertEquals(cup?.text().includes(userPrincipalPath(BOB)), true,
      `current-user-principal must be the requester's principal, got: ${cup?.text()}`);
  });
});

Deno.test("RFC 3744 sharee can run calendar-query and sync-collection REPORTs on a shared collection", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.mkcol("reports");
    await s.putEvent("reports", "ev1");
    await s.do("ACL", collectionPath("reports"), xmlContentType(),
      aclBody({ principal: userPrincipalPath(BOB), privileges: ["read"] }));

    const query = await s.doAs(BOB, BOB_PASS, "REPORT", collectionPath("reports"),
      xmlContentType(), calendarQueryByComp("VEVENT"));
    assertEquals(query.status, 207, `sharee calendar-query must succeed: ${query.body}`);
    assertEquals(query.body.includes("BEGIN:VEVENT"), true);

    const sync = await s.doAs(BOB, BOB_PASS, "REPORT", collectionPath("reports"),
      { ...depthHeader("0"), ...xmlContentType() },
      XML_HEADER + '<D:sync-collection xmlns:D="DAV:"><D:sync-token/><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>');
    assertEquals(sync.status, 207, `sharee sync-collection must succeed: ${sync.body}`);
    assertEquals(sync.body.includes(objectPath("reports", "ev1")), true);
  });
});

// ─── §9 Principal reports ─────────────────────────────────────────────────────

Deno.test("RFC 3744 §9.4 principal-property-search by displayname finds matching principals", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    const resp = await s.do("REPORT", "/principals",
      { ...depthHeader("0"), ...xmlContentType() },
      principalPropertySearch("displayname", BOB, "displayname"));
    assertEquals(resp.status, 207, `principal-property-search failed: ${resp.body}`);
    const ms = parseMultistatus(resp.body);
    const r = ms.response(userPrincipalPath(BOB));
    assertEquals(r !== undefined, true, "matching principal must be in the response");
    assertEquals(r?.prop("displayname")?.status, 200);
  });
});

Deno.test("RFC 3744 §9.4 principal-property-search with an empty match returns all principals", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    const resp = await s.do("REPORT", "/principals",
      { ...depthHeader("0"), ...xmlContentType() },
      principalPropertySearch("displayname", "", "displayname"));
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.len() >= 3, true, `all principals must match an empty substring, got ${ms.len()}`);
    assertEquals(ms.response(userPrincipalPath(BOB)) !== undefined, true);
    assertEquals(ms.response(userPrincipalPath(CAROL)) !== undefined, true);
  });
});

Deno.test("RFC 3744 §9.4 principal-property-search is available to non-admin users", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    await s.createUser(CAROL, "carol@example.com", CAROL_PASS);
    const resp = await s.doAs(BOB, BOB_PASS, "REPORT", "/principals",
      { ...depthHeader("0"), ...xmlContentType() },
      principalPropertySearch("displayname", CAROL, "displayname"));
    assertEquals(resp.status, 207, "non-admin principal search must succeed");
    assertEquals(parseMultistatus(resp.body).response(userPrincipalPath(CAROL)) !== undefined, true);
  });
});

Deno.test("RFC 3744 §9.5 principal-search-property-set lists the searchable properties", async () => {
  await withServer(async (s) => {
    const resp = await s.do("REPORT", "/principals",
      { ...depthHeader("0"), ...xmlContentType() },
      XML_HEADER + '<D:principal-search-property-set xmlns:D="DAV:"/>');
    assertEquals(resp.status, 200, `principal-search-property-set failed: ${resp.body}`);
    assertEquals(resp.body.includes("displayname"), true, "displayname must be a searchable property");
  });
});

Deno.test("RFC 3744 §9.3 principal-match returns the authenticated user's principal", async () => {
  await withServer(async (s) => {
    await s.createUser(BOB, "bob@example.com", BOB_PASS);
    const resp = await s.doAs(BOB, BOB_PASS, "REPORT", "/principals",
      { ...depthHeader("0"), ...xmlContentType() },
      XML_HEADER + '<D:principal-match xmlns:D="DAV:"><D:self/><D:prop><D:displayname/></D:prop></D:principal-match>');
    assertEquals(resp.status, 207, `principal-match failed: ${resp.body}`);
    const ms = parseMultistatus(resp.body);
    assertEquals(ms.len(), 1, "principal-match must return exactly the requesting principal");
    assertEquals(ms.response(userPrincipalPath(BOB)) !== undefined, true);
  });
});

Deno.test("RFC 3744 §9 principal reports are advertised in supported-report-set on principals", async () => {
  await withServer(async (s) => {
    const resp = await s.do("PROPFIND", principalPath,
      { ...depthHeader("0"), ...xmlContentType() }, propfindProps(nsDAV, "supported-report-set"));
    assertEquals(resp.status, 207);
    assertEquals(resp.body.includes("principal-property-search"), true);
    assertEquals(resp.body.includes("principal-search-property-set"), true);
    assertEquals(resp.body.includes("principal-match"), true);
  });
});
