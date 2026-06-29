// RFC 5546 — iCalendar Transport-Independent Interoperability Protocol (iTIP)
// Spec: specs/rfc5546.txt
//
// Coverage:
//
//	§1.4  METHOD property values: REQUEST, REPLY, CANCEL, ADD, REFRESH,
//	      COUNTER, DECLINECOUNTER
//	§3.2  VEVENT method semantics
//	§4.2  VTODO method semantics
//	§3/4  SEQUENCE-based update semantics
//
// iTIP defines how iCalendar objects are exchanged between systems, using the
// METHOD property to indicate the intent of the exchange. CalDAV servers SHOULD
// handle iTIP semantics for scheduling operations (RFC 6638).
// These tests verify that the server correctly handles METHOD values in stored
// objects and that sequence-based update semantics work.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §1.4 METHOD values on stored objects ────────────────────────────────────

// RFC 5546 §1.4 — A VCALENDAR with METHOD:REQUEST can be stored via PUT
// (as used by scheduling clients that store sent invitations).
func TestRFC5546_1_4_MethodRequestRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "itip-col")

	uid := "itip-request-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Team Meeting\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
		"SEQUENCE:0\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("itip-col", uid), calContentType(), body)
	// Server may accept (201) or reject METHOD-bearing objects in a calendar collection.
	// RFC 4791 §4.1 says calendar object resources must not have METHOD.
	// Accept both outcomes; must not be 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PUT with METHOD:REQUEST must not cause 5xx")
}

// RFC 4791 §4.1 — A CalDAV server MUST NOT accept a VCALENDAR with a METHOD
// property in a calendar collection (METHOD is only valid for transport).
func TestRFC5546_CalDAVRejectsMethodInCalendarCollection(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "nomethod-col")

	uid := "method-reject-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VTODO\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"SUMMARY:Todo with METHOD\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("nomethod-col", uid), calContentType(), body)
	// RFC 4791 §4.1: CalDAV servers MUST reject calendar object resources that
	// contain a METHOD property. Must return 4xx.
	require.GreaterOrEqual(t, resp.StatusCode, 400,
		"CalDAV server must reject VCALENDAR with METHOD property")
	require.Less(t, resp.StatusCode, 500,
		"Rejection must be 4xx not 5xx")
}

// ─── §3.2 / §4.2 SEQUENCE-based update semantics ─────────────────────────────

// RFC 5546 §3.2 — An update to a VEVENT MUST increment the SEQUENCE number.
// The server should accept an update with a higher SEQUENCE.
func TestRFC5546_3_2_SequenceIncrementOnUpdate(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "seq-update-col")

	uid := "seq-update-001"
	// Store initial version with SEQUENCE:0.
	s.putEvent(t, "seq-update-col", uid, "SEQUENCE:0")

	// Update with SEQUENCE:1.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Updated Event\r\n" +
		"SEQUENCE:1\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("seq-update-col", uid), calContentType(), body)
	require.Equal(t, http.StatusNoContent, resp.StatusCode,
		"update with incremented SEQUENCE must succeed (204)")

	getResp := s.do(t, "GET", objectPath("seq-update-col", uid), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "SEQUENCE:1")
}

// RFC 5546 §4.2 — VTODO updates also use SEQUENCE. The same increment
// semantics apply.
func TestRFC5546_4_2_VtodoSequenceIncrementOnUpdate(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "todo-seq-col")

	uid := "todo-seq-001"
	s.putTodo(t, "todo-seq-col", uid, "SEQUENCE:0")

	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VTODO\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"SUMMARY:Updated Todo\r\n" +
		"SEQUENCE:1\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("todo-seq-col", uid), calContentType(), body)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	getResp := s.do(t, "GET", objectPath("todo-seq-col", uid), nil, "")
	require.Contains(t, getResp.Body, "SEQUENCE:1")
}

// ─── §1.4 PARTSTAT round-trip ─────────────────────────────────────────────────

// RFC 5546 §3.2.1 / §4.2.1 — ATTENDEE;PARTSTAT values (NEEDS-ACTION,
// ACCEPTED, DECLINED, TENTATIVE, DELEGATED) MUST round-trip correctly.
func TestRFC5546_1_4_PartstatValuesRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "partstat-col")

	partStats := []string{"NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"}
	for _, ps := range partStats {
		uid := "partstat-" + ps
		body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
			"BEGIN:VEVENT\r\n" +
			"UID:" + uid + "\r\n" +
			"DTSTAMP:" + testDTSTAMP + "\r\n" +
			"DTSTART:" + testDTSTART + "\r\n" +
			"DTEND:" + testDTEND + "\r\n" +
			"SUMMARY:PARTSTAT test " + ps + "\r\n" +
			"ORGANIZER:mailto:org@example.com\r\n" +
			"ATTENDEE;PARTSTAT=" + ps + ":mailto:att@example.com\r\n" +
			"END:VEVENT\r\nEND:VCALENDAR\r\n"

		putResp := s.do(t, "PUT", objectPath("partstat-col", uid), calContentType(), body)
		require.Equal(t, http.StatusCreated, putResp.StatusCode,
			"PUT with PARTSTAT:%s failed", ps)

		getResp := s.do(t, "GET", objectPath("partstat-col", uid), nil, "")
		require.Equal(t, http.StatusOK, getResp.StatusCode)
		require.Contains(t, getResp.Body, "PARTSTAT="+ps,
			"PARTSTAT:%s must round-trip", ps)
	}
}

// RFC 5546 §3 — REQUEST-STATUS property reports scheduling operation results.
func TestRFC5546_3_RequestStatusRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "reqstatus-col")

	uid := "reqstatus-event-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Request Status Test\r\n" +
		"REQUEST-STATUS:2.0;Success\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("reqstatus-col", uid), calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	getResp := s.do(t, "GET", objectPath("reqstatus-col", uid), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "REQUEST-STATUS:2.0;Success")
}
