// RFC 4918 — HTTP Extensions for Web Distributed Authoring and Versioning (WebDAV)
// Spec: specs/rfc4918.txt
//
// Coverage: §9 HTTP Methods for Distributed Authoring
//
//	§9.1  PROPFIND
//	§9.2  PROPPATCH
//	§9.3  MKCOL
//	§9.6  DELETE
//	§9.7  PUT (base HTTP, ETag preconditions)
//	§9.8  COPY
//	§9.9  MOVE
//	§10   HTTP Headers (Depth, Destination, If, Overwrite)
//	§11   Status Codes
//	§14   XML Element Definitions (multistatus, propstat, prop, etc.)
//
// Not covered here (deferred to CalDAV-specific tests):
//
//	§9.4  GET/HEAD on collections (no meaningful body in CalDAV)
//	§9.10 LOCK / §9.11 UNLOCK — optional in CalDAV
package conformance

import (
	"encoding/xml"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §9.1 PROPFIND ────────────────────────────────────────────────────────────

// RFC 4918 §9.1 — A successful PROPFIND on any resource MUST return 207 Multi-Status.
func TestRFC4918_9_1_PropfindReturns207(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
}

// RFC 4918 §9.1 — PROPFIND with Depth:0 MUST return a response for the target
// resource only (no children).
func TestRFC4918_9_1_PropfindDepth0ReturnsSingleResponse(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "depth-test")
	s.putTodo(t, "depth-test", "todo-1")

	resp := s.do(t, "PROPFIND", collectionPath("depth-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	// Depth:0 — only the collection itself, not its children.
	require.Equal(t, 1, ms.Len())
	require.NotNil(t, ms.Response(collectionPath("depth-test")))
}

// RFC 4918 §9.1 — PROPFIND with Depth:1 MUST return the target resource and
// its immediate children.
func TestRFC4918_9_1_PropfindDepth1ReturnsChildrenToo(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "depth1-col")
	s.putTodo(t, "depth1-col", "todo-a")
	s.putTodo(t, "depth1-col", "todo-b")

	resp := s.do(t, "PROPFIND", collectionPath("depth1-col"),
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	// Collection + 2 objects = 3 responses.
	require.Equal(t, 3, ms.Len())
}

// RFC 4918 §9.1 — allprop returns at minimum the standard live properties.
func TestRFC4918_9_1_PropfindAllpropIncludesStandardProps(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r, "expected response for %s", principalPath)

	// RFC 4918 §15 — resourcetype is a MUST-support live property.
	p := r.Prop("resourcetype")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 4918 §9.1 — propname returns the names of all properties without values.
func TestRFC4918_9_1_PropfindPropnameReturnsNames(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindPropname())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	// resourcetype MUST be listed.
	p := r.Prop("resourcetype")
	require.NotNil(t, p)
}

// RFC 4918 §9.1 — PROPFIND with <prop> returns only the requested properties.
// Properties not found MUST appear in a propstat with 404 status.
func TestRFC4918_9_1_PropfindSpecificPropNotFound404(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "nonexistent-property-xyz"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("nonexistent-property-xyz")
	require.NotNil(t, p)
	require.Equal(t, http.StatusNotFound, p.Status)
}

// RFC 4918 §9.1 — PROPFIND on a non-existent resource MUST return 404.
func TestRFC4918_9_1_PropfindNonExistentReturns404(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", "/calstakk/calendars/no-such-collection",
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

// RFC 4918 §14.20 — The <DAV:resourcetype> of a collection MUST contain
// a <DAV:collection> child element.
func TestRFC4918_14_20_CollectionResourceType(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "rt-test")

	resp := s.do(t, "PROPFIND", collectionPath("rt-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "resourcetype"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("rt-test"))
	require.NotNil(t, r)
	p := r.Prop("resourcetype")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
	require.True(t, p.HasChild("collection"), "resourcetype should contain <DAV:collection/>")
}

// RFC 4918 §15.1 — The DAV:creationdate property (if supported) MUST be
// present in a PROPFIND allprop response.
func TestRFC4918_15_1_CreationdateInAllprop(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "cd-test")
	resp := s.do(t, "PROPFIND", collectionPath("cd-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("cd-test"))
	require.NotNil(t, r)
	p := r.Prop("creationdate")
	// Property may be 200 OK (present) or 404 (server doesn't support it) —
	// but it MUST appear in some propstat.
	require.NotNil(t, p, "creationdate must appear in PROPFIND allprop response")
}

// RFC 4918 §15.4 — The DAV:getcontentlength property MUST be present for
// calendar objects (non-collection resources).
func TestRFC4918_15_4_GetcontentlengthOnObject(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "cl-test")
	s.putTodo(t, "cl-test", "cl-todo")

	resp := s.do(t, "PROPFIND", objectPath("cl-test", "cl-todo"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "getcontentlength"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(objectPath("cl-test", "cl-todo"))
	require.NotNil(t, r)
	p := r.Prop("getcontentlength")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 4918 §15.6 — The DAV:getetag property MUST be present on resources
// that support ETag.
func TestRFC4918_15_6_GetetagOnObject(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "etag-test")
	s.putTodo(t, "etag-test", "etag-todo")

	resp := s.do(t, "PROPFIND", objectPath("etag-test", "etag-todo"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "getetag"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(objectPath("etag-test", "etag-todo"))
	require.NotNil(t, r)
	p := r.Prop("getetag")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
	require.NotEmpty(t, p.Text(), "getetag must have a non-empty value")
}

// ─── §9.2 PROPPATCH ───────────────────────────────────────────────────────────

// RFC 4918 §9.2 — PROPPATCH on a resource MUST return 207 Multi-Status.
func TestRFC4918_9_2_ProppatchReturns207(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "pp-test")

	body := xml.Header + `<D:propertyupdate xmlns:D="DAV:">` +
		`<D:set><D:prop><D:displayname>My Calendar</D:displayname></D:prop></D:set>` +
		`</D:propertyupdate>`
	resp := s.do(t, "PROPPATCH", collectionPath("pp-test"), xmlContentType(), body)
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
}

// RFC 4918 §9.2 — PROPPATCH on a non-existent resource MUST return 404.
func TestRFC4918_9_2_ProppatchNonExistentReturns404(t *testing.T) {
	s := newServer(t)
	body := xml.Header + `<D:propertyupdate xmlns:D="DAV:">` +
		`<D:set><D:prop><D:displayname>Ghost</D:displayname></D:prop></D:set>` +
		`</D:propertyupdate>`
	resp := s.do(t, "PROPPATCH", "/calstakk/calendars/ghost", xmlContentType(), body)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

// ─── §9.3 MKCOL ───────────────────────────────────────────────────────────────

// RFC 4918 §9.3 — MKCOL on a new path MUST return 201 Created.
func TestRFC4918_9_3_MkcolReturns201(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "MKCOL", collectionPath("new-col"), nil, "")
	require.Equal(t, http.StatusCreated, resp.StatusCode)
}

// RFC 4918 §9.3.1 — MKCOL on a path that already exists MUST return 405 Method Not Allowed.
func TestRFC4918_9_3_1_MkcolDuplicateReturns405(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dup-col")
	resp := s.do(t, "MKCOL", collectionPath("dup-col"), nil, "")
	require.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}

// RFC 4918 §9.3.1 — MKCOL MUST NOT create a collection if an intermediate
// path component doesn't exist (returns 409 Conflict).
func TestRFC4918_9_3_1_MkcolMissingParentReturns409(t *testing.T) {
	s := newServer(t)
	// /calstakk/calendars/missing/child — "missing" doesn't exist.
	resp := s.do(t, "MKCOL", collectionPath("missing/child"), nil, "")
	require.Equal(t, http.StatusConflict, resp.StatusCode)
}

// ─── §9.6 DELETE ──────────────────────────────────────────────────────────────

// RFC 4918 §9.6 — DELETE of an existing resource MUST return 204 No Content.
func TestRFC4918_9_6_DeleteObjectReturns204(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "del-test")
	s.putTodo(t, "del-test", "to-delete")

	resp := s.do(t, "DELETE", objectPath("del-test", "to-delete"), nil, "")
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
}

// RFC 4918 §9.6 — After DELETE the resource MUST NOT exist (GET returns 404).
func TestRFC4918_9_6_DeletedResourceNotFound(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "del-test2")
	s.putTodo(t, "del-test2", "gone")

	s.do(t, "DELETE", objectPath("del-test2", "gone"), nil, "")
	resp := s.do(t, "GET", objectPath("del-test2", "gone"), nil, "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

// RFC 4918 §9.6 — DELETE of a collection MUST delete the collection and all
// its children, returning 204.
func TestRFC4918_9_6_DeleteCollectionReturns204(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "del-col")
	s.putTodo(t, "del-col", "child")

	resp := s.do(t, "DELETE", collectionPath("del-col"), nil, "")
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	// Collection should be gone.
	resp2 := s.do(t, "PROPFIND", collectionPath("del-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusNotFound, resp2.StatusCode)
}

// RFC 4918 §9.6 — DELETE of a non-existent resource MUST return 404.
func TestRFC4918_9_6_DeleteNonExistentReturns404(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "DELETE", objectPath("no-col", "no-obj"), nil, "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

// ─── §9.7 PUT + ETags ─────────────────────────────────────────────────────────

// RFC 4918 §9.7 — PUT of a new resource MUST return 201 Created.
func TestRFC4918_9_7_PutNewResourceReturns201(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "put-test")
	resp := s.do(t, "PUT", objectPath("put-test", "new-todo"),
		calContentType(), vtodo("new-todo"))
	require.Equal(t, http.StatusCreated, resp.StatusCode)
}

// RFC 4918 §9.7 — PUT of an existing resource (update) MUST return 204 No Content.
func TestRFC4918_9_7_PutUpdateReturns204(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "put-upd")
	s.putTodo(t, "put-upd", "upd-todo")
	resp := s.do(t, "PUT", objectPath("put-upd", "upd-todo"),
		calContentType(), vtodo("upd-todo", "SUMMARY:Updated Todo"))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
}

// RFC 4918 §15.6 + §9.7 — PUT MUST return an ETag header on 201 Created.
func TestRFC4918_15_6_PutReturnsETag(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "etag-put")
	resp := s.do(t, "PUT", objectPath("etag-put", "e1"),
		calContentType(), vtodo("e1"))
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NotEmpty(t, resp.Header.Get("ETag"), "PUT must return ETag on 201")
}

// RFC 4918 §15.6 — The ETag returned by PUT and by PROPFIND getetag MUST match.
func TestRFC4918_15_6_ETagConsistentBetweenPutAndPropfind(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "etag-cons")
	putResp := s.do(t, "PUT", objectPath("etag-cons", "c1"),
		calContentType(), vtodo("c1"))
	putETag := putResp.Header.Get("ETag")
	require.NotEmpty(t, putETag)

	pfResp := s.do(t, "PROPFIND", objectPath("etag-cons", "c1"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "getetag"))
	ms := parseMultistatus(t, pfResp.Body)
	r := ms.Response(objectPath("etag-cons", "c1"))
	require.NotNil(t, r)
	p := r.Prop("getetag")
	require.Equal(t, putETag, p.Text())
}

// RFC 4918 §15.6 — The ETag MUST change when the resource content changes.
func TestRFC4918_15_6_ETagChangesOnUpdate(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "etag-chg")
	etag1 := s.putTodo(t, "etag-chg", "chg-todo")
	// Update the resource.
	resp2 := s.do(t, "PUT", objectPath("etag-chg", "chg-todo"),
		calContentType(), vtodo("chg-todo", "SUMMARY:Changed"))
	require.Equal(t, http.StatusNoContent, resp2.StatusCode)
	etag2 := resp2.Header.Get("ETag")
	require.NotEmpty(t, etag2)
	require.NotEqual(t, etag1, etag2, "ETag must change after update")
}

// RFC 4918 §10.4 — If-None-Match: * on PUT MUST fail with 412 if the resource exists.
func TestRFC4918_10_4_IfNoneMatchStarFailsIfExists(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "inm-test")
	s.putTodo(t, "inm-test", "inm-todo")

	resp := s.do(t, "PUT", objectPath("inm-test", "inm-todo"),
		withHeaders(calContentType(), map[string]string{"If-None-Match": "*"}),
		vtodo("inm-todo"))
	require.Equal(t, http.StatusPreconditionFailed, resp.StatusCode)
}

// RFC 4918 §10.4 — If-Match: <stale-etag> on PUT MUST fail with 412.
func TestRFC4918_10_4_IfMatchStaleETagFails412(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "im-test")
	s.putTodo(t, "im-test", "im-todo")
	// Update to advance ETag.
	s.do(t, "PUT", objectPath("im-test", "im-todo"),
		calContentType(), vtodo("im-todo", "SUMMARY:v2"))

	resp := s.do(t, "PUT", objectPath("im-test", "im-todo"),
		withHeaders(calContentType(), map[string]string{"If-Match": `"stale-etag-xyz"`}),
		vtodo("im-todo", "SUMMARY:v3"))
	require.Equal(t, http.StatusPreconditionFailed, resp.StatusCode)
}

// ─── §9.8 COPY ────────────────────────────────────────────────────────────────

// RFC 4918 §9.8 — COPY of a resource to a new path MUST return 201 Created.
// CalDAV restricts COPY to within the same server; cross-collection COPY of
// calendar objects may not be allowed.
func TestRFC4918_9_8_CopyObjectReturns201Or403(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "copy-src")
	s.mkcol(t, "copy-dst")
	s.putTodo(t, "copy-src", "cp-todo")

	resp := s.do(t, "COPY", objectPath("copy-src", "cp-todo"),
		map[string]string{"Destination": s.base + objectPath("copy-dst", "cp-todo")},
		"")
	// COPY is defined by WebDAV; CalDAV §4.1 notes it may be restricted.
	// Server MUST return 201 (success), 403 (forbidden), or 501 (not implemented).
	require.Contains(t, []int{
		http.StatusCreated,
		http.StatusForbidden,
		http.StatusNotImplemented,
	}, resp.StatusCode, "COPY must return 201, 403, or 501")
}

