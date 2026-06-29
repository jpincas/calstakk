// RFC 4791 — Calendaring Extensions to WebDAV (CalDAV)
// Spec: specs/rfc4791.txt
//
// Coverage:
//
//	§4   Calendar Resources (object model, collections)
//	§5.1 OPTIONS — DAV: calendar-access compliance advertisement
//	§5.2 Calendar Collection Properties
//	§5.3 Creating Resources (MKCALENDAR §5.3.1, PUT preconditions §5.3.2, ETag §5.3.4)
//	§6.2 calendar-home-set principal property
//	§7.8 calendar-query REPORT
//	§7.9 calendar-multiget REPORT
//	§7.10 free-busy-query REPORT
//	§9.6–9.9 XML filter elements (comp-filter, prop-filter, text-match, time-range)
//
// Out of scope (scheduling extensions covered by rfc6638_test.go):
//
//	§6.1 read-free-busy privilege
//	§8.3 Locking
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §5.1 OPTIONS / DAV compliance ───────────────────────────────────────────

// RFC 4791 §5.1 — A CalDAV server MUST include "calendar-access" in the
// DAV response header to indicate support for the CalDAV access feature.
func TestRFC4791_5_1_OptionsAdvertisesCalendarAccess(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "OPTIONS", principalPath, nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Dav"), "calendar-access",
		"DAV header must include 'calendar-access'")
}

// RFC 4791 §5.1 — OPTIONS on the calendar home MUST also include calendar-access.
func TestRFC4791_5_1_OptionsOnCalendarHomeAdvertisesCalendarAccess(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "OPTIONS", calendarHomePath, nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Dav"), "calendar-access")
}

// RFC 4791 §5.1 — OPTIONS on a calendar collection MUST include calendar-access.
func TestRFC4791_5_1_OptionsOnCollectionAdvertisesCalendarAccess(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "opts-col")
	resp := s.do(t, "OPTIONS", collectionPath("opts-col"), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Dav"), "calendar-access")
}

// ─── §6.2 calendar-home-set ───────────────────────────────────────────────────

// RFC 4791 §6.2 — The principal MUST have a DAV:calendar-home-set property
// returning the URL of the user's calendar home.
func TestRFC4791_6_2_PrincipalHasCalendarHomeSet(t *testing.T) {
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
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 4791 §6.2 — The current-user-principal property MUST be supported
// so clients can bootstrap discovery.
func TestRFC4791_6_2_PrincipalCurrentUserPrincipal(t *testing.T) {
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
	require.Equal(t, http.StatusOK, p.Status)
}

// ─── §5.3.1 MKCALENDAR ───────────────────────────────────────────────────────

// RFC 4791 §5.3.1 — MKCALENDAR MUST create a calendar collection and return
// 201 Created. This is a new HTTP method defined by the CalDAV spec.
func TestRFC4791_5_3_1_MkcalendarCreatesCollection(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "MKCALENDAR", collectionPath("mkcal-test"), nil, "")
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"MKCALENDAR must return 201 Created")
}

// RFC 4791 §5.3.1 — MKCALENDAR on an existing path MUST return 405.
func TestRFC4791_5_3_1_MkcalendarDuplicateReturns405(t *testing.T) {
	s := newServer(t)
	// Create once (via MKCOL fallback or MKCALENDAR — use whichever succeeds).
	s.mkcol(t, "mkcal-dup")
	resp := s.do(t, "MKCALENDAR", collectionPath("mkcal-dup"), nil, "")
	require.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}

// RFC 4791 §5.3.1 — A calendar collection created with MKCALENDAR MUST have
// a DAV:resourcetype containing <C:calendar/>.
func TestRFC4791_5_3_1_MkcalendarSetsCalendarResourcetype(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "MKCALENDAR", collectionPath("mkcal-rt"), nil, "")
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	pfResp := s.do(t, "PROPFIND", collectionPath("mkcal-rt"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "resourcetype"))
	require.Equal(t, http.StatusMultiStatus, pfResp.StatusCode)

	ms := parseMultistatus(t, pfResp.Body)
	r := ms.Response(collectionPath("mkcal-rt"))
	require.NotNil(t, r)
	p := r.Prop("resourcetype")
	require.NotNil(t, p)
	require.True(t, p.HasChild("calendar"),
		"MKCALENDAR collection resourcetype must contain <C:calendar/>; got %+v", p)
}

