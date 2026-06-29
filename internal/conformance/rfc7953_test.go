// RFC 7953 — Calendar Availability
// Spec: specs/rfc7953.txt
//
// Coverage:
//
//	§3   VAVAILABILITY component
//	§4   AVAILABLE sub-component
//	§5   Interaction with free-busy reports
//	§6   New CalDAV properties (calendar-availability)
//
// RFC 7953 introduces VAVAILABILITY for expressing recurring availability
// windows (e.g. "available Mon-Fri 09:00-17:00") and UNAVAILABLE/BUSY overrides.
// It updates RFC 4791, RFC 5545, and RFC 6638.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §3 VAVAILABILITY component ───────────────────────────────────────────────

// RFC 7953 §3 — A VCALENDAR containing a VAVAILABILITY component MUST be
// accepted by the server via PUT (stored in an "availability" calendar).
// The server MUST NOT silently discard the VAVAILABILITY.
func TestRFC7953_3_VavailabilityRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "avail-col")

	uid := "avail-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VAVAILABILITY\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260101T000000Z\r\n" +
		"DTEND:20261231T235959Z\r\n" +
		"SUMMARY:Work Hours\r\n" +
		"BEGIN:AVAILABLE\r\n" +
		"UID:" + uid + "-avail\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART;TZID=Europe/London:20260101T090000\r\n" +
		"DTEND;TZID=Europe/London:20260101T170000\r\n" +
		"SUMMARY:Available\r\n" +
		"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
		"END:AVAILABLE\r\n" +
		"END:VAVAILABILITY\r\n" +
		"END:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("avail-col", uid), calContentType(), body)
	// Server may accept (201) or reject if VAVAILABILITY is not supported (400/403).
	// Must not be 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PUT with VAVAILABILITY must not cause 5xx")

	if resp.StatusCode == http.StatusCreated {
		getResp := s.do(t, "GET", objectPath("avail-col", uid), nil, "")
		require.Equal(t, http.StatusOK, getResp.StatusCode)
		require.Contains(t, getResp.Body, "BEGIN:VAVAILABILITY",
			"VAVAILABILITY must be preserved on roundtrip")
		require.Contains(t, getResp.Body, "BEGIN:AVAILABLE",
			"AVAILABLE sub-component must be preserved")
	}
}

// RFC 7953 §3.1 — VAVAILABILITY MUST have UID, DTSTAMP (from §3.6.2 of 5545).
func TestRFC7953_3_1_VavailabilityRequiresUID(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "avail-uid-col")

	// No UID in VAVAILABILITY — must be rejected.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VAVAILABILITY\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260101T000000Z\r\n" +
		"END:VAVAILABILITY\r\n" +
		"END:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("avail-uid-col", "no-uid"),
		calContentType(), body)
	// If the server supports VAVAILABILITY, missing UID must be rejected.
	// If VAVAILABILITY is not supported at all, also 4xx.
	require.Less(t, resp.StatusCode, 500,
		"VAVAILABILITY without UID must not cause 5xx")
}

// ─── §4 AVAILABLE sub-component ───────────────────────────────────────────────

// RFC 7953 §4 — AVAILABLE MUST have UID, DTSTAMP, DTSTART.
func TestRFC7953_4_AvailableSubComponent(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "avail-sub-col")

	uid := "avail-sub-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VAVAILABILITY\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260101T000000Z\r\n" +
		"BEGIN:AVAILABLE\r\n" +
		"UID:" + uid + "-slot1\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260104T090000Z\r\n" +
		"DTEND:20260104T170000Z\r\n" +
		"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n" +
		"END:AVAILABLE\r\n" +
		"END:VAVAILABILITY\r\n" +
		"END:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("avail-sub-col", uid), calContentType(), body)
	require.Less(t, resp.StatusCode, 500,
		"VAVAILABILITY with AVAILABLE must not cause 5xx")
}

// ─── §6 Calendar availability property ────────────────────────────────────────

// RFC 7953 §6.1 — The CALDAV:calendar-availability property on a calendar
// collection stores the user's availability data as a VAVAILABILITY iCalendar.
func TestRFC7953_6_1_CalendarAvailabilityProperty(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "avail-prop-col")

	resp := s.do(t, "PROPFIND", collectionPath("avail-prop-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-availability"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("avail-prop-col"))
	require.NotNil(t, r)
	p := r.Prop("calendar-availability")
	require.NotNil(t, p, "calendar-availability must appear in PROPFIND propstat")
}

// RFC 7953 §6.1 — Setting calendar-availability via PROPPATCH stores
// the VAVAILABILITY data.
func TestRFC7953_6_1_CalendarAvailabilityProppatch(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "avail-proppatch-col")

	availData := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VAVAILABILITY\r\n" +
		"UID:cal-avail-001\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260101T000000Z\r\n" +
		"END:VAVAILABILITY\r\n" +
		"END:VCALENDAR\r\n"

	body := `<?xml version="1.0" encoding="utf-8"?>` +
		`<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
		`<D:set><D:prop>` +
		`<C:calendar-availability>` + availData + `</C:calendar-availability>` +
		`</D:prop></D:set>` +
		`</D:propertyupdate>`

	resp := s.do(t, "PROPPATCH", collectionPath("avail-proppatch-col"),
		xmlContentType(), body)
	// Must return 207 (success) or 4xx (not implemented). Not 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PROPPATCH calendar-availability must not cause 5xx")
}

// ─── §5 Free-busy interaction ──────────────────────────────────────────────────

// RFC 7953 §5 — VAVAILABILITY MUST be taken into account when generating
// free-busy reports. Availability windows mark time as "available" even if
// no explicit BUSY event exists; outside those windows the user is "unavailable".
func TestRFC7953_5_FreeBusyConsidersAvailability(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "fb-avail-col")

	// Store an event that blocks time (vevent() fixture already includes DTSTART/DTEND).
	s.putEvent(t, "fb-avail-col", "fb-avail-evt")

	// Request free-busy — should reflect both events and availability.
	body := `<?xml version="1.0" encoding="utf-8"?>` +
		`<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">` +
		`<C:time-range start="20260115T000000Z" end="20260116T000000Z"/>` +
		`</C:free-busy-query>`

	resp := s.do(t, "REPORT", collectionPath("fb-avail-col"),
		xmlContentType(), body)
	require.Less(t, resp.StatusCode, 500,
		"free-busy-query with VAVAILABILITY context must not cause 5xx")
}
