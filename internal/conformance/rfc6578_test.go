// RFC 6578 — Collection Synchronization for WebDAV
// Spec: specs/rfc6578.txt
//
// Coverage:
//
//	§3   The sync-token DAV property
//	§6   The sync-collection REPORT
//	§7   Error conditions (invalid-sync-token)
//
// The sync-collection REPORT allows CalDAV clients to retrieve only the
// resources that changed since a previous synchronization point, identified
// by a sync-token. This is critical for efficient client sync (used by
// Apple Calendar, Thunderbird, Tasks.org).
package conformance

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §3 sync-token property ───────────────────────────────────────────────────

// RFC 6578 §3 — Every collection MUST expose a DAV:sync-token property.
// The value is an opaque URI that identifies the current sync state.
func TestRFC6578_3_SyncTokenPropertyExists(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sync-tok")

	resp := s.do(t, "PROPFIND", collectionPath("sync-tok"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("sync-tok"))
	require.NotNil(t, r)
	p := r.Prop("sync-token")
	require.NotNil(t, p, "sync-token must appear in PROPFIND response")
	require.Equal(t, http.StatusOK, p.Status)
	require.NotEmpty(t, p.Text(), "sync-token must have a non-empty value")
}

// RFC 6578 §3 — The calendar home set MUST also expose sync-token.
func TestRFC6578_3_SyncTokenOnCalendarHome(t *testing.T) {
	s := newServer(t)

	resp := s.do(t, "PROPFIND", calendarHomePath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(calendarHomePath)
	require.NotNil(t, r)
	p := r.Prop("sync-token")
	require.NotNil(t, p, "sync-token must be present on calendar home")
}

// RFC 6578 §3 — The sync-token MUST change after a PUT (new resource).
func TestRFC6578_3_SyncTokenChangesAfterPut(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tok-change")

	// Capture initial token.
	resp1 := s.do(t, "PROPFIND", collectionPath("tok-change"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	ms1 := parseMultistatus(t, resp1.Body)
	tok1 := ms1.Response(collectionPath("tok-change")).Prop("sync-token").Text()

	// PUT a new object.
	s.putTodo(t, "tok-change", "sync-todo1")

	// Capture new token.
	resp2 := s.do(t, "PROPFIND", collectionPath("tok-change"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	ms2 := parseMultistatus(t, resp2.Body)
	tok2 := ms2.Response(collectionPath("tok-change")).Prop("sync-token").Text()

	require.NotEqual(t, tok1, tok2,
		"sync-token must change after a PUT")
}

// RFC 6578 §3 — The sync-token MUST change after a DELETE.
func TestRFC6578_3_SyncTokenChangesAfterDelete(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tok-del")
	s.putTodo(t, "tok-del", "del-todo")

	resp1 := s.do(t, "PROPFIND", collectionPath("tok-del"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	ms1 := parseMultistatus(t, resp1.Body)
	tok1 := ms1.Response(collectionPath("tok-del")).Prop("sync-token").Text()

	// Delete the object.
	s.do(t, "DELETE", objectPath("tok-del", "del-todo"), nil, "")

	resp2 := s.do(t, "PROPFIND", collectionPath("tok-del"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "sync-token"))
	ms2 := parseMultistatus(t, resp2.Body)
	tok2 := ms2.Response(collectionPath("tok-del")).Prop("sync-token").Text()

	require.NotEqual(t, tok1, tok2,
		"sync-token must change after DELETE")
}

// ─── §6 sync-collection REPORT ────────────────────────────────────────────────

// RFC 6578 §6.1 — A sync-collection REPORT with an empty sync-token performs
// a full initial synchronization and MUST return all member resources.
func TestRFC6578_6_1_InitialSyncReturnsAllResources(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "init-sync")
	s.putTodo(t, "init-sync", "sync-todo1")
	s.putTodo(t, "init-sync", "sync-todo2")

	resp := s.do(t, "REPORT", collectionPath("init-sync"),
		xmlContentType(), syncCollectionReport(""))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode,
		"initial sync-collection REPORT must return 207")

	// Both objects must appear.
	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("init-sync", "sync-todo1")))
	require.NotNil(t, ms.Response(objectPath("init-sync", "sync-todo2")))
}

// RFC 6578 §6.1 — The sync-collection REPORT MUST include a sync-token in the
// multistatus response so the client can use it for the next incremental sync.
func TestRFC6578_6_1_InitialSyncReturnsNewSyncToken(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sync-token-resp")

	resp := s.do(t, "REPORT", collectionPath("sync-token-resp"),
		xmlContentType(), syncCollectionReport(""))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	// The response MUST include a <D:sync-token> element.
	require.Contains(t, resp.Body, "sync-token",
		"sync-collection response must contain a sync-token")
}

// RFC 6578 §6.2 — An incremental sync with a valid sync-token MUST return
// only resources changed since that token.
func TestRFC6578_6_2_IncrementalSyncReturnsOnlyChangedResources(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "incr-sync")
	s.putTodo(t, "incr-sync", "pre-existing")

	// Perform initial sync to get a baseline token.
	initResp := s.do(t, "REPORT", collectionPath("incr-sync"),
		xmlContentType(), syncCollectionReport(""))
	require.Equal(t, http.StatusMultiStatus, initResp.StatusCode)

	// Extract the sync-token from the response.
	// The token appears in a <D:sync-token> element in the multistatus body.
	syncToken := extractSyncToken(initResp.Body)
	require.NotEmpty(t, syncToken, "initial sync must return a sync-token")

	// Add a new object after the baseline.
	s.putTodo(t, "incr-sync", "newly-added")

	// Incremental sync from baseline token.
	incrResp := s.do(t, "REPORT", collectionPath("incr-sync"),
		xmlContentType(), syncCollectionReport(syncToken))
	require.Equal(t, http.StatusMultiStatus, incrResp.StatusCode)

	ms := parseMultistatus(t, incrResp.Body)
	// Only the new object should appear; pre-existing must NOT.
	require.NotNil(t, ms.Response(objectPath("incr-sync", "newly-added")),
		"newly added object must appear in incremental sync")
	require.Nil(t, ms.Response(objectPath("incr-sync", "pre-existing")),
		"pre-existing object must NOT appear in incremental sync (unchanged)")
}

// RFC 6578 §6.3 — Deleted resources MUST appear in the sync-collection REPORT
// with a 404 response status so clients can remove them from their local store.
func TestRFC6578_6_3_DeletedResourcesReportedAs404(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "del-sync")
	s.putTodo(t, "del-sync", "to-be-deleted")

	// Baseline sync.
	initResp := s.do(t, "REPORT", collectionPath("del-sync"),
		xmlContentType(), syncCollectionReport(""))
	syncToken := extractSyncToken(initResp.Body)
	require.NotEmpty(t, syncToken)

	// Delete the object.
	s.do(t, "DELETE", objectPath("del-sync", "to-be-deleted"), nil, "")

	// Incremental sync — deleted object MUST appear with 404.
	incrResp := s.do(t, "REPORT", collectionPath("del-sync"),
		xmlContentType(), syncCollectionReport(syncToken))
	require.Equal(t, http.StatusMultiStatus, incrResp.StatusCode)

	ms := parseMultistatus(t, incrResp.Body)
	deleted := ms.Response(objectPath("del-sync", "to-be-deleted"))
	require.NotNil(t, deleted,
		"deleted resource MUST appear in sync-collection REPORT")
	// The response for the deleted resource must convey a 404 status.
	// This may appear as <D:status>HTTP/1.1 404 Not Found</D:status>
	// at the response level, or as propstat 404.
	require.Contains(t, incrResp.Body, "404",
		"deleted resource must have 404 status in sync-collection REPORT")
}

// ─── §7 Error conditions ──────────────────────────────────────────────────────

// RFC 6578 §7 — A sync-collection REPORT with an invalid/unknown sync-token
// MUST return 403 Forbidden with a <D:valid-sync-token> precondition error.
func TestRFC6578_7_InvalidSyncTokenReturns403(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "invalid-tok")

	resp := s.do(t, "REPORT", collectionPath("invalid-tok"),
		xmlContentType(),
		syncCollectionReport("urn:invalid-token-that-does-not-exist"))
	require.Equal(t, http.StatusForbidden, resp.StatusCode,
		"invalid sync-token must return 403 Forbidden")
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// extractSyncToken searches a multistatus XML body for the <D:sync-token>
// element and returns its text content, or "" if not found.
func extractSyncToken(body string) string {
	// Simple substring extraction — we look for the content between
	// <D:sync-token> (or any prefix for "sync-token") and the closing tag.
	body = strings.TrimSpace(body)
	start := strings.Index(body, "<")
	if start == -1 {
		return ""
	}
	// Find any element whose local name is "sync-token".
	for _, marker := range []string{">", ">"} {
		_ = marker
	}
	// Walk through occurrences of "sync-token".
	search := "sync-token"
	idx := strings.Index(body, search)
	for idx != -1 {
		// Check if this is a start tag (preceded by '<' or space after namespace).
		before := body[:idx]
		lastLT := strings.LastIndex(before, "<")
		if lastLT == -1 {
			idx = strings.Index(body[idx+1:], search)
			if idx == -1 {
				break
			}
			continue
		}
		tag := body[lastLT:]
		// Is this a start tag (not a closing tag)?
		if len(tag) > 1 && tag[1] != '/' {
			// Find the end of the start element.
			gtIdx := strings.Index(tag, ">")
			if gtIdx != -1 {
				afterTag := tag[gtIdx+1:]
				// Find closing tag.
				closeIdx := strings.Index(afterTag, "/"+search)
				if closeIdx == -1 {
					closeIdx = strings.Index(afterTag, "sync-token>")
				}
				if closeIdx != -1 {
					// Find start of text (after the >).
					text := afterTag[:closeIdx]
					// Remove any nested tags.
					clean := stripXMLTags(text)
					if strings.TrimSpace(clean) != "" {
						return strings.TrimSpace(clean)
					}
				}
			}
		}
		remaining := body[idx+len(search):]
		next := strings.Index(remaining, search)
		if next == -1 {
			break
		}
		idx = idx + len(search) + next
	}
	return ""
}

// stripXMLTags removes XML markup from a string, returning only text content.
func stripXMLTags(s string) string {
	var out strings.Builder
	inTag := false
	for _, c := range s {
		switch {
		case c == '<':
			inTag = true
		case c == '>':
			inTag = false
		case !inTag:
			out.WriteRune(c)
		}
	}
	return out.String()
}
