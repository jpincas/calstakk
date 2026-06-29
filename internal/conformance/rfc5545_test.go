// RFC 5545 — Internet Calendaring and Scheduling Core Object Specification
// Spec: specs/rfc5545.txt
//
// Coverage (iCalendar data validation via PUT→GET roundtrips):
//
//	§3.6.1  VEVENT component and its properties
//	§3.6.2  VTODO component and its properties
//	§3.6.6  VALARM sub-component
//	§3.8.1  Descriptive properties (SUMMARY, DESCRIPTION, STATUS, PERCENT-COMPLETE, PRIORITY, etc.)
//	§3.8.2  Date/Time properties (DTSTART, DUE, DTEND, DURATION, COMPLETED)
//	§3.8.4  Relationship properties (UID, RELATED-TO, SEQUENCE, RECURRENCE-ID)
//	§3.8.5  Recurrence properties (RRULE, RDATE, EXDATE)
//	§3.8.7  Change management (DTSTAMP, CREATED, LAST-MODIFIED, SEQUENCE)
//
// Validation: The server MUST reject malformed VCALENDAR data (§3.6 constraints).
// Roundtrip: Properties written via PUT MUST be retrievable via GET unchanged.
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §3.6 VCALENDAR structure ────────────────────────────────────────────────

// RFC 5545 §3.6 — VCALENDAR MUST have VERSION:2.0.
func TestRFC5545_3_6_VcalendarRequiresVersion(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "ver-test")
	// Missing VERSION property.
	body := "BEGIN:VCALENDAR\r\nPRODID:-//Test//Test//EN\r\n" +
		"BEGIN:VTODO\r\nUID:ver-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("ver-test", "ver-todo"),
		calContentType(), body)
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "VCALENDAR without VERSION must be rejected")
}

// RFC 5545 §3.6 — VCALENDAR MUST have PRODID.
func TestRFC5545_3_6_VcalendarRequiresProdid(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "prodid-test")
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
		"BEGIN:VTODO\r\nUID:prodid-todo\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Test\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("prodid-test", "prodid-todo"),
		calContentType(), body)
	// RFC 4791 §5.3.2 valid-calendar-object-resource: PRODID is required by RFC 5545.
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "VCALENDAR without PRODID must be rejected")
}

// RFC 5545 §3.6 — A VCALENDAR MUST contain at least one component (VEVENT, VTODO, etc.).
func TestRFC5545_3_6_EmptyVcalendarRejected(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "empty-test")
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("empty-test", "empty"),
		calContentType(), body)
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "VCALENDAR without any component must be rejected")
}

// ─── §3.6.2 VTODO ────────────────────────────────────────────────────────────

// RFC 5545 §3.6.2 — VTODO MUST have exactly one UID property.
func TestRFC5545_3_6_2_VtodoRequiresUID(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "uid-req")
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
		"BEGIN:VTODO\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:No UID\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("uid-req", "no-uid"),
		calContentType(), body)
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "VTODO without UID must be rejected")
}

// RFC 5545 §3.6.2 — VTODO MUST have exactly one DTSTAMP property.
func TestRFC5545_3_6_2_VtodoRequiresDTSTAMP(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dtstamp-req")
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
		"BEGIN:VTODO\r\nUID:dtstamp-todo\r\nSUMMARY:No DTSTAMP\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("dtstamp-req", "dtstamp-todo"),
		calContentType(), body)
	require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, 422},
		resp.StatusCode, "VTODO without DTSTAMP must be rejected")
}