// ─── §9.9 MOVE ────────────────────────────────────────────────────────────────

// RFC 4918 §9.9 — MOVE of a resource to a new path.
// CalDAV §4.1 notes MOVE MAY be restricted.
func TestRFC4918_9_9_MoveObjectReturns201Or403(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "mv-src")
	s.mkcol(t, "mv-dst")
	s.putTodo(t, "mv-src", "mv-todo")

	resp := s.do(t, "MOVE", objectPath("mv-src", "mv-todo"),
		map[string]string{"Destination": s.base + objectPath("mv-dst", "mv-todo")},
		"")
	require.Contains(t, []int{
		http.StatusCreated,
		http.StatusNoContent,
		http.StatusForbidden,
		http.StatusNotImplemented,
	}, resp.StatusCode, "MOVE must return 201/204, 403, or 501")
}

// ─── §9.4 GET / HEAD ──────────────────────────────────────────────────────────

// RFC 4918 §9.4 — GET on a calendar object MUST return 200 with the iCalendar body.
func TestRFC4918_9_4_GetObjectReturns200(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "get-test")
	s.putTodo(t, "get-test", "get-todo")

	resp := s.do(t, "GET", objectPath("get-test", "get-todo"), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "BEGIN:VCALENDAR")
	require.Contains(t, resp.Body, "BEGIN:VTODO")
}