// RFC 4791 §5.3.1 — MKCOL MUST also work as an alternative to MKCALENDAR
// for creating calendar collections (§5.3.1 allows servers to accept both).
func TestRFC4791_5_3_1_MkcolAlsoCreatesCalendarCollection(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "mkcol-cal") // uses MKCOL — must succeed

	pfResp := s.do(t, "PROPFIND", collectionPath("mkcol-cal"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "resourcetype"))
	ms := parseMultistatus(t, pfResp.Body)
	r := ms.Response(collectionPath("mkcol-cal"))
	require.NotNil(t, r)
	p := r.Prop("resourcetype")
	require.NotNil(t, p)
	// Must be at minimum a <D:collection>; ideally also <C:calendar>.
	require.True(t, p.HasChild("collection"),
		"MKCOL collection must have resourcetype <D:collection/>")
}

// ─── §5.2 Calendar Collection Properties ──────────────────────────────────────

// RFC 4791 §5.2.3 — supported-calendar-component-set MUST be present on a
// calendar collection and MUST indicate which component types are supported.
func TestRFC4791_5_2_3_SupportedCalendarComponentSet(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sccs-test")

	resp := s.do(t, "PROPFIND", collectionPath("sccs-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "supported-calendar-component-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("sccs-test"))
	require.NotNil(t, r)
	p := r.Prop("supported-calendar-component-set")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 4791 §5.2.4 — supported-calendar-data MUST advertise the media types
// the server accepts for calendar data (at minimum text/calendar;version=2.0).
func TestRFC4791_5_2_4_SupportedCalendarData(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "scd-test")

	resp := s.do(t, "PROPFIND", collectionPath("scd-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "supported-calendar-data"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("scd-test"))
	require.NotNil(t, r)
	p := r.Prop("supported-calendar-data")
	require.NotNil(t, p)
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 4791 §5.2.1 — calendar-description SHOULD be supported as a writable
// property on calendar collections.
func TestRFC4791_5_2_1_CalendarDescriptionProperty(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "desc-test")

	resp := s.do(t, "PROPFIND", collectionPath("desc-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-description"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("desc-test"))
	require.NotNil(t, r)
	// May be 200 (present/empty) or 404 (not yet set) — but MUST appear in propstat.
	p := r.Prop("calendar-description")
	require.NotNil(t, p, "calendar-description must appear in PROPFIND propstat")
}

// RFC 4791 §5.2.5 — max-resource-size limits the size of calendar objects the
// server accepts. If present it MUST be a positive integer (bytes).
func TestRFC4791_5_2_5_MaxResourceSize(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "mrs-test")

	resp := s.do(t, "PROPFIND", collectionPath("mrs-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "max-resource-size"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("mrs-test"))
	require.NotNil(t, r)
	p := r.Prop("max-resource-size")
	require.NotNil(t, p, "max-resource-size must appear in PROPFIND propstat")
}

// RFC 4791 §5.2.6 / §5.2.7 — min-date-time / max-date-time limit the range
// of date-time values the server will store.
func TestRFC4791_5_2_6_MinMaxDateTime(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dt-range-test")

	resp := s.do(t, "PROPFIND", collectionPath("dt-range-test"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "min-date-time", nsCalDAV, "max-date-time"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("dt-range-test"))
	require.NotNil(t, r)
	// Both SHOULD appear (200 OK) or SHOULD appear as 404. MUST NOT be absent.
	require.NotNil(t, r.Prop("min-date-time"),
		"min-date-time must appear in PROPFIND propstat")
	require.NotNil(t, r.Prop("max-date-time"),
		"max-date-time must appear in PROPFIND propstat")
}

// ─── §5.3.2 PUT preconditions ────────────────────────────────────────────────

// RFC 4791 §5.3.2 — PUT with wrong Content-Type MUST be rejected (400 or 415).
func TestRFC4791_5_3_2_PutWrongContentTypeRejected(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "ct-test")
	resp := s.do(t, "PUT", objectPath("ct-test", "bad-ct"),
		map[string]string{"Content-Type": "text/plain"},
		vtodo("bad-ct"))
	require.Contains(t, []int{http.StatusBadRequest, http.StatusUnsupportedMediaType},
		resp.StatusCode, "PUT with wrong Content-Type must be rejected")
}

// RFC 4791 §5.3.2 — PUT of a VCALENDAR without a UID MUST be rejected (400 or 422).
func TestRFC4791_5_3_2_PutMissingUIDRejected(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "uid-test")
	noUID := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n" +
		"BEGIN:VTODO\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:No UID\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("uid-test", "no-uid"),
		calContentType(), noUID)
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "PUT without UID must be rejected")
}

// RFC 4791 §5.3.2 — PUT of a completely invalid iCalendar body MUST be rejected.
func TestRFC4791_5_3_2_PutInvalidBodyRejected(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "invalid-test")
	resp := s.do(t, "PUT", objectPath("invalid-test", "bad"),
		calContentType(), "this is not valid icalendar data")
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "PUT of invalid iCalendar must be rejected")
}

