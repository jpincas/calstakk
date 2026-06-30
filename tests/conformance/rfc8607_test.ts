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

// ─── §3.2 OPTIONS capability advertisement ────────────────────────────────────

Deno.test("RFC 8607 §3.2 OPTIONS on calendar home must advertise calendar-managed-attachments in DAV header", async () => {
  await withServer(async (s) => {
    const resp = await s.do("OPTIONS", "/calstakk/calendars");
    assertEquals(resp.status < 500, true, "OPTIONS must not return 5xx");
    const dav = resp.headers.get("DAV") ?? "";
    assertStringIncludes(
      dav,
      "calendar-managed-attachments",
      "DAV response header from OPTIONS on calendar home MUST include calendar-managed-attachments token",
    );
  });
});

Deno.test("RFC 8607 §3.2 OPTIONS must include calendar-managed-attachments-no-recurrence when per-instance attachments unsupported", async () => {
  await withServer(async (s) => {
    await s.mkcol("norec-opt-col");
    await s.putEvent("norec-opt-col", "norec-opt-evt", "RRULE:FREQ=DAILY;COUNT=3");

    const optResp = await s.do("OPTIONS", "/calstakk/calendars");
    const dav = optResp.headers.get("DAV") ?? "";

    // Probe whether the server accepts a per-instance attachment-add
    const probeResp = await s.do(
      "POST",
      objectPath("norec-opt-col", "norec-opt-evt") + "?action=attachment-add&rid=20260116T100000Z",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=probe.txt" },
      "probe",
    );
    // If the server rejected the per-instance operation it MUST advertise the no-recurrence token
    if (probeResp.status < 200 || probeResp.status >= 300) {
      assertStringIncludes(
        dav,
        "calendar-managed-attachments-no-recurrence",
        "DAV header MUST include calendar-managed-attachments-no-recurrence when per-instance ops are unsupported",
      );
    }
    // If the server accepted it, no-recurrence token absence is correct per RFC
  });
});

// ─── §3.3.1 action query parameter ────────────────────────────────────────────

Deno.test("RFC 8607 §3.3.1 POST for attachment-add must include action=attachment-add query parameter", async () => {
  await withServer(async (s) => {
    await s.mkcol("action-qp-col");
    await s.putEvent("action-qp-col", "action-qp-evt");

    // POST with action=attachment-add must be accepted (not 5xx)
    const withAction = await s.do(
      "POST",
      objectPath("action-qp-col", "action-qp-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=qp.txt" },
      "test content",
    );
    assertEquals(
      withAction.status < 500,
      true,
      "POST with action=attachment-add must not cause 5xx",
    );

    // POST without any action parameter — the RFC says action MUST be present; server MUST reject
    const withoutAction = await s.do(
      "POST",
      objectPath("action-qp-col", "action-qp-evt"),
      { "Content-Type": "text/plain" },
      "test content",
    );
    assertEquals(
      withoutAction.status >= 200 && withoutAction.status < 300,
      false,
      `POST without action= query parameter must be rejected (non-2xx); got ${withoutAction.status}`,
    );
  });
});

// ─── §3.4 ATTACH property parameters ─────────────────────────────────────────

