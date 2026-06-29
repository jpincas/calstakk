// RFC 8607 — Managed Attachments for Calendar Data in CalDAV
// Spec: specs/rfc8607.txt
//
// Coverage:
//   §3   Attachment management via POST
//   §4   ATTACH property with MANAGED-ID parameter
//   §5   Attachment-related CalDAV properties (max-attachment-size, etc.)

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  collectionPath,
  nsCalDAV,
  objectPath,
  parseMultistatus,
  propfindProps,
  withHeaders,
  withServer,
  xmlContentType,
} from "./harness.ts";

// ─── §5 Attachment capacity properties ────────────────────────────────────────

Deno.test("RFC 8607 §5.1 max-attachment-size appears in PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-cap-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("attach-cap-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachment-size"),
    );
    assertEquals(resp.status, 207);
    const r = parseMultistatus(resp.body).response(collectionPath("attach-cap-col"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("max-attachment-size") !== undefined,
      true,
      "max-attachment-size must appear in PROPFIND propstat",
    );
  });
});

Deno.test("RFC 8607 §5.2 max-attachments-per-resource appears in PROPFIND", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-num-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("attach-num-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachments-per-resource"),
    );
    assertEquals(resp.status, 207);
    const r = parseMultistatus(resp.body).response(collectionPath("attach-num-col"));
    assertEquals(r !== undefined, true);
    assertEquals(
      r!.prop("max-attachments-per-resource") !== undefined,
      true,
      "max-attachments-per-resource must appear in PROPFIND propstat",
    );
  });
});

// ─── §3 Attachment management via POST ────────────────────────────────────────

Deno.test("RFC 8607 §3.2 POST to add managed attachment must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-col");
    await s.putEvent("attach-col", "attach-evt");

    const resp = await s.do(
      "POST",
      objectPath("attach-col", "attach-evt"),
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=notes.txt",
      },
      "Meeting notes content here.\n",
    );
    assertEquals(resp.status < 500, true, "POST to add managed attachment must not cause 5xx");

    if (resp.status === 201) {
      assertEquals(
        (resp.headers.get("Cal-Managed-ID") ?? "") !== "",
        true,
        "POST response must include Cal-Managed-ID header",
      );
      assertEquals(
        (resp.headers.get("Location") ?? "") !== "",
        true,
        "POST response must include Location header",
      );
    }
  });
});

Deno.test("RFC 8607 §3.3 POST attachment with Prefer:return=representation must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-prefer-col");
    await s.putEvent("attach-prefer-col", "pref-evt");

    const resp = await s.do(
      "POST",
      objectPath("attach-prefer-col", "pref-evt"),
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=doc.txt",
        "Prefer": "return=representation",
      },
      "Document content.\n",
    );
    assertEquals(
      resp.status < 500,
      true,
      "POST attachment with Prefer:return=representation must not cause 5xx",
    );

    if (resp.status === 201) {
      assertStringIncludes(
        resp.headers.get("Content-Type") ?? "",
        "calendar",
        "response Content-Type should indicate calendar data",
      );
    }
  });
});

Deno.test("RFC 8607 §3.4 POST to remove managed attachment must not cause 5xx", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-rm-col");
    await s.putEvent("attach-rm-col", "rm-evt");

    const addResp = await s.do(
      "POST",
      objectPath("attach-rm-col", "rm-evt"),
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=todelete.txt",
      },
      "Content to delete.\n",
    );
    if (addResp.status !== 201) return; // managed attachments not supported

    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";

    const resp = await s.do(
      "POST",
      objectPath("attach-rm-col", "rm-evt"),
      { "Cal-Managed-ID": managedID },
      "",
    );
    assertEquals(resp.status < 500, true, "POST to remove attachment must not cause 5xx");
  });
});

// ─── §4 ATTACH property with MANAGED-ID ───────────────────────────────────────

Deno.test("RFC 8607 §4 ATTACH after add must have MANAGED-ID parameter", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-prop-col");
    await s.putEvent("attach-prop-col", "mgid-evt");

    const addResp = await s.do(
      "POST",
      objectPath("attach-prop-col", "mgid-evt"),
      {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=report.pdf",
      },
      "%PDF-1.4 mock content",
    );
    if (addResp.status !== 201) return; // managed attachments not supported

    const getResp = await s.do("GET", objectPath("attach-prop-col", "mgid-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "ATTACH", "updated event must contain ATTACH property");
    assertStringIncludes(getResp.body, "MANAGED-ID=", "ATTACH must contain MANAGED-ID parameter");
  });
});

Deno.test("RFC 8607 §4 managed attachment must be accessible at Location URI", async () => {
  await withServer(async (s) => {
    await s.mkcol("attach-access-col");
    await s.putEvent("attach-access-col", "access-evt");

    const addResp = await s.do(
      "POST",
      objectPath("attach-access-col", "access-evt"),
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=readme.txt",
      },
      "This is the attachment content.\n",
    );
    if (addResp.status !== 201) return; // managed attachments not supported

    const location = addResp.headers.get("Location") ?? "";
    assertEquals(location !== "", true, "Location header must be present");

    const resp = await s.do("GET", location);
    assertEquals(resp.status, 200, "managed attachment must be retrievable at Location URI");
    assertStringIncludes(resp.body, "This is the attachment content.");
  });
});
