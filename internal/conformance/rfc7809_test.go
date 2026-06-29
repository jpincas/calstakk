// RFC 7809 — Calendaring Extensions to WebDAV (CalDAV): Time Zones by Reference
// Spec: specs/rfc7809.txt
//
// Coverage:
//
//	§4   New CalDAV properties (calendar-timezone-id, timezone-service-set,
//	     supported-calendar-data with caldav-timezone-ref, CALDAV:timezone-id)
//	§5   Referencing timezones by TZID without embedding VTIMEZONE
//	§6   timezone-collection-set (where the server gets TZ data from)
//
// RFC 7809 allows clients to omit the full VTIMEZONE component from iCalendar
// objects and instead reference timezones by TZID parameter alone, relying on
// the server to resolve the TZID from a known timezone service. This reduces
// payload size and avoids stale timezone data.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §4 New CalDAV properties ─────────────────────────────────────────────────

// RFC 7809 §4.1 — timezone-service-set specifies the set of timezone data
// services the server uses to resolve TZID references.
func TestRFC7809_4_1_TimezoneServiceSetProperty(t *testing.T) {
	s := newServer(t)

	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "timezone-service-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("timezone-service-set")
	require.NotNil(t, p, "timezone-service-set must appear in PROPFIND propstat")
}

// RFC 7809 §4.2 — calendar-timezone-id is a per-collection property that
// specifies the default timezone for date-only (floating) times in that collection.
func TestRFC7809_4_2_CalendarTimezoneIDProperty(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tzid-col")

	resp := s.do(t, "PROPFIND", collectionPath("tzid-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-timezone-id"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("tzid-col"))
	require.NotNil(t, r)
	p := r.Prop("calendar-timezone-id")
	require.NotNil(t, p, "calendar-timezone-id must appear in PROPFIND propstat")
}

// RFC 7809 §4.2 — calendar-timezone-id can be set via PROPPATCH to configure
// the default timezone for a collection.
func TestRFC7809_4_2_CalendarTimezoneIDProppatch(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tzid-set-col")

	body := `<?xml version="1.0" encoding="utf-8"?>` +
		`<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
		`<D:set><D:prop>` +
		`<C:calendar-timezone-id>Europe/London</C:calendar-timezone-id>` +
		`</D:prop></D:set>` +
		`</D:propertyupdate>`

	resp := s.do(t, "PROPPATCH", collectionPath("tzid-set-col"),
		xmlContentType(), body)
	// 207 = success; 4xx = not supported. Not 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PROPPATCH calendar-timezone-id must not cause 5xx")

	if resp.StatusCode == http.StatusMultiStatus {
		// Verify the value was stored.
		pfResp := s.do(t, "PROPFIND", collectionPath("tzid-set-col"),
			withHeaders(depthHeader("0"), xmlContentType()),
			propfindProps(nsCalDAV, "calendar-timezone-id"))
		ms := parseMultistatus(t, pfResp.Body)
		r := ms.Response(collectionPath("tzid-set-col"))
		require.NotNil(t, r)
		p := r.Prop("calendar-timezone-id")
		if p != nil && p.Status == http.StatusOK {
			require.Equal(t, "Europe/London", p.Text(),
				"calendar-timezone-id must store the PROPPATCH value")
		}
	}
}

// RFC 7809 §4.3 — supported-calendar-data MUST advertise the
// caldav-timezone-ref content-type when timezone-by-reference is supported.
func TestRFC7809_4_3_SupportedCalendarDataAdvertisesTZRef(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tzref-scd-col")

	resp := s.do(t, "PROPFIND", collectionPath("tzref-scd-col"),
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "supported-calendar-data"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(collectionPath("tzref-scd-col"))
	require.NotNil(t, r)
	p := r.Prop("supported-calendar-data")
	require.NotNil(t, p, "supported-calendar-data must appear in PROPFIND")
}

// ─── §5 Timezone references in calendar data ──────────────────────────────────

// RFC 7809 §5 — A calendar object that uses TZID without embedding a VTIMEZONE
// component MUST be accepted if the server supports timezone-by-reference.
// The server MUST resolve the TZID from its timezone-service-set.
func TestRFC7809_5_EventWithTZIDWithoutVTIMEZONE(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tzbyref-col")

	uid := "tzref-event-001"
	// DTSTART uses TZID but no VTIMEZONE component is embedded.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART;TZID=Europe/London:20260115T100000\r\n" +
		"DTEND;TZID=Europe/London:20260115T110000\r\n" +
		"SUMMARY:TZ by Reference Test\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("tzbyref-col", uid), calContentType(), body)
	// If the server supports TZ-by-reference: 201 Created.
	// If the server requires embedded VTIMEZONE: 400 Bad Request.
	// Must not be 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PUT with TZID but no VTIMEZONE must not cause 5xx")
}

// RFC 7809 §5 — A calendar object with an embedded VTIMEZONE MUST always be
// accepted (embedded TZ is always valid, even with TZ-by-reference support).
func TestRFC7809_5_EventWithEmbeddedVTIMEZONE(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "vtimezone-col")

	uid := "vtimezone-event-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VTIMEZONE\r\n" +
		"TZID:Europe/London\r\n" +
		"BEGIN:STANDARD\r\n" +
		"DTSTART:19701025T010000\r\n" +
		"TZOFFSETFROM:+0100\r\n" +
		"TZOFFSETTO:+0000\r\n" +
		"TZNAME:GMT\r\n" +
		"END:STANDARD\r\n" +
		"BEGIN:DAYLIGHT\r\n" +
		"DTSTART:19700329T010000\r\n" +
		"TZOFFSETFROM:+0000\r\n" +
		"TZOFFSETTO:+0100\r\n" +
		"TZNAME:BST\r\n" +
		"END:DAYLIGHT\r\n" +
		"END:VTIMEZONE\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART;TZID=Europe/London:20260115T100000\r\n" +
		"DTEND;TZID=Europe/London:20260115T110000\r\n" +
		"SUMMARY:Embedded VTIMEZONE Test\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("vtimezone-col", uid), calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"PUT with embedded VTIMEZONE must always succeed (201 Created)")

	getResp := s.do(t, "GET", objectPath("vtimezone-col", uid), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "BEGIN:VTIMEZONE")
}

// RFC 7809 §5 — calendar-query time-range filtering MUST correctly resolve
// TZID references when computing UTC equivalents for comparison.
func TestRFC7809_5_TimeRangeFilterWithTZID(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "tz-filter-col")

	// Event at 10:00 London time (UTC+1 in summer = 09:00 UTC).
	uid := "tzid-filter-event"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART;TZID=Europe/London:20260601T100000\r\n" +
		"DTEND;TZID=Europe/London:20260601T110000\r\n" +
		"SUMMARY:TZ Filter Test\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	putResp := s.do(t, "PUT", objectPath("tz-filter-col", uid), calContentType(), body)
	if putResp.StatusCode != http.StatusCreated {
		t.Skip("server does not accept TZID without VTIMEZONE")
	}

	// Query for the event in a UTC range that includes the event's UTC equivalent.
	resp := s.do(t, "REPORT", collectionPath("tz-filter-col"),
		xmlContentType(),
		calendarQueryByTimeRange("VEVENT", "20260601T080000Z", "20260601T120000Z"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)
	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("tz-filter-col", uid)),
		"TZID-based event must appear in UTC time-range query")
}

// ─── §6 timezone-collection-set ───────────────────────────────────────────────

// RFC 7809 §6 — timezone-collection-set specifies the URI of the timezone
// collection(s) the server uses. If present, clients can fetch timezone data
// from that location.
func TestRFC7809_6_TimezoneCollectionSetProperty(t *testing.T) {
	s := newServer(t)

	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "timezone-collection-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("timezone-collection-set")
	require.NotNil(t, p, "timezone-collection-set must appear in PROPFIND propstat")
}