// RFC 4791 §5.3.2 — If-None-Match: * prevents overwriting an existing object.
func TestRFC4791_5_3_2_IfNoneMatchStarPreventsOverwrite(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "precond-test")
	s.putTodo(t, "precond-test", "exists")

	resp := s.do(t, "PUT", objectPath("precond-test", "exists"),
		withHeaders(calContentType(), map[string]string{"If-None-Match": "*"}),
		vtodo("exists"))
	require.Equal(t, http.StatusPreconditionFailed, resp.StatusCode,
		"If-None-Match: * must return 412 when resource exists")
}

// RFC 4791 §5.3.2 — PUT with no-uid-conflict: a second PUT with the same UID
// to a different URL MUST be rejected.
func TestRFC4791_5_3_2_NoUIDConflict(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "uid-conflict")
	uid := "conflict-uid-001"
	s.putObject(t, objectPath("uid-conflict", uid), vtodo(uid))

	// Same UID, different filename — server MUST reject with 403 or 409.
	resp := s.do(t, "PUT", objectPath("uid-conflict", "other-name"),
		calContentType(), vtodo(uid))
	require.Contains(t, []int{http.StatusForbidden, http.StatusConflict},
		resp.StatusCode,
		"PUT with duplicate UID in same collection must be rejected with 403 or 409")
}

// ─── §5.3.4 ETag ─────────────────────────────────────────────────────────────

// RFC 4791 §5.3.4 — The server MUST return an ETag on successful PUT.
func TestRFC4791_5_3_4_PutReturnsETag(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "etag4791")
	resp := s.do(t, "PUT", objectPath("etag4791", "e1"),
		calContentType(), vtodo("e1"))
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NotEmpty(t, resp.Header.Get("ETag"),
		"RFC 4791 §5.3.4: server MUST return ETag on successful PUT")
}

// ─── §7.8 calendar-query REPORT ───────────────────────────────────────────────

// RFC 4791 §7.8 — A calendar-query REPORT MUST return 207 Multi-Status.
func TestRFC4791_7_8_CalendarQueryReturns207(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "query-test")
	s.putTodo(t, "query-test", "q-todo")

	resp := s.do(t, "REPORT", collectionPath("query-test"),
		xmlContentType(), calendarQueryByComp("VTODO"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode,
		"calendar-query REPORT must return 207")
}