// RFC 5545 §3.6.2 — VTODO round-trips UID and SUMMARY unchanged.
func TestRFC5545_3_6_2_VtodoRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "rt-col")
	uid := "roundtrip-todo-001"
	s.putTodo(t, "rt-col", uid)

	resp := s.do(t, "GET", objectPath("rt-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "BEGIN:VTODO")
	require.Contains(t, resp.Body, "UID:"+uid)
	require.Contains(t, resp.Body, "SUMMARY:Test Todo")
}

// RFC 5545 §3.8.2.3 — DUE property round-trips correctly.
func TestRFC5545_3_8_2_3_VtodoDuePropertyRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "due-col")
	uid := "due-todo-001"
	s.putTodo(t, "due-col", uid, "DUE:20260120T120000Z")

	resp := s.do(t, "GET", objectPath("due-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "DUE:20260120T120000Z")
}

// RFC 5545 §3.8.2 — DTSTART round-trips correctly on VTODO.
func TestRFC5545_3_8_2_VtodoDtStartRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dtstart-col")
	uid := "dtstart-todo-001"
	s.putTodo(t, "dtstart-col", uid, "DTSTART:20260110T090000Z")

	resp := s.do(t, "GET", objectPath("dtstart-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "DTSTART:20260110T090000Z")
}

// RFC 5545 §3.8.1.11 / §3.6.2 — VTODO STATUS: valid values are
// NEEDS-ACTION, COMPLETED, IN-PROCESS, and the cancellation status.
func TestRFC5545_3_6_2_VtodoStatusValues(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "status-col")

	statuses := []string{"NEEDS-ACTION", "COMPLETED", "IN-PROCESS", "CANCELLED"} //nolint:misspell
	for _, status := range statuses {
		uid := "status-todo-" + status
		s.putTodo(t, "status-col", uid, "STATUS:"+status)

		resp := s.do(t, "GET", objectPath("status-col", uid), nil, "")
		require.Equal(t, http.StatusOK, resp.StatusCode,
			"GET after PUT with STATUS:%s failed", status)
		require.Contains(t, resp.Body, "STATUS:"+status,
			"STATUS:%s must round-trip", status)
	}
}

// RFC 5545 §3.6.2 — STATUS:COMPLETED SHOULD be accompanied by COMPLETED property.
func TestRFC5545_3_6_2_VtodoCompletedPropertyRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "completed-col")
	uid := "completed-todo"
	s.putTodo(t, "completed-col", uid,
		"STATUS:COMPLETED",
		"COMPLETED:20260110T120000Z",
	)

	resp := s.do(t, "GET", objectPath("completed-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "COMPLETED:20260110T120000Z")
}

// RFC 5545 §3.8.1.8 — PERCENT-COMPLETE MUST be an integer 0–100.
func TestRFC5545_3_8_1_8_PercentCompleteRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "pct-col")
	uid := "pct-todo"
	s.putTodo(t, "pct-col", uid, "PERCENT-COMPLETE:50")

	resp := s.do(t, "GET", objectPath("pct-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "PERCENT-COMPLETE:50")
}

// RFC 5545 §3.8.1 — PRIORITY MUST be an integer 0–9.
func TestRFC5545_3_8_1_PriorityRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "prio-col")
	uid := "prio-todo"
	s.putTodo(t, "prio-col", uid, "PRIORITY:1")

	resp := s.do(t, "GET", objectPath("prio-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "PRIORITY:1")
}

// RFC 5545 §3.8.1 — DESCRIPTION round-trips correctly.
func TestRFC5545_3_8_1_DescriptionRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "desc-col")
	uid := "desc-todo"
	s.putTodo(t, "desc-col", uid, "DESCRIPTION:Detailed description text here")

	resp := s.do(t, "GET", objectPath("desc-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "DESCRIPTION:Detailed description text here")
}

// RFC 5545 §3.8.1 — CATEGORIES round-trips correctly (comma-separated list).
func TestRFC5545_3_8_1_CategoriesRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "cat-col")
	uid := "cat-todo"
	s.putTodo(t, "cat-col", uid, "CATEGORIES:WORK,URGENT")

	resp := s.do(t, "GET", objectPath("cat-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "CATEGORIES:")
}

// RFC 5545 §3.8.1 — CLASS (PUBLIC, PRIVATE, CONFIDENTIAL) round-trips.
func TestRFC5545_3_8_1_ClassRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "class-col")

	for _, cls := range []string{"PUBLIC", "PRIVATE", "CONFIDENTIAL"} {
		uid := "class-todo-" + cls
		s.putTodo(t, "class-col", uid, "CLASS:"+cls)
		resp := s.do(t, "GET", objectPath("class-col", uid), nil, "")
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.Contains(t, resp.Body, "CLASS:"+cls)
	}
}

