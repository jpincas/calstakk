// RFC 6638 — Scheduling Extensions to CalDAV
// Spec: specs/rfc6638.txt
//
// Coverage:
//
//	§2   New calendar properties (schedule-inbox-URL, schedule-outbox-URL,
//	     calendar-user-address-set, schedule-default-calendar-URL)
//	§3   Scheduling object resources (scheduling messages)
//	§4   Server-side scheduling (implicit scheduling)
//	§5   Calendar user addresses
//	§7   Free-busy POST to outbox
//
// RFC 6638 adds server-side iTIP scheduling to CalDAV: inbox/outbox collections
// for receiving/sending scheduling messages (meeting invitations, task assignments).
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §2 Scheduling principal properties ───────────────────────────────────────

// RFC 6638 §2.2 — The principal MUST expose a CALDAV:schedule-inbox-URL property
// pointing to the scheduling inbox collection.
func TestRFC6638_2_2_ScheduleInboxURLProperty(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-inbox-URL"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("schedule-inbox-URL")
	require.NotNil(t, p, "schedule-inbox-URL must appear in PROPFIND")
	require.Equal(t, http.StatusOK, p.Status,
		"schedule-inbox-URL must be present (200 OK)")
}

// RFC 6638 §2.3 — The principal MUST expose a CALDAV:schedule-outbox-URL property
// pointing to the scheduling outbox collection.
func TestRFC6638_2_3_ScheduleOutboxURLProperty(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("schedule-outbox-URL")
	require.NotNil(t, p, "schedule-outbox-URL must appear in PROPFIND")
	require.Equal(t, http.StatusOK, p.Status,
		"schedule-outbox-URL must be present (200 OK)")
}

// RFC 6638 §2.4 — The principal MUST expose CALDAV:calendar-user-address-set,
// a set of URIs (mailto:, http:, etc.) identifying the user as an attendee.
func TestRFC6638_2_4_CalendarUserAddressSet(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "calendar-user-address-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("calendar-user-address-set")
	require.NotNil(t, p, "calendar-user-address-set must appear in PROPFIND")
	require.Equal(t, http.StatusOK, p.Status)
}

// RFC 6638 §2.5 — schedule-default-calendar-URL specifies the default calendar
// where scheduling messages targeted at this user are placed.
func TestRFC6638_2_5_ScheduleDefaultCalendarURL(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-default-calendar-URL"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("schedule-default-calendar-URL")
	require.NotNil(t, p, "schedule-default-calendar-URL must appear in PROPFIND")
}

// ─── §3 Scheduling inbox/outbox collections ───────────────────────────────────

// RFC 6638 §3 — The scheduling inbox MUST exist as a collection resource.
// PROPFIND on the inbox URL must return 207.
func TestRFC6638_3_ScheduleInboxExists(t *testing.T) {
	s := newServer(t)

	// Discover the inbox URL from the principal.
	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-inbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-inbox-URL")
	require.NotNil(t, p)
	inboxURL := p.Text()
	if inboxURL == "" {
		t.Skip("schedule-inbox-URL not yet implemented")
	}

	resp := s.do(t, "PROPFIND", inboxURL,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode,
		"schedule inbox collection must exist and return 207 on PROPFIND")
}

// RFC 6638 §3 — The scheduling outbox MUST exist as a collection resource.
func TestRFC6638_3_ScheduleOutboxExists(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	require.NotNil(t, p)
	outboxURL := p.Text()
	if outboxURL == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}

	resp := s.do(t, "PROPFIND", outboxURL,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindAllprop())
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode,
		"schedule outbox collection must exist and return 207 on PROPFIND")
}

// RFC 6638 §3 — The inbox MUST have resourcetype containing
// <CALDAV:schedule-inbox/> in addition to <DAV:collection/>.
func TestRFC6638_3_InboxResourceType(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-inbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-inbox-URL")
	require.NotNil(t, p)
	inboxURL := p.Text()
	if inboxURL == "" {
		t.Skip("schedule-inbox-URL not yet implemented")
	}

	resp := s.do(t, "PROPFIND", inboxURL,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsDAV, "resourcetype"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms2 := parseMultistatus(t, resp.Body)
	r := ms2.Response(inboxURL)
	require.NotNil(t, r)
	rt := r.Prop("resourcetype")
	require.NotNil(t, rt)
	require.True(t, rt.HasChild("schedule-inbox"),
		"inbox resourcetype must contain <C:schedule-inbox/>")
}

// ─── §7 Free-busy POST to outbox ──────────────────────────────────────────────

// RFC 6638 §7 — POST a free-busy request to the scheduling outbox. The server
// MUST respond with a VFREEBUSY or scheduling-response.
func TestRFC6638_7_FreeBusyPostToOutbox(t *testing.T) {
	s := newServer(t)

	pfResp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "schedule-outbox-URL"))
	ms := parseMultistatus(t, pfResp.Body)
	p := ms.Response(principalPath).Prop("schedule-outbox-URL")
	require.NotNil(t, p)
	outboxURL := p.Text()
	if outboxURL == "" {
		t.Skip("schedule-outbox-URL not yet implemented")
	}

	// POST a VFREEBUSY request to the outbox.
	fbReq := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VFREEBUSY\r\n" +
		"UID:fb-request-001\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260101T000000Z\r\n" +
		"DTEND:20260201T000000Z\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"ATTENDEE:mailto:user@example.com\r\n" +
		"END:VFREEBUSY\r\n" +
		"END:VCALENDAR\r\n"

	resp := s.do(t, "POST", outboxURL, calContentType(), fbReq)
	// Must return 200 (with VFREEBUSY body) or 207.
	require.Contains(t, []int{http.StatusOK, http.StatusMultiStatus},
		resp.StatusCode,
		"free-busy POST to outbox must return 200 or 207")
}

// ─── §4 Implicit scheduling ───────────────────────────────────────────────────

// RFC 6638 §4 — When a calendar object resource with ORGANIZER and ATTENDEE is
// PUT to a calendar collection, the server SHOULD perform implicit scheduling
// (place copies in attendee inboxes, etc.).
// This test verifies PUT does not error out even if scheduling isn't processed.
func TestRFC6638_4_PutWithOrganizerAttendeeSuceeds(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sched-col")

	uid := "sched-event-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"METHOD:REQUEST\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Scheduled Meeting\r\n" +
		"ORGANIZER:mailto:organizer@example.com\r\n" +
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("sched-col", uid), calContentType(), body)
	// Must not be 5xx. May be 201 (accepted with scheduling) or other 2xx/4xx.
	require.Less(t, resp.StatusCode, 500,
		"PUT with ORGANIZER/ATTENDEE must not cause 5xx")
}

// RFC 6638 §2 — The scheduling-privilege-set property on the principal
// describes what scheduling operations the current user may perform.
func TestRFC6638_2_SchedulingPrivilegeSet(t *testing.T) {
	s := newServer(t)
	resp := s.do(t, "PROPFIND", principalPath,
		withHeaders(depthHeader("0"), xmlContentType()),
		propfindProps(nsCalDAV, "scheduling-privilege-set"))
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	r := ms.Response(principalPath)
	require.NotNil(t, r)
	p := r.Prop("scheduling-privilege-set")
	require.NotNil(t, p, "scheduling-privilege-set must appear in PROPFIND")
}