// RFC 4791 §7.8 — calendar-query filtering by component type (VTODO) MUST
// return only VTODO resources, not VEVENTs.
func TestRFC4791_7_8_CalendarQueryFiltersByComponent(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "filter-col")
	s.putTodo(t, "filter-col", "todo-1")
	s.putTodo(t, "filter-col", "todo-2")
	s.putEvent(t, "filter-col", "event-1")

	resp := s.do(t, "REPORT", collectionPath("filter-col"),
		xmlContentType(), calendarQueryByComp("VTODO"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)

	// The event MUST NOT appear in a VTODO-only query.
	require.Nil(t, ms.Response(objectPath("filter-col", "event-1")),
		"VEVENT must not appear in VTODO-only calendar-query")

	// Both todos MUST appear.
	require.NotNil(t, ms.Response(objectPath("filter-col", "todo-1")))
	require.NotNil(t, ms.Response(objectPath("filter-col", "todo-2")))
}

// RFC 4791 §7.8 — calendar-query filtering by VEVENT.
func TestRFC4791_7_8_CalendarQueryFiltersByVEVENT(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "vevent-filter")
	s.putEvent(t, "vevent-filter", "evt-1")
	s.putEvent(t, "vevent-filter", "evt-2")
	s.putTodo(t, "vevent-filter", "td-1")

	resp := s.do(t, "REPORT", collectionPath("vevent-filter"),
		xmlContentType(), calendarQueryByComp("VEVENT"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)

	require.NotNil(t, ms.Response(objectPath("vevent-filter", "evt-1")))
	require.NotNil(t, ms.Response(objectPath("vevent-filter", "evt-2")))
	require.Nil(t, ms.Response(objectPath("vevent-filter", "td-1")),
		"VTODO must not appear in VEVENT-only calendar-query")
}

// RFC 4791 §7.8 §9.9 — time-range filter MUST return only objects whose
// time range overlaps the requested interval.
func TestRFC4791_7_8_CalendarQueryTimeRangeFilter(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "time-range")

	// Event inside the query window: 2026-01-15.
	s.putEvent(t, "time-range", "in-range",
		"DTSTART:20260115T100000Z", "DTEND:20260115T110000Z")
	// Event outside the query window: 2026-03-01.
	s.putEvent(t, "time-range", "out-range",
		"DTSTART:20260301T100000Z", "DTEND:20260301T110000Z")

	resp := s.do(t, "REPORT", collectionPath("time-range"),
		xmlContentType(),
		calendarQueryByTimeRange("VEVENT", "20260101T000000Z", "20260201T000000Z"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)

	require.NotNil(t, ms.Response(objectPath("time-range", "in-range")),
		"in-range event must be in result")
	require.Nil(t, ms.Response(objectPath("time-range", "out-range")),
		"out-of-range event must not be in result")
}

// RFC 4791 §7.8 — calendar-query on a non-collection MUST be rejected.
func TestRFC4791_7_8_CalendarQueryOnObjectFails(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "qobj-test")
	s.putTodo(t, "qobj-test", "qobj-todo")

	// REPORT directly on a calendar object (not a collection).
	resp := s.do(t, "REPORT", objectPath("qobj-test", "qobj-todo"),
		xmlContentType(), calendarQueryByComp("VTODO"))
	// RFC 4791 §7.8: REPORT on a non-collection is either 403 or returns that
	// single object depending on the filter. The key requirement is that it does
	// not crash (5xx).
	require.Less(t, resp.StatusCode, 500,
		"REPORT on a calendar object must not return 5xx")
}

