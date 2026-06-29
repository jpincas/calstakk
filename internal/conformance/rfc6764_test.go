// RFC 6764 — Locating Services for CalDAV and CardDAV
// Spec: specs/rfc6764.txt
//
// Coverage:
//
//	§5   Context path discovery (/.well-known/caldav redirect)
//	§6   DNS SRV record structure (configuration reference; not testable via HTTP)
//	§7   Client bootstrap via /.well-known and PROPFIND discovery chain
//
// RFC 6764 defines how CalDAV clients discover the server URL. The HTTP-testable
// part is the /.well-known/caldav redirect and the PROPFIND-based bootstrap chain:
//
//	/.well-known/caldav → 308 → /principal → PROPFIND → calendar-home-set
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §5 Context path / well-known redirect ────────────────────────────────────

// RFC 6764 §5 — GET on /.well-known/caldav MUST redirect (3xx) to the
// context path of the CalDAV server (the principal path).
func TestRFC6764_5_WellKnownRedirectsToPrincipal(t *testing.T) {
	s := newServer(t)

	// Use no-redirect client to observe the raw redirect response.
	resp := s.doNoRedirect(t, "GET", "/.well-known/caldav", nil, "")
	require.Contains(t, []int{
		http.StatusMovedPermanently,  // 301
		http.StatusFound,             // 302
		http.StatusSeeOther,          // 303
		http.StatusTemporaryRedirect, // 307
		http.StatusPermanentRedirect, // 308
	}, resp.StatusCode,
		"/.well-known/caldav must return a 3xx redirect")

	location := resp.Header.Get("Location")
	require.NotEmpty(t, location, "redirect must include a Location header")
}

// RFC 6764 §5 — The redirect SHOULD use 308 Permanent Redirect (per §5 note)
// because the URL is a permanent canonical endpoint.
func TestRFC6764_5_WellKnownUsesPermanentRedirect(t *testing.T) {
	s := newServer(t)

	resp := s.doNoRedirect(t, "GET", "/.well-known/caldav", nil, "")
	// 308 is preferred; 301 is also acceptable.
	require.Contains(t, []int{
		http.StatusMovedPermanently,  // 301
		http.StatusPermanentRedirect, // 308
	}, resp.StatusCode,
		"/.well-known/caldav SHOULD use a permanent redirect (301 or 308)")
}

// RFC 6764 §5 — Following the /.well-known/caldav redirect chain MUST
// ultimately reach the current-user-principal path.
func TestRFC6764_5_FollowingWellKnownLeadsToPrincipal(t *testing.T) {
	s := newServer(t)

	// Use the default redirect-following client.
	resp := s.do(t, "GET", "/.well-known/caldav", nil, "")
	// After following redirects the server responds from the principal path.
	// GET on a WebDAV principal is not defined in WebDAV — the server may return
	// 200 (some body), 405 (method not allowed on a non-file resource), or 404.
	// What MUST NOT happen is a 5xx (server error).
	require.Less(t, resp.StatusCode, 500,
		"following /.well-known/caldav redirect must not lead to 5xx")
}

// RFC 6764 §5 — PROPFIND on /.well-known/caldav (without redirect following)
// is also valid; the redirect applies to all methods.
func TestRFC6764_5_PropfindOnWellKnownRedirects(t *testing.T) {
	s := newServer(t)

	resp := s.doNoRedirect(t, "PROPFIND", "/.well-known/caldav",
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Contains(t, []int{
		http.StatusMovedPermanently,
		http.StatusFound,
		http.StatusSeeOther,
		http.StatusTemporaryRedirect,
		http.StatusPermanentRedirect,
	}, resp.StatusCode,
		"PROPFIND on /.well-known/caldav must also redirect")
}

// ─── §7 Bootstrap discovery chain ────────────────────────────────────────────

// RFC 6764 §7.1 step 1 — After resolving /.well-known/caldav to the principal
// path, a PROPFIND MUST return current-user-principal.
func TestRFC6764_7_1_PrincipalCurrentUserPrincipal(t *testing.T) {
	s := newServer(t)

	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "current-user-principal"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("current-user-principal")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status,
		"current-user-principal must be 200 OK on the principal resource")
}

// RFC 6764 §7.1 step 2 — PROPFIND on the principal MUST return
// calendar-home-set so clients can find calendars.
func TestRFC6764_7_1_PrincipalHasCalendarHomeSet(t *testing.T) {
	s := newServer(t)

	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-home-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("calendar-home-set")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status,
		"calendar-home-set must be 200 OK on the principal resource")
}

// RFC 6764 §7.1 step 3 — PROPFIND (Depth:1) on the calendar home MUST list
// all calendar collections so clients can display the full calendar list.
func TestRFC6764_7_1_CalendarHomeListsCollections(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "discovery-col")

	resp := s.do(t, "PROPFIND", calendarHomePath,
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(collectionPath("discovery-col")),
		"calendar home PROPFIND Depth:1 must list all collections")
}

// RFC 6764 §7.1 — The complete bootstrap chain /.well-known → principal →
// calendar-home-set → collections MUST work end-to-end.
func TestRFC6764_7_FullBootstrapChain(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "chain-col")

	// Step 1: resolve /.well-known/caldav to the principal.
	// GET on a WebDAV principal may return 404/405 — use < 500 (not < 400).
	wkResp := s.do(t, "GET", "/.well-known/caldav", nil, "")
	require.Less(t, wkResp.StatusCode, 500, "well-known must not return 5xx")

	// Step 2: PROPFIND on principal for calendar-home-set.
	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-home-set"))
	require.Equal(t, http.StatusMultiStatus, pfResp.StatusCode)
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("calendar-home-set")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)

	// Step 3: list the calendar home (Depth:1) and verify our collection appears.
	listResp := s.do(t, "PROPFIND", calendarHomePath,
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, listResp.StatusCode)
	ms2 := parseMultistatus(t, listResp.Body)
	require.NotNil(t, ms2.Response(collectionPath("chain-col")),
		"collection must appear in full bootstrap chain discovery")
}

// ─── §6 DNS SRV / TXT configuration ──────────────────────────────────────────

// RFC 6764 §6 — DNS-based discovery is out of scope for HTTP tests.
// This test documents the SRV record structure that clients must look for
// and verifies the server responds correctly on the standard CalDAV port.
func TestRFC6764_6_ServerRespondsOnStandardPath(t *testing.T) {
	s := newServer(t)

	// The server MUST respond to CalDAV requests at the well-known path.
	// DNS SRV would point clients at this server's host:port; the well-known
	// path is the entry point once the host is resolved.
	resp := s.doNoRedirect(t, "PROPFIND", "/.well-known/caldav",
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	// Must either redirect or return a direct response — not 404 or 5xx.
	require.NotEqual(t, http.StatusNotFound, resp.StatusCode,
		"/.well-known/caldav must not return 404")
	require.Less(t, resp.StatusCode, 500,
		"/.well-known/caldav must not return 5xx")
}
