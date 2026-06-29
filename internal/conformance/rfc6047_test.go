// RFC 6047 — iCalendar Message-Based Interoperability Protocol (iMIP)
// Spec: specs/rfc6047.txt
//
// Coverage:
//
//	§2   iMIP Content-Type (text/calendar; method=<METHOD>)
//	§3   Sending scheduling messages over email (MIME encapsulation)
//	§4   Receiving scheduling messages
//
// iMIP defines how iTIP messages are transported over email (MIME). In CalDAV
// context, it is relevant to:
//  1. The Content-Type for PUT/POST of scheduling messages containing METHOD.
//  2. The server's ability to parse method-bearing iCalendar MIME entities.
//  3. The scheduling inbox (RFC 6638) receiving iMIP-formatted messages.
//
// Most iMIP functionality is email transport (MUA/MTA), not HTTP. These tests
// focus on the CalDAV-side surface: MIME content-type handling and structural
// validation of iMIP-formatted iCalendar objects.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §2 iMIP Content-Type ────────────────────────────────────────────────────

// RFC 6047 §2 — An iMIP message uses Content-Type: text/calendar; method=<METHOD>.
// When POSTing a scheduling message to the CalDAV scheduling outbox, the
// Content-Type parameter "method" MUST be present and MUST match the METHOD
// property in the VCALENDAR component.
func TestRFC6047_2_ContentTypeWithMethodParameter(t *testing.T) {
	s := newServer(t)

	// Discover the outbox URL.
	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	if p == nil || p.Text() == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}
	outboxURL := p.Text()

	// POST with text/calendar; method=REQUEST.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:imip-test-001\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:iMIP Test Meeting\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "POST", outboxURL,
		map[string]string{"Content-Type": "text/calendar; method=REQUEST"},
		body)
	require.Contains(t, []int{http.StatusOK, http.StatusMultiStatus, http.StatusAccepted},
		resp.StatusCode,
		"POST with text/calendar; method=REQUEST must be accepted")
}

// RFC 6047 §2 — POST with mismatched method parameter and METHOD property
// MUST be rejected.
func TestRFC6047_2_MismatchedMethodParameterRejected(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	if p == nil || p.Text() == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}
	outboxURL := p.Text()

	// Content-Type says REPLY but METHOD is REQUEST — mismatch.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:imip-mismatch-001\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Mismatch Test\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "POST", outboxURL,
		map[string]string{"Content-Type": "text/calendar; method=REPLY"},
		body)
	// Server SHOULD reject this with 4xx.
	require.GreaterOrEqual(t, resp.StatusCode, 400,
		"mismatched method parameter must be rejected with 4xx")
	require.Less(t, resp.StatusCode, 500,
		"rejection must not be 5xx")
}

// ─── §3 Structural validation ─────────────────────────────────────────────────

// RFC 6047 §3 / RFC 5546 §3 — A REQUEST message MUST have ORGANIZER set.
func TestRFC6047_3_RequestMustHaveOrganizer(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	if p == nil || p.Text() == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}
	outboxURL := p.Text()

	// REQUEST without ORGANIZER — invalid per RFC 5546 §3.2.2.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:imip-no-organizer-001\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:No Organizer\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "POST", outboxURL,
		map[string]string{"Content-Type": "text/calendar; method=REQUEST"},
		body)
	require.GreaterOrEqual(t, resp.StatusCode, 400,
		"REQUEST without ORGANIZER must be rejected")
	require.Less(t, resp.StatusCode, 500)
}

// RFC 6047 §3 / RFC 5546 §3.2.4 — A CANCEL message MUST have ORGANIZER set
// and MUST reference the UID of the event being canceled.
func TestRFC6047_3_CancelMessageStructure(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "imip-cancel-col")

	// Store an event to cancel.
	origUID := "imip-cancel-evt-001"
	s.putEvent(t, "imip-cancel-col", origUID,
		"ORGANIZER:mailto:organizer@example.com",
		"ATTENDEE;PARTSTAT=ACCEPTED:mailto:attendee@example.com",
	)

	// Retrieve the outbox and POST a CANCEL.
	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	if p == nil || p.Text() == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}
	outboxURL := p.Text()

	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:CANCEL\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + origUID + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"ATTENDEE:mailto:attendee@example.com\r\n" +
		"SEQUENCE:1\r\n" +
		"STATUS:CANCELLED\r\n" + //nolint:misspell // RFC 5545 §3.8.1.11 value
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "POST", outboxURL,
		map[string]string{"Content-Type": "text/calendar; method=CANCEL"},
		body)
	require.Less(t, resp.StatusCode, 500,
		"CANCEL POST to outbox must not cause 5xx")
}

// ─── §4 Receiving scheduling messages ─────────────────────────────────────────

// RFC 6047 §4 / RFC 6638 §3 — A scheduling message received in the inbox
// (placed there by the server after implicit scheduling) MUST be retrievable
// via PROPFIND/GET on the inbox collection.
func TestRFC6047_4_InboxCanReceiveSchedulingMessages(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-inbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-inbox-URL")
	if p == nil || p.Text() == "" {
		t.Skip("schedule-inbox-URL not yet implemented")
	}
	inboxURL := p.Text()

	// PROPFIND on the inbox (Depth:1) lists any pending scheduling messages.
	resp := s.do(t, "PROPFIND", inboxURL,
		withHeaders(depthHeader("1"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode,
		"PROPFIND on scheduling inbox must return 207")
}