Deno.test("RFC 8607 §3.4 ATTACH added by server must carry FMTTYPE matching request Content-Type", async () => {
  await withServer(async (s) => {
    await s.mkcol("fmttype-col");
    await s.putEvent("fmttype-col", "fmttype-evt");

    const addResp = await s.do(
      "POST",
      objectPath("fmttype-col", "fmttype-evt") + "?action=attachment-add",
      {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=report.pdf",
      },
      "%PDF-1.4 test content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return; // managed attachments not implemented

    const getResp = await s.do("GET", objectPath("fmttype-col", "fmttype-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      "FMTTYPE=application/pdf",
      "ATTACH property MUST carry FMTTYPE parameter matching the Content-Type from the add request",
    );
  });
});

Deno.test("RFC 8607 §3.4 ATTACH added by server must carry FILENAME matching Content-Disposition filename", async () => {
  await withServer(async (s) => {
    await s.mkcol("filename-col");
    await s.putEvent("filename-col", "filename-evt");

    const addResp = await s.do(
      "POST",
      objectPath("filename-col", "filename-evt") + "?action=attachment-add",
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=myfile.txt",
      },
      "file content here",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;

    const getResp = await s.do("GET", objectPath("filename-col", "filename-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      "FILENAME=myfile.txt",
      "ATTACH property MUST carry FILENAME parameter matching the Content-Disposition filename",
    );
  });
});

Deno.test("RFC 8607 §3.4 ATTACH added by server must carry SIZE equal to attachment body octet count", async () => {
  await withServer(async (s) => {
    await s.mkcol("size-col");
    await s.putEvent("size-col", "size-evt");

    const content = "Hello, world! This is the attachment.\n";
    const byteCount = new TextEncoder().encode(content).length;

    const addResp = await s.do(
      "POST",
      objectPath("size-col", "size-evt") + "?action=attachment-add",
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=size-test.txt",
      },
      content,
    );
    if (addResp.status < 200 || addResp.status >= 300) return;

    const getResp = await s.do("GET", objectPath("size-col", "size-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      `SIZE=${byteCount}`,
      `ATTACH property MUST carry SIZE=${byteCount} matching the attachment body octet count`,
    );
  });
});

Deno.test("RFC 8607 §3.4 Cal-Managed-ID header must be present and non-empty on any 2xx response to attachment-add", async () => {
  await withServer(async (s) => {
    await s.mkcol("cmid-2xx-col");
    await s.putEvent("cmid-2xx-col", "cmid-2xx-evt");

    const resp = await s.do(
      "POST",
      objectPath("cmid-2xx-col", "cmid-2xx-evt") + "?action=attachment-add",
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=data.txt",
      },
      "attachment data",
    );
    if (resp.status < 200 || resp.status >= 300) return; // feature not implemented

    const calManagedID = resp.headers.get("Cal-Managed-ID");
    assertEquals(
      calManagedID !== null && calManagedID !== "",
      true,
      `Cal-Managed-ID header MUST be present and non-empty on ${resp.status} response to attachment-add`,
    );
  });
});

Deno.test("RFC 8607 §3.4 attachment-add with rid for non-existing instance must create overridden component with RECURRENCE-ID", async () => {
  await withServer(async (s) => {
    await s.mkcol("rid-create-col");
    // Recurring event: 5 daily instances starting 20260115T100000Z; second = 20260116T100000Z
    await s.putEvent("rid-create-col", "rid-create-evt", "RRULE:FREQ=DAILY;COUNT=5");

    // Target the second instance which has no override component yet
    const addResp = await s.do(
      "POST",
      objectPath("rid-create-col", "rid-create-evt") +
        "?action=attachment-add&rid=20260116T100000Z",
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=override.txt",
      },
      "override content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return; // per-instance not supported

    const getResp = await s.do("GET", objectPath("rid-create-col", "rid-create-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      "RECURRENCE-ID",
      "Server MUST create an overridden component with RECURRENCE-ID for a targeted non-existing instance",
    );
    assertStringIncludes(
      getResp.body,
      "20260116T100000Z",
      "Overridden component must carry the RECURRENCE-ID value matching the targeted instance",
    );
  });
});

// ─── §3.5 Updating attachments ────────────────────────────────────────────────

Deno.test("RFC 8607 §3.5 POST attachment-update must change MANAGED-ID parameter value in calendar data", async () => {
  await withServer(async (s) => {
    await s.mkcol("update-mgid-col");
    await s.putEvent("update-mgid-col", "update-mgid-evt");

    const addResp = await s.do(
      "POST",
      objectPath("update-mgid-col", "update-mgid-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=v1.txt" },
      "version 1 content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const oldManagedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!oldManagedID) return;

    const updateResp = await s.do(
      "POST",
      objectPath("update-mgid-col", "update-mgid-evt") +
        `?action=attachment-update&managed-id=${encodeURIComponent(oldManagedID)}`,
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=v2.txt" },
      "version 2 content",
    );
    if (updateResp.status < 200 || updateResp.status >= 300) return;

    const newManagedID = updateResp.headers.get("Cal-Managed-ID") ?? "";
    assertEquals(
      newManagedID !== "" && newManagedID !== oldManagedID,
      true,
      `MANAGED-ID MUST change on update; old="${oldManagedID}" new="${newManagedID}"`,
    );

    const getResp = await s.do("GET", objectPath("update-mgid-col", "update-mgid-evt"));
    assertEquals(getResp.status, 200);
    assertEquals(
      getResp.body.includes(`MANAGED-ID=${oldManagedID}`),
      false,
      "Old MANAGED-ID must not appear in calendar data after attachment-update",
    );
  });
});

Deno.test("RFC 8607 §3.5 Cal-Managed-ID in attachment-update response must reflect new MANAGED-ID value", async () => {
  await withServer(async (s) => {
    await s.mkcol("update-cmid-col");
    await s.putEvent("update-cmid-col", "update-cmid-evt");

    const addResp = await s.do(
      "POST",
      objectPath("update-cmid-col", "update-cmid-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=orig.txt" },
      "original content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const oldID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!oldID) return;

    const updateResp = await s.do(
      "POST",
      objectPath("update-cmid-col", "update-cmid-evt") +
        `?action=attachment-update&managed-id=${encodeURIComponent(oldID)}`,
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=updated.txt" },
      "updated content",
    );
    if (updateResp.status < 200 || updateResp.status >= 300) return;

    const newID = updateResp.headers.get("Cal-Managed-ID") ?? "";
    assertEquals(newID !== "", true, "Cal-Managed-ID MUST be present in the attachment-update response");
    assertEquals(
      newID !== oldID,
      true,
      `Cal-Managed-ID in update response MUST differ from original; old="${oldID}" new="${newID}"`,
    );
  });
});

Deno.test("RFC 8607 §3.5 attachment-update must refresh FMTTYPE FILENAME and SIZE on the ATTACH property", async () => {
  await withServer(async (s) => {
    await s.mkcol("update-params-col");
    await s.putEvent("update-params-col", "update-params-evt");

    const addResp = await s.do(
      "POST",
      objectPath("update-params-col", "update-params-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=old.txt" },
      "old",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const oldID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!oldID) return;

    const newContent = "new updated content for the attachment";
    const newSize = new TextEncoder().encode(newContent).length;

    const updateResp = await s.do(
      "POST",
      objectPath("update-params-col", "update-params-evt") +
        `?action=attachment-update&managed-id=${encodeURIComponent(oldID)}`,
      {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=new.bin",
      },
      newContent,
    );
    if (updateResp.status < 200 || updateResp.status >= 300) return;

    const getResp = await s.do("GET", objectPath("update-params-col", "update-params-evt"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      "FMTTYPE=application/octet-stream",
      "FMTTYPE must be updated to reflect new Content-Type after attachment-update",
    );
    assertStringIncludes(
      getResp.body,
      "FILENAME=new.bin",
      "FILENAME must be updated to reflect new Content-Disposition filename after attachment-update",
    );
    assertStringIncludes(
      getResp.body,
      `SIZE=${newSize}`,
      `SIZE must be updated to reflect new attachment size (${newSize}) after attachment-update`,
    );
  });
});

// ─── §3.6 Removing attachments ────────────────────────────────────────────────

Deno.test("RFC 8607 §3.6 POST attachment-remove must use action=attachment-remove and managed-id query parameters", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-qp-col");
    await s.putEvent("rm-qp-col", "rm-qp-evt");

    const addResp = await s.do(
      "POST",
      objectPath("rm-qp-col", "rm-qp-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=torm.txt" },
      "to be removed",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!managedID) return;

    // Remove using the correct RFC protocol: POST?action=attachment-remove&managed-id=<id>
    const removeResp = await s.do(
      "POST",
      objectPath("rm-qp-col", "rm-qp-evt") +
        `?action=attachment-remove&managed-id=${encodeURIComponent(managedID)}`,
      {},
      "",
    );
    assertEquals(
      removeResp.status >= 200 && removeResp.status < 300,
      true,
      `POST?action=attachment-remove&managed-id=… must return 2xx; got ${removeResp.status}`,
    );
  });
});

Deno.test("RFC 8607 §3.6 GET after attachment-remove must not contain removed ATTACH property", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-get-col");
    await s.putEvent("rm-get-col", "rm-get-evt");

    const addResp = await s.do(
      "POST",
      objectPath("rm-get-col", "rm-get-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=rmget.txt" },
      "content to remove",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!managedID) return;

    const removeResp = await s.do(
      "POST",
      objectPath("rm-get-col", "rm-get-evt") +
        `?action=attachment-remove&managed-id=${encodeURIComponent(managedID)}`,
      {},
      "",
    );
    if (removeResp.status < 200 || removeResp.status >= 300) return;

    const getResp = await s.do("GET", objectPath("rm-get-col", "rm-get-evt"));
    assertEquals(getResp.status, 200);
    assertEquals(
      getResp.body.includes(`MANAGED-ID=${managedID}`),
      false,
      "After attachment-remove the ATTACH property with the removed MANAGED-ID must not appear in calendar data",
    );
  });
});