// RFC 4918 §9.4 — GET MUST return the ETag header.
func TestRFC4918_9_4_GetReturnsETag(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "get-etag")
	s.putTodo(t, "get-etag", "ge-todo")
	resp := s.do(t, "GET", objectPath("get-etag", "ge-todo"), nil, "")
	require.NotEmpty(t, resp.Header.Get("ETag"))
}

// RFC 4918 §9.4 — HEAD MUST return the same headers as GET without a body.
func TestRFC4918_9_4_HeadMatchesGetHeaders(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "head-test")
	s.putTodo(t, "head-test", "h-todo")

	getResp := s.do(t, "GET", objectPath("head-test", "h-todo"), nil, "")
	headResp := s.do(t, "HEAD", objectPath("head-test", "h-todo"), nil, "")

	require.Equal(t, getResp.StatusCode, headResp.StatusCode)
	require.Equal(t, getResp.Header.Get("ETag"), headResp.Header.Get("ETag"))
	require.Equal(t, getResp.Header.Get("Content-Type"), headResp.Header.Get("Content-Type"))
	require.Empty(t, headResp.Body, "HEAD response must have no body")
}

// ─── OPTIONS ──────────────────────────────────────────────────────────────────

// RFC 4918 §9.1 — OPTIONS on any resource MUST return an Allow header listing
// supported methods and a DAV header indicating protocol compliance level.
func TestRFC4918_OptionsReturnsDAVHeader(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "OPTIONS", principalPath, nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	// RFC 4918 compliance: DAV header MUST include "1".
	require.Contains(t, resp.Header.Get("Dav"), "1",
		"DAV header must include compliance class 1")
}