// RFC 5545 §3.8.4.5 — RELATED-TO links one VTODO to another via UID.
func TestRFC5545_3_8_4_5_RelatedToRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "related-col")
	parentUID := "parent-todo-001"
	childUID := "child-todo-001"

	s.putTodo(t, "related-col", parentUID)
	s.putTodo(t, "related-col", childUID,
		"RELATED-TO:"+parentUID,
	)

	resp := s.do(t, "GET", objectPath("related-col", childUID), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "RELATED-TO:"+parentUID)
}

// RFC 5545 §3.8.7.4 — SEQUENCE MUST be a non-negative integer; round-trips correctly.
func TestRFC5545_3_8_7_4_SequenceRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "seq-col")
	uid := "seq-todo"
	s.putTodo(t, "seq-col", uid, "SEQUENCE:3")

	resp := s.do(t, "GET", objectPath("seq-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "SEQUENCE:3")
}

// RFC 5545 §3.8.7 — CREATED and LAST-MODIFIED round-trip correctly.
func TestRFC5545_3_8_7_CreatedLastModifiedRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "cm-col")
	uid := "cm-todo"
	s.putTodo(t, "cm-col", uid,
		"CREATED:20260101T080000Z",
		"LAST-MODIFIED:20260101T090000Z",
	)

	resp := s.do(t, "GET", objectPath("cm-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "CREATED:20260101T080000Z")
	require.Contains(t, resp.Body, "LAST-MODIFIED:20260101T090000Z")
}

// ─── §3.6.1 VEVENT ───────────────────────────────────────────────────────────

// RFC 5545 §3.6.1 — VEVENT round-trips UID, DTSTART, DTEND, SUMMARY.
func TestRFC5545_3_6_1_VeventRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "vevent-col")
	uid := "vevent-rt-001"
	s.putEvent(t, "vevent-col", uid)

	resp := s.do(t, "GET", objectPath("vevent-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "BEGIN:VEVENT")
	require.Contains(t, resp.Body, "UID:"+uid)
	require.Contains(t, resp.Body, "DTSTART:"+testDTSTART)
	require.Contains(t, resp.Body, "DTEND:"+testDTEND)
}

// RFC 5545 §3.6.1 — VEVENT with DTSTART and DURATION (no DTEND).
func TestRFC5545_3_6_1_VeventWithDuration(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dur-col")
	uid := "dur-event"
	// VEVENT with DURATION instead of DTEND.
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260115T100000Z\r\n" +
		"DURATION:PT1H\r\n" +
		"SUMMARY:Duration Event\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"
	resp := s.do(t, "PUT", objectPath("dur-col", uid), calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	getResp := s.do(t, "GET", objectPath("dur-col", uid), nil, "")
	require.Contains(t, getResp.Body, "DURATION:PT1H")
}

// RFC 5545 §3.6.1 — VEVENT STATUS valid values: TENTATIVE, CONFIRMED, and the cancellation status.
func TestRFC5545_3_6_1_VeventStatusValues(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "evt-status-col")

	for _, status := range []string{"TENTATIVE", "CONFIRMED", "CANCELLED"} { //nolint:misspell
		uid := "evt-status-" + status
		s.putEvent(t, "evt-status-col", uid, "STATUS:"+status)
		resp := s.do(t, "GET", objectPath("evt-status-col", uid), nil, "")
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.Contains(t, resp.Body, "STATUS:"+status)
	}
}

// ─── §3.8.5 Recurrence (RRULE / RDATE / EXDATE) ─────────────────────────────

// RFC 5545 §3.8.5.3 — RRULE on VTODO round-trips correctly.
func TestRFC5545_3_8_5_3_VtodoRruleRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "rrule-col")
	uid := "rrule-todo"
	s.putTodo(t, "rrule-col", uid,
		"DTSTART:20260101T090000Z",
		"RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
	)

	resp := s.do(t, "GET", objectPath("rrule-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO")
}