Deno.test("RFC 8607 §3.6 attachment-remove with Prefer return=representation must return updated calendar in body", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-prefer-col");
    await s.putEvent("rm-prefer-col", "rm-prefer-evt");

    const addResp = await s.do(
      "POST",
      objectPath("rm-prefer-col", "rm-prefer-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=p.txt" },
      "prefer content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!managedID) return;

    const removeResp = await s.do(
      "POST",
      objectPath("rm-prefer-col", "rm-prefer-evt") +
        `?action=attachment-remove&managed-id=${encodeURIComponent(managedID)}`,
      { "Prefer": "return=representation" },
      "",
    );
    if (removeResp.status < 200 || removeResp.status >= 300) return;

    // If the server honoured return=representation it returns 200 with a body
    if (removeResp.status === 200) {
      assertStringIncludes(
        removeResp.body,
        "BEGIN:VCALENDAR",
        "Response body MUST contain the updated calendar when Prefer:return=representation is used on remove",
      );
      assertEquals(
        removeResp.body.includes(`MANAGED-ID=${managedID}`),
        false,
        "Returned calendar must not include the removed ATTACH property",
      );
    }
  });
});

// ─── §3.7 Adding existing managed attachments via PUT ─────────────────────────

Deno.test("RFC 8607 §3.7 PUT with existing ATTACH MANAGED-ID must be accepted and MANAGED-ID must be preserved", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-mgid-col");
    await s.putEvent("put-mgid-col", "put-mgid-src");

    // Add attachment to source event
    const addResp = await s.do(
      "POST",
      objectPath("put-mgid-col", "put-mgid-src") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=shared.txt" },
      "shared attachment content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    const location = addResp.headers.get("Location") ?? "";
    if (!managedID || !location) return;

    // Build a new event referencing the existing managed attachment
    const newEventBody =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:put-mgid-dst\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with existing attachment\r\n" +
      `ATTACH;MANAGED-ID=${managedID};FMTTYPE=text/plain:${location}\r\n` +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";

    const putResp = await s.do(
      "PUT",
      objectPath("put-mgid-col", "put-mgid-dst"),
      { "Content-Type": "text/calendar; charset=utf-8" },
      newEventBody,
    );
    assertEquals(
      putResp.status === 201 || putResp.status === 204,
      true,
      `PUT with existing ATTACH MANAGED-ID must be accepted (201 or 204); got ${putResp.status}`,
    );

    const getResp = await s.do("GET", objectPath("put-mgid-col", "put-mgid-dst"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(
      getResp.body,
      `MANAGED-ID=${managedID}`,
      "MANAGED-ID must be preserved in the stored calendar object after PUT with existing attachment",
    );
  });
});