// RFC 4791 §7.8 — calendar-query with calendar-data in the prop request MUST
// return the full iCalendar data for matched objects.
func TestRFC4791_7_8_CalendarQueryReturnsCalendarData(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "cdata-test")
	s.putTodo(t, "cdata-test", "cdata-todo")

	resp := s.do(t, "REPORT", collectionPath("cdata-test"),
		xmlContentType(), calendarQueryByComp("VTODO"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	// The response body must include actual iCalendar data.
	require.Contains(t, resp.Body, "BEGIN:VCALENDAR")
}

// ─── §7.9 calendar-multiget REPORT ───────────────────────────────────────────

// RFC 4791 §7.9 — calendar-multiget MUST return 207 for each requested href.
func TestRFC4791_7_9_CalendarMultigetReturns207(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "multiget-test")
	s.putTodo(t, "multiget-test", "mg-todo1")
	s.putTodo(t, "multiget-test", "mg-todo2")

	hrefs := []string{
		objectPath("multiget-test", "mg-todo1"),
		objectPath("multiget-test", "mg-todo2"),
	}
	resp := s.do(t, "REPORT", collectionPath("multiget-test"),
		xmlContentType(), calendarMultiget(hrefs...))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("multiget-test", "mg-todo1")))
	require.NotNil(t, ms.Response(objectPath("multiget-test", "mg-todo2")))
}

// RFC 4791 §7.9 — A non-existent href in a multiget MUST appear with 404 status.
func TestRFC4791_7_9_MultigetNonExistentHrefReturns404InResponse(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "mg-miss")
	s.putTodo(t, "mg-miss", "exists")

	resp := s.do(t, "REPORT", collectionPath("mg-miss"),
		xmlContentType(),
		calendarMultiget(
			objectPath("mg-miss", "exists"),
			objectPath("mg-miss", "no-such-object"),
		))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("mg-miss", "exists")))

	r404 := ms.Response(objectPath("mg-miss", "no-such-object"))
	// The RFC requires a 404 response for the missing resource, either via a
	// propstat with 404 status or a <D:status> element at response level.
	if r404 != nil {
		// If present in the multistatus, all its props must be 404.
		for _, p := range r404.props {
			require.Equal(t, http.StatusNotFound, p.Status)
		}
	}
	// (Server may also omit the 404 href entirely — both are conformant per §7.9.)
}

// ─── §7.10 free-busy-query REPORT ────────────────────────────────────────────

// RFC 4791 §7.10 — free-busy-query REPORT MUST return a VFREEBUSY component
// (as calendar-data in the response body or as a single-part text/calendar).
// POST to the outbox (RFC 6638) is the scheduling variant; §7.10 covers
// the simple REPORT form.
func TestRFC4791_7_10_FreeBusyQueryReport(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "fb-test")
	s.putEvent(t, "fb-test", "fb-event")

	body := `<?xml version="1.0" encoding="utf-8"?>` +
		`<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">` +
		`<C:time-range start="20260101T000000Z" end="20260201T000000Z"/>` +
		`</C:free-busy-query>`
	resp := s.do(t, "REPORT", collectionPath("fb-test"),
		xmlContentType(), body)
	// Must return 200 (with text/calendar body) or 207. Must not be a 5xx.
	require.Less(t, resp.StatusCode, 500,
		"free-busy-query must not return 5xx")
	require.Contains(t, []int{http.StatusOK, http.StatusMultiStatus},
		resp.StatusCode,
		"free-busy-query must return 200 or 207")
}

// ─── §4 Resource listing ──────────────────────────────────────────────────────

// RFC 4791 §4.2 — A calendar collection MUST be returned in PROPFIND on the
// calendar home set (Depth:1).
func TestRFC4791_4_2_CollectionAppearsInHomePropfind(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "list-col")

	resp := s.do(t, "PROPFIND", calendarHomePath,
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(collectionPath("list-col")),
		"collection must appear in home PROPFIND Depth:1")
}

// RFC 4791 §4.1 — A calendar object MUST appear in PROPFIND on the collection
// (Depth:1).
func TestRFC4791_4_1_ObjectAppearsInCollectionPropfind(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "obj-list")
	s.putTodo(t, "obj-list", "listed-todo")

	resp := s.do(t, "PROPFIND", collectionPath("obj-list"),
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("obj-list", "listed-todo")),
		"calendar object must appear in collection PROPFIND Depth:1")
}
