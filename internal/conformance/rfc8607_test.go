// RFC 8607 — Managed Attachments for Calendar Data in CalDAV
// Spec: specs/rfc8607.txt
//
// Coverage:
//
//	§3   Attachment management via POST
//	§4   ATTACH property with MANAGED-ID parameter
//	§5   Attachment-related CalDAV properties (max-attachment-size, etc.)
//
// Managed attachments allow large binary files to be stored server-side and
// referenced via ATTACH URIs, avoiding the need to base64-encode them inside
// calendar objects. This is an Informational RFC; support is optional.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §5 Attachment capacity properties ────────────────────────────────────────

// RFC 8607 §5.1 — max-attachment-size limits the size of managed attachments.
// If the server supports managed attachments, this property SHOULD be present.
func TestRFC8607_5_1_MaxAttachmentSizeProperty(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-cap-col")

	resp := s.do(t, "PROPFIND", collectionPath("attach-cap-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "max-attachment-size"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("attach-cap-col"))
	require.NotNil(t, r)
	p := r.Prop("max-attachment-size")
	require.NotNil(t, p, "max-attachment-size must appear in PROPFIND propstat")
}

// RFC 8607 §5.2 — max-attachments-per-resource limits the number of managed
// attachments per calendar object resource.
func TestRFC8607_5_2_MaxAttachmentsPerResourceProperty(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-num-col")

	resp := s.do(t, "PROPFIND", collectionPath("attach-num-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "max-attachments-per-resource"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("attach-num-col"))
	require.NotNil(t, r)
	p := r.Prop("max-attachments-per-resource")
	require.NotNil(t, p, "max-attachments-per-resource must appear in PROPFIND propstat")
}

// ─── §3 Attachment management via POST ────────────────────────────────────────

// RFC 8607 §3.2 — POST to a calendar object resource with
// Content-Disposition: attachment adds a new managed attachment.
// The server MUST return 201 Created with MANAGED-ID and Location headers.
func TestRFC8607_3_2_PostAddAttachment(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-col")
	s.putEvent(t, "attach-col", "attach-evt")

	// POST a managed attachment.
	resp := s.do(t, "POST", objectPath("attach-col", "attach-evt"),
		map[string]string{
			"Content-Type":        "text/plain",
			"Content-Disposition": "attachment; filename=notes.txt",
		},
		"Meeting notes content here.\n")
	// If managed attachments are not supported: 405 or 501.
	// If supported: 201 with Cal-Managed-ID header.
	require.Less(t, resp.StatusCode, 500,
		"POST to add managed attachment must not cause 5xx")

	if resp.StatusCode == http.StatusCreated {
		require.NotEmpty(t, resp.Header.Get("Cal-Managed-ID"),
			"POST response must include Cal-Managed-ID header")
		require.NotEmpty(t, resp.Header.Get("Location"),
			"POST response must include Location header for the attachment URI")
	}
}

// RFC 8607 §3.3 — POST with a Prefer header (return=representation) causes
// the updated calendar object to be returned in the response body.
func TestRFC8607_3_3_PostAttachmentWithPreferReturn(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-prefer-col")
	s.putEvent(t, "attach-prefer-col", "pref-evt")

	resp := s.do(t, "POST", objectPath("attach-prefer-col", "pref-evt"),
		map[string]string{
			"Content-Type":        "text/plain",
			"Content-Disposition": "attachment; filename=doc.txt",
			"Prefer":              "return=representation",
		},
		"Document content.\n")
	require.Less(t, resp.StatusCode, 500,
		"POST attachment with Prefer:return=representation must not cause 5xx")

	if resp.StatusCode == http.StatusCreated {
		// If supported, response body should contain the updated iCalendar.
		require.Contains(t, resp.Header.Get("Content-Type"), "calendar")
	}
}

// RFC 8607 §3.4 — POST with action=attachment-remove deletes a managed attachment.
// Cal-Managed-ID header identifies the attachment to remove.
func TestRFC8607_3_4_PostRemoveAttachment(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-rm-col")
	s.putEvent(t, "attach-rm-col", "rm-evt")

	// Add an attachment first.
	addResp := s.do(t, "POST", objectPath("attach-rm-col", "rm-evt"),
		map[string]string{
			"Content-Type":        "text/plain",
			"Content-Disposition": "attachment; filename=todelete.txt",
		},
		"Content to delete.\n")
	if addResp.StatusCode != http.StatusCreated {
		t.Skip("managed attachments not supported (add step returned non-201)")
	}
	managedID := addResp.Header.Get("Cal-Managed-ID")

	// Remove the attachment.
	resp := s.do(t, "POST", objectPath("attach-rm-col", "rm-evt"),
		map[string]string{
			"Cal-Managed-ID": managedID,
		},
		"")
	// The remove action uses POST with the Cal-Managed-ID header and empty body
	// (or action query parameter). Server should return 204 or 201.
	require.Less(t, resp.StatusCode, 500,
		"POST to remove attachment must not cause 5xx")
}

// ─── §4 ATTACH property with MANAGED-ID ───────────────────────────────────────

// RFC 8607 §4 — After adding a managed attachment, the calendar object's
// ATTACH property MUST include the MANAGED-ID parameter and a URI pointing
// to the attachment.
func TestRFC8607_4_AttachPropertyHasManagedID(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-prop-col")
	s.putEvent(t, "attach-prop-col", "mgid-evt")

	addResp := s.do(t, "POST", objectPath("attach-prop-col", "mgid-evt"),
		map[string]string{
			"Content-Type":        "application/pdf",
			"Content-Disposition": "attachment; filename=report.pdf",
		},
		"%PDF-1.4 mock content")
	if addResp.StatusCode != http.StatusCreated {
		t.Skip("managed attachments not supported")
	}

	// GET the updated calendar object — ATTACH must have MANAGED-ID.
	getResp := s.do(t, "GET", objectPath("attach-prop-col", "mgid-evt"), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "ATTACH",
		"updated event must contain ATTACH property")
	require.Contains(t, getResp.Body, "MANAGED-ID=",
		"ATTACH must contain MANAGED-ID parameter")
}

// RFC 8607 §4 — An ATTACH property with MANAGED-ID is an external URI attachment;
// the server must expose the attachment at that URI (accessible via GET).
func TestRFC8607_4_ManagedAttachmentAccessible(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "attach-access-col")
	s.putEvent(t, "attach-access-col", "access-evt")

	addResp := s.do(t, "POST", objectPath("attach-access-col", "access-evt"),
		map[string]string{
			"Content-Type":        "text/plain",
			"Content-Disposition": "attachment; filename=readme.txt",
		},
		"This is the attachment content.\n")
	if addResp.StatusCode != http.StatusCreated {
		t.Skip("managed attachments not supported")
	}
	location := addResp.Header.Get("Location")
	require.NotEmpty(t, location)

	// The attachment must be retrievable at the Location URL.
	resp := s.do(t, "GET", location, nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode,
		"managed attachment must be retrievable at its Location URI")
	require.Contains(t, resp.Body, "This is the attachment content.")
}