// ─── §3.8 PUT to attachment URI must be rejected ──────────────────────────────

Deno.test("RFC 8607 §3.8 PUT to attachment URI must be rejected by the server", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-attach-col");
    await s.putEvent("put-attach-col", "put-attach-evt");

    const addResp = await s.do(
      "POST",
      objectPath("put-attach-col", "put-attach-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=att.txt" },
      "attachment content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const location = addResp.headers.get("Location") ?? "";
    if (!location) return;

    // Derive a path suitable for s.do (strip absolute prefix if present)
    let attachPath: string;
    try {
      attachPath = new URL(location).pathname;
    } catch {
      attachPath = location;
    }

    const putResp = await s.do(
      "PUT",
      attachPath,
      { "Content-Type": "text/plain" },
      "modified content",
    );
    assertEquals(
      putResp.status >= 400,
      true,
      `PUT to attachment URI MUST be rejected with 4xx; got ${putResp.status}`,
    );
  });
});

// ─── §3.9 DELETE to attachment URI must be rejected ───────────────────────────

Deno.test("RFC 8607 §3.9 DELETE to attachment URI must be rejected by the server", async () => {
  await withServer(async (s) => {
    await s.mkcol("del-attach-col");
    await s.putEvent("del-attach-col", "del-attach-evt");

    const addResp = await s.do(
      "POST",
      objectPath("del-attach-col", "del-attach-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=del.txt" },
      "deletable content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const location = addResp.headers.get("Location") ?? "";
    if (!location) return;

    let attachPath: string;
    try {
      attachPath = new URL(location).pathname;
    } catch {
      attachPath = location;
    }

    const deleteResp = await s.do("DELETE", attachPath);
    assertEquals(
      deleteResp.status >= 400,
      true,
      `DELETE to attachment URI MUST be rejected with 4xx; got ${deleteResp.status}`,
    );
  });
});

// ─── §3.11 Error handling / preconditions ─────────────────────────────────────

Deno.test("RFC 8607 §3.11 POST with invalid action value must return 403/409 with CALDAV:valid-action DAV:error", async () => {
  await withServer(async (s) => {
    await s.mkcol("invalid-action-col");
    await s.putEvent("invalid-action-col", "invalid-action-evt");

    const resp = await s.do(
      "POST",
      objectPath("invalid-action-col", "invalid-action-evt") + "?action=bogus-action",
      { "Content-Type": "text/plain" },
      "content",
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `POST with invalid action= must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "valid-action",
      "Response body must contain CALDAV:valid-action in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 POST attachment-update with rid must return 403/409 with CALDAV:valid-rid DAV:error", async () => {
  await withServer(async (s) => {
    await s.mkcol("valid-rid-col");
    await s.putEvent("valid-rid-col", "valid-rid-evt", "RRULE:FREQ=DAILY;COUNT=3");

    // First add an attachment to obtain a valid managed-id
    const addResp = await s.do(
      "POST",
      objectPath("valid-rid-col", "valid-rid-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=f.txt" },
      "content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!managedID) return;

    // attachment-update MUST NOT carry a rid parameter (RFC §3.3.2)
    const resp = await s.do(
      "POST",
      objectPath("valid-rid-col", "valid-rid-evt") +
        `?action=attachment-update&managed-id=${encodeURIComponent(managedID)}&rid=20260116T100000Z`,
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=f2.txt" },
      "updated content",
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `attachment-update with rid= must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "valid-rid",
      "Response body must contain CALDAV:valid-rid in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 POST attachment-add with managed-id must return 403/409 with CALDAV:valid-managed-id DAV:error", async () => {
  await withServer(async (s) => {
    await s.mkcol("add-mgid-err-col");
    await s.putEvent("add-mgid-err-col", "add-mgid-err-evt");

    // attachment-add MUST NOT carry a managed-id parameter (RFC §3.3.3)
    const resp = await s.do(
      "POST",
      objectPath("add-mgid-err-col", "add-mgid-err-evt") +
        "?action=attachment-add&managed-id=FAKEID",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=f.txt" },
      "content",
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `attachment-add with managed-id= must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "valid-managed-id",
      "Response body must contain CALDAV:valid-managed-id in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 attachment-remove with non-existent managed-id must return 403/409 with CALDAV:valid-managed-id", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-nonexist-col");
    await s.putEvent("rm-nonexist-col", "rm-nonexist-evt");

    const resp = await s.do(
      "POST",
      objectPath("rm-nonexist-col", "rm-nonexist-evt") +
        "?action=attachment-remove&managed-id=DOESNOTEXIST",
      {},
      "",
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `attachment-remove with non-existent managed-id must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "valid-managed-id",
      "Response body must contain CALDAV:valid-managed-id in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 PUT with invalid MANAGED-ID parameter must return 403/409 with CALDAV:valid-managed-id-parameter", async () => {
  await withServer(async (s) => {
    await s.mkcol("put-invalid-mgid-col");

    const body =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:put-invalid-mgid\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Event with invalid MANAGED-ID\r\n" +
      "ATTACH;MANAGED-ID=NONEXISTENTID:https://example.com/attachment.txt\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";

    const resp = await s.do(
      "PUT",
      objectPath("put-invalid-mgid-col", "put-invalid-mgid"),
      { "Content-Type": "text/calendar; charset=utf-8" },
      body,
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `PUT with invalid MANAGED-ID parameter must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "valid-managed-id-parameter",
      "Response body must contain CALDAV:valid-managed-id-parameter in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 POST attachment exceeding max-attachment-size must return 403/409 with CALDAV:max-attachment-size error", async () => {
  await withServer(async (s) => {
    await s.mkcol("max-sz-col");
    await s.putEvent("max-sz-col", "max-sz-evt");

    // Discover the limit via PROPFIND; skip if the property is absent or too large to test
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("max-sz-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachment-size"),
    );
    if (pfResp.status !== 207) return;
    const sizeProp = parseMultistatus(pfResp.body)
      .response(collectionPath("max-sz-col"))
      ?.prop("max-attachment-size");
    if (!sizeProp || sizeProp.status !== 200 || !sizeProp.text()) return;
    const maxSize = parseInt(sizeProp.text(), 10);
    if (!maxSize || maxSize > 10 * 1024 * 1024) return; // too large to test practically

    const oversized = "A".repeat(maxSize + 1);
    const resp = await s.do(
      "POST",
      objectPath("max-sz-col", "max-sz-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=big.txt" },
      oversized,
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `Attachment exceeding max-attachment-size must return 403 or 409; got ${resp.status}`,
    );
    assertStringIncludes(
      resp.body,
      "max-attachment-size",
      "Response body must contain CALDAV:max-attachment-size in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 POST attachment-add that exceeds max-attachments-per-resource must return 403/409 with correct DAV:error", async () => {
  await withServer(async (s) => {
    await s.mkcol("max-per-res-col");
    await s.putEvent("max-per-res-col", "max-per-res-evt");

    // Discover the per-resource limit; skip if absent or too high to test
    const pfResp = await s.do(
      "PROPFIND",
      collectionPath("max-per-res-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachments-per-resource"),
    );
    if (pfResp.status !== 207) return;
    const limitProp = parseMultistatus(pfResp.body)
      .response(collectionPath("max-per-res-col"))
      ?.prop("max-attachments-per-resource");
    if (!limitProp || limitProp.status !== 200 || !limitProp.text()) return;
    const maxCount = parseInt(limitProp.text(), 10);
    if (!maxCount || maxCount > 20) return; // skip if limit is impractically high

    // Add attachments up to and past the limit; track the last response
    let lastStatus = -1;
    let lastBody = "";
    for (let i = 0; i <= maxCount; i++) {
      const r = await s.do(
        "POST",
        objectPath("max-per-res-col", "max-per-res-evt") + "?action=attachment-add",
        {
          "Content-Type": "text/plain",
          "Content-Disposition": `attachment; filename=f${i}.txt`,
        },
        `content ${i}`,
      );
      lastStatus = r.status;
      lastBody = r.body;
      if (r.status < 200 || r.status >= 300) break;
    }

    assertEquals(
      lastStatus === 403 || lastStatus === 409,
      true,
      `Adding attachment beyond max-attachments-per-resource must return 403 or 409; got ${lastStatus}`,
    );
    assertStringIncludes(
      lastBody,
      "max-attachments-per-resource",
      "Response body must contain CALDAV:max-attachments-per-resource in a DAV:error element",
    );
  });
});

Deno.test("RFC 8607 §3.11 precondition failure response body must be DAV:error XML with correct child element", async () => {
  await withServer(async (s) => {
    await s.mkcol("precond-body-col");
    await s.putEvent("precond-body-col", "precond-body-evt");

    // Trigger CALDAV:valid-action by using an invalid action value
    const resp = await s.do(
      "POST",
      objectPath("precond-body-col", "precond-body-evt") + "?action=invalid-action-xyz",
      { "Content-Type": "text/plain" },
      "content",
    );
    assertEquals(
      resp.status === 403 || resp.status === 409,
      true,
      `Precondition failure must return 403 or 409; got ${resp.status}`,
    );
    // Body MUST contain a top-level DAV:error element with the appropriate child
    assertStringIncludes(
      resp.body,
      "error",
      "Precondition failure response body MUST contain a DAV:error element",
    );
    assertStringIncludes(
      resp.body,
      "valid-action",
      "DAV:error body must contain the CALDAV:valid-action child element",
    );
  });
});

// ─── §5.1 Cal-Managed-ID header constraints ───────────────────────────────────

Deno.test("RFC 8607 §5.1 Cal-Managed-ID must not appear in response to successful attachment-remove", async () => {
  await withServer(async (s) => {
    await s.mkcol("rm-no-cmid-col");
    await s.putEvent("rm-no-cmid-col", "rm-no-cmid-evt");

    const addResp = await s.do(
      "POST",
      objectPath("rm-no-cmid-col", "rm-no-cmid-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=rmid.txt" },
      "remove me",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;
    const managedID = addResp.headers.get("Cal-Managed-ID") ?? "";
    if (!managedID) return;

    const removeResp = await s.do(
      "POST",
      objectPath("rm-no-cmid-col", "rm-no-cmid-evt") +
        `?action=attachment-remove&managed-id=${encodeURIComponent(managedID)}`,
      {},
      "",
    );
    if (removeResp.status < 200 || removeResp.status >= 300) return;

    assertEquals(
      removeResp.headers.get("Cal-Managed-ID"),
      null,
      "Cal-Managed-ID header MUST NOT be present in the response to attachment-remove",
    );
  });
});

Deno.test("RFC 8607 §5.1 Cal-Managed-ID must appear exactly once in successful add/update response", async () => {
  await withServer(async (s) => {
    await s.mkcol("cmid-once-col");
    await s.putEvent("cmid-once-col", "cmid-once-evt");

    const addResp = await s.do(
      "POST",
      objectPath("cmid-once-col", "cmid-once-evt") + "?action=attachment-add",
      { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=once.txt" },
      "once content",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;

    const cmid = addResp.headers.get("Cal-Managed-ID") ?? "";
    assertEquals(cmid !== "", true, "Cal-Managed-ID must be present in add response");
    // The Fetch API joins duplicate headers with ", ". Cal-Managed-ID is paramtext and
    // must not contain commas, so any comma in the value indicates a duplicate header.
    assertEquals(
      cmid.includes(","),
      false,
      "Cal-Managed-ID MUST appear exactly once; comma in the value indicates duplicate headers",
    );
  });
});

// ─── §6.1 managed-attachments-server-URL property ────────────────────────────

Deno.test("RFC 8607 §6.1 PROPFIND on calendar home must return managed-attachments-server-URL with valid content if present", async () => {
  await withServer(async (s) => {
    const resp = await s.do(
      "PROPFIND",
      "/calstakk/calendars",
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "managed-attachments-server-URL"),
    );
    assertEquals(resp.status, 207);
    const ms = parseMultistatus(resp.body);
    const prop = ms.response("/calstakk/calendars")?.prop("managed-attachments-server-URL");
    // Property MAY be defined; when present and 200 with a href, validate the URI
    if (prop && prop.status === 200 && prop.text() !== "") {
      const href = prop.text().trim();
      assertEquals(
        href.startsWith("https://"),
        true,
        `managed-attachments-server-URL DAV:href must start with https://; got "${href}"`,
      );
      const parsed = new URL(href);
      assertEquals(
        parsed.pathname === "/" || parsed.pathname === "",
        true,
        `managed-attachments-server-URL must contain only scheme and authority (no path); got pathname="${parsed.pathname}"`,
      );
    }
  });
});

Deno.test("RFC 8607 §6.1 PROPPATCH to set managed-attachments-server-URL must be rejected as protected", async () => {
  await withServer(async (s) => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<C:managed-attachments-server-URL>" +
      "<D:href>https://evil.example.com</D:href>" +
      "</C:managed-attachments-server-URL>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";

    const resp = await s.do(
      "PROPPATCH",
      "/calstakk/calendars",
      xmlContentType(),
      body,
    );
    // Must be rejected: 403 directly, or 207 with a 403 propstat for the property
    const isDirectForbid = resp.status === 403;
    const isMultistatusWithForbid =
      resp.status === 207 &&
      resp.body.includes("managed-attachments-server-URL") &&
      (resp.body.includes("403") || resp.body.includes("Forbidden") || resp.body.includes("protected"));
    assertEquals(
      isDirectForbid || isMultistatusWithForbid,
      true,
      `PROPPATCH on protected managed-attachments-server-URL must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 8607 §6.1 PROPFIND allprop must not include managed-attachments-server-URL", async () => {
  await withServer(async (s) => {
    const allpropBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

    const resp = await s.do(
      "PROPFIND",
      "/calstakk/calendars",
      withHeaders({ Depth: "0" }, xmlContentType()),
      allpropBody,
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("managed-attachments-server-URL"),
      false,
      "PROPFIND allprop MUST NOT include managed-attachments-server-URL (allprop behavior: SHOULD NOT)",
    );
  });
});

// ─── §6.2 max-attachment-size property ────────────────────────────────────────

Deno.test("RFC 8607 §6.2 PROPPATCH to set max-attachment-size must be rejected as protected", async () => {
  await withServer(async (s) => {
    await s.mkcol("protected-mas-col");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<C:max-attachment-size>1</C:max-attachment-size>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("protected-mas-col"),
      xmlContentType(),
      body,
    );
    const isDirectForbid = resp.status === 403;
    const isMultistatusWithForbid =
      resp.status === 207 &&
      (resp.body.includes("403") || resp.body.includes("Forbidden") || resp.body.includes("protected"));
    assertEquals(
      isDirectForbid || isMultistatusWithForbid,
      true,
      `PROPPATCH on protected max-attachment-size must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 8607 §6.2 max-attachment-size value must be a positive decimal integer", async () => {
  await withServer(async (s) => {
    await s.mkcol("mas-value-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("mas-value-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachment-size"),
    );
    assertEquals(resp.status, 207);
    const prop = parseMultistatus(resp.body)
      .response(collectionPath("mas-value-col"))
      ?.prop("max-attachment-size");
    if (!prop || prop.status !== 200 || !prop.text()) return; // property not present; skip
    const value = prop.text().trim();
    const n = parseInt(value, 10);
    assertEquals(
      !isNaN(n) && n > 0 && String(n) === value,
      true,
      `max-attachment-size must be a positive decimal integer; got "${value}"`,
    );
  });
});

Deno.test("RFC 8607 §6.2 PROPFIND allprop must not include max-attachment-size", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-mas-col");
    const allpropBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-mas-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      allpropBody,
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("max-attachment-size"),
      false,
      "PROPFIND allprop MUST NOT include max-attachment-size (allprop behavior: SHOULD NOT)",
    );
  });
});

// ─── §6.3 max-attachments-per-resource property ───────────────────────────────

Deno.test("RFC 8607 §6.3 PROPPATCH to set max-attachments-per-resource must be rejected as protected", async () => {
  await withServer(async (s) => {
    await s.mkcol("protected-mapr-col");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      "<D:set><D:prop>" +
      "<C:max-attachments-per-resource>1</C:max-attachments-per-resource>" +
      "</D:prop></D:set>" +
      "</D:propertyupdate>";

    const resp = await s.do(
      "PROPPATCH",
      collectionPath("protected-mapr-col"),
      xmlContentType(),
      body,
    );
    const isDirectForbid = resp.status === 403;
    const isMultistatusWithForbid =
      resp.status === 207 &&
      (resp.body.includes("403") || resp.body.includes("Forbidden") || resp.body.includes("protected"));
    assertEquals(
      isDirectForbid || isMultistatusWithForbid,
      true,
      `PROPPATCH on protected max-attachments-per-resource must be rejected; got ${resp.status}`,
    );
  });
});

Deno.test("RFC 8607 §6.3 max-attachments-per-resource value must be a positive decimal integer", async () => {
  await withServer(async (s) => {
    await s.mkcol("mapr-value-col");
    const resp = await s.do(
      "PROPFIND",
      collectionPath("mapr-value-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      propfindProps(nsCalDAV, "max-attachments-per-resource"),
    );
    assertEquals(resp.status, 207);
    const prop = parseMultistatus(resp.body)
      .response(collectionPath("mapr-value-col"))
      ?.prop("max-attachments-per-resource");
    if (!prop || prop.status !== 200 || !prop.text()) return; // property not present; skip
    const value = prop.text().trim();
    const n = parseInt(value, 10);
    assertEquals(
      !isNaN(n) && n > 0 && String(n) === value,
      true,
      `max-attachments-per-resource must be a positive decimal integer; got "${value}"`,
    );
  });
});

Deno.test("RFC 8607 §6.3 PROPFIND allprop must not include max-attachments-per-resource", async () => {
  await withServer(async (s) => {
    await s.mkcol("allprop-mapr-col");
    const allpropBody =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

    const resp = await s.do(
      "PROPFIND",
      collectionPath("allprop-mapr-col"),
      withHeaders({ Depth: "0" }, xmlContentType()),
      allpropBody,
    );
    assertEquals(resp.status, 207);
    assertEquals(
      resp.body.includes("max-attachments-per-resource"),
      false,
      "PROPFIND allprop MUST NOT include max-attachments-per-resource (allprop behavior: SHOULD NOT)",
    );
  });
});

// ─── §3.4 VTODO managed attachments ──────────────────────────────────────────

Deno.test("RFC 8607 §3.4 attachment-add to a VTODO resource must behave identically to VEVENT", async () => {
  await withServer(async (s) => {
    await s.mkcol("vtodo-attach-col");
    await s.putTodo("vtodo-attach-col", "vtodo-attach-todo");

    const addResp = await s.do(
      "POST",
      objectPath("vtodo-attach-col", "vtodo-attach-todo") + "?action=attachment-add",
      {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=todo-notes.txt",
      },
      "Todo attachment content\n",
    );
    assertEquals(
      addResp.status < 500,
      true,
      "attachment-add to a VTODO resource must not cause 5xx",
    );
    if (addResp.status < 200 || addResp.status >= 300) return;

    const calManagedID = addResp.headers.get("Cal-Managed-ID");
    assertEquals(
      calManagedID !== null && calManagedID !== "",
      true,
      "Cal-Managed-ID header must be present and non-empty on successful attachment-add to VTODO",
    );

    const getResp = await s.do("GET", objectPath("vtodo-attach-col", "vtodo-attach-todo"));
    assertEquals(getResp.status, 200);
    assertStringIncludes(getResp.body, "ATTACH", "VTODO must contain ATTACH property after add");
    assertStringIncludes(
      getResp.body,
      "MANAGED-ID=",
      "ATTACH on VTODO must contain MANAGED-ID parameter",
    );
  });
});

// ─── §3.1 PUT with Prefer return=representation ───────────────────────────────

Deno.test("RFC 8607 §3.1 PUT with Prefer return=representation on existing resource must return updated body and new ETag", async () => {
  await withServer(async (s) => {
    await s.mkcol("prefer-put-col");
    // Create the resource first so the next PUT targets an existing resource
    await s.putEvent("prefer-put-col", "prefer-put-evt");

    const updatedBody =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CalStakk//ConformanceTest//EN\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:prefer-put-evt\r\n" +
      "DTSTAMP:20260201T000000Z\r\n" +
      "DTSTART:20260115T100000Z\r\n" +
      "DTEND:20260115T110000Z\r\n" +
      "SUMMARY:Updated Event\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";

    const putResp = await s.do(
      "PUT",
      objectPath("prefer-put-col", "prefer-put-evt"),
      {
        "Content-Type": "text/calendar; charset=utf-8",
        "Prefer": "return=representation",
      },
      updatedBody,
    );

    // The PUT itself must succeed
    assertEquals(
      putResp.status === 200 || putResp.status === 204 || putResp.status === 201,
      true,
      `PUT on existing resource must succeed (200/201/204); got ${putResp.status}`,
    );

    // When the server honours return=representation it returns 200 with body + ETag
    if (putResp.status === 200) {
      assertStringIncludes(
        putResp.body,
        "BEGIN:VCALENDAR",
        "Response with Prefer:return=representation must include the updated calendar body",
      );
      assertEquals(
        (putResp.headers.get("ETag") ?? "") !== "",
        true,
        "Response with Prefer:return=representation must include the new ETag header",
      );
    }
  });
});