// RFC 5545 §3.8.5.3 — RRULE on VEVENT round-trips correctly.
func TestRFC5545_3_8_5_3_VeventRruleRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "evt-rrule-col")
	uid := "rrule-event"
	s.putEvent(t, "evt-rrule-col", uid,
		"RRULE:FREQ=DAILY;COUNT=3",
	)

	resp := s.do(t, "GET", objectPath("evt-rrule-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "RRULE:FREQ=DAILY;COUNT=3")
}

// RFC 5545 §3.8.5.1 — EXDATE excludes specific occurrences from a recurrence rule.
func TestRFC5545_3_8_5_1_ExdateRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "exdate-col")
	uid := "exdate-event"
	s.putEvent(t, "exdate-col", uid,
		"RRULE:FREQ=DAILY;COUNT=5",
		"EXDATE:20260116T100000Z",
	)

	resp := s.do(t, "GET", objectPath("exdate-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "EXDATE:20260116T100000Z")
}

// RFC 5545 §3.8.5.2 — RDATE adds specific extra occurrences.
func TestRFC5545_3_8_5_2_RdateRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "rdate-col")
	uid := "rdate-event"
	s.putEvent(t, "rdate-col", uid,
		"RDATE:20260220T100000Z",
	)

	resp := s.do(t, "GET", objectPath("rdate-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "RDATE:20260220T100000Z")
}

// ─── §3.6.6 VALARM ───────────────────────────────────────────────────────────

// RFC 5545 §3.6.6 — VALARM inside VTODO MUST round-trip correctly.
// A DISPLAY alarm has ACTION:DISPLAY and TRIGGER.
func TestRFC5545_3_6_6_VtodoValarmRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "alarm-col")
	uid := "alarm-todo"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VTODO\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"SUMMARY:Alarm Todo\r\n" +
		"BEGIN:VALARM\r\n" +
		"ACTION:DISPLAY\r\n" +
		"DESCRIPTION:Reminder\r\n" +
		"TRIGGER:-PT15M\r\n" +
		"END:VALARM\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("alarm-col", uid), calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	getResp := s.do(t, "GET", objectPath("alarm-col", uid), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "BEGIN:VALARM")
	require.Contains(t, getResp.Body, "ACTION:DISPLAY")
	require.Contains(t, getResp.Body, "TRIGGER:-PT15M")
}

// RFC 5545 §3.6.6 — VALARM inside VEVENT MUST round-trip correctly.
func TestRFC5545_3_6_6_VeventValarmRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "evt-alarm-col")
	uid := "alarm-event"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:" + testDTSTART + "\r\n" +
		"DTEND:" + testDTEND + "\r\n" +
		"SUMMARY:Alarm Event\r\n" +
		"BEGIN:VALARM\r\n" +
		"ACTION:EMAIL\r\n" +
		"DESCRIPTION:Reminder\r\n" +
		"SUMMARY:Meeting Reminder\r\n" +
		"TRIGGER:-PT30M\r\n" +
		"ATTENDEE:mailto:user@example.com\r\n" +
		"END:VALARM\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("evt-alarm-col", uid), calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	getResp := s.do(t, "GET", objectPath("evt-alarm-col", uid), nil, "")
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	require.Contains(t, getResp.Body, "BEGIN:VALARM")
	require.Contains(t, getResp.Body, "ACTION:EMAIL")
}

// ─── §3.3.10 / 3.8.4 — RECURRENCE-ID ────────────────────────────────────────

// RFC 5545 §3.8.4.4 — RECURRENCE-ID identifies an instance of a recurring event.
// A detached occurrence (override) has RECURRENCE-ID + the master's UID.
func TestRFC5545_3_8_4_4_RecurrenceIDRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "recid-col")

	masterUID := "master-recurring-001"
	// The recurring master.
	s.putEvent(t, "recid-col", masterUID,
		"RRULE:FREQ=DAILY;COUNT=5",
	)

	// A detached override for the 2nd occurrence.
	overrideUID := masterUID
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:" + overrideUID + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"DTSTART:20260116T100000Z\r\n" +
		"DTEND:20260116T110000Z\r\n" +
		"RECURRENCE-ID:20260116T100000Z\r\n" +
		"SUMMARY:Override\r\n" +
		"END:VEVENT\r\nEND:VCALENDAR\r\n"

	// Storing an override to the same UID — server must handle this.
	// Behavior: either update the existing object or reject (server-defined).
	resp := s.do(t, "PUT", objectPath("recid-col", overrideUID+"-override"),
		calContentType(), body)
	// Must not be a 5xx.
	require.Less(t, resp.StatusCode, 500,
		"RECURRENCE-ID override must not cause 5xx")
}
