// RFC 9253 — Support for iCalendar Relationships
// Spec: specs/rfc9253.txt
//
// Coverage:
//
//	§3   New RELTYPE parameter values (PARENT, CHILD, SIBLING, CONCEPT,
//	     DEPENDS-ON, REFID, STRUCTURED-DATA)
//	§4   The GAP parameter
//	§5   The LINK property
//
// RFC 9253 extends RELATED-TO in RFC 5545 §3.8.4.5 with richer relationship
// types crucial for VTODO task modeling (subtasks, dependencies, concepts).
package conformance

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// ─── §3 RELTYPE parameter values ──────────────────────────────────────────────

// RFC 9253 §3 — RELATED-TO with RELTYPE=PARENT links a child task to its parent.
func TestRFC9253_3_RelatedToParentRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "rel-col")

	parentUID := "parent-task-001"
	childUID := "child-task-001"
	s.putTodo(t, "rel-col", parentUID)
	s.putTodo(t, "rel-col", childUID,
		`RELATED-TO;RELTYPE=PARENT:`+parentUID,
	)

	resp := s.do(t, "GET", objectPath("rel-col", childUID), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "PARENT")
	require.Contains(t, resp.Body, parentUID)
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=CHILD links a parent task to its child.
func TestRFC9253_3_RelatedToChildRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "child-col")

	parentUID := "parent-ref-001"
	childUID := "child-ref-001"
	s.putTodo(t, "child-col", childUID)
	s.putTodo(t, "child-col", parentUID,
		`RELATED-TO;RELTYPE=CHILD:`+childUID,
	)

	resp := s.do(t, "GET", objectPath("child-col", parentUID), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "CHILD")
	require.Contains(t, resp.Body, childUID)
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=SIBLING links two peer tasks.
func TestRFC9253_3_RelatedToSiblingRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sib-col")

	uid1 := "sibling-a-001"
	uid2 := "sibling-b-001"
	s.putTodo(t, "sib-col", uid1)
	s.putTodo(t, "sib-col", uid2,
		`RELATED-TO;RELTYPE=SIBLING:`+uid1,
	)

	resp := s.do(t, "GET", objectPath("sib-col", uid2), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "SIBLING")
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=DEPENDS-ON models a dependency between tasks.
func TestRFC9253_3_RelatedToDependsOnRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "dep-col")

	prereqUID := "prereq-task-001"
	depUID := "dependent-task-001"
	s.putTodo(t, "dep-col", prereqUID)
	s.putTodo(t, "dep-col", depUID,
		`RELATED-TO;RELTYPE=DEPENDS-ON:`+prereqUID,
	)

	resp := s.do(t, "GET", objectPath("dep-col", depUID), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "DEPENDS-ON")
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=CONCEPT links a task to a concept.
func TestRFC9253_3_RelatedToConceptRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "concept-col")

	uid := "concept-task-001"
	s.putTodo(t, "concept-col", uid,
		`RELATED-TO;RELTYPE=CONCEPT:urn:example:concepts:projectmanagement`,
	)

	resp := s.do(t, "GET", objectPath("concept-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "CONCEPT")
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=REFID links tasks sharing a common
// external reference (e.g. a project ID or ticket number).
func TestRFC9253_3_RelatedToRefidRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "refid-col")

	uid1 := "refid-task-001"
	uid2 := "refid-task-002"
	refid := "urn:example:project:42"
	s.putTodo(t, "refid-col", uid1, `RELATED-TO;RELTYPE=REFID:`+refid)
	s.putTodo(t, "refid-col", uid2, `RELATED-TO;RELTYPE=REFID:`+refid)

	resp1 := s.do(t, "GET", objectPath("refid-col", uid1), nil, "")
	require.Equal(t, http.StatusOK, resp1.StatusCode)
	require.Contains(t, resp1.Body, "REFID")

	resp2 := s.do(t, "GET", objectPath("refid-col", uid2), nil, "")
	require.Equal(t, http.StatusOK, resp2.StatusCode)
	require.Contains(t, resp2.Body, "REFID")
}

// RFC 9253 §3 — RELATED-TO with RELTYPE=STRUCTURED-DATA links to structured data.
func TestRFC9253_3_RelatedToStructuredDataRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "sd-col")

	uid := "sd-task-001"
	s.putTodo(t, "sd-col", uid,
		`RELATED-TO;RELTYPE=STRUCTURED-DATA:https://example.com/data/42`,
	)

	resp := s.do(t, "GET", objectPath("sd-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "STRUCTURED-DATA")
}

// ─── Multiple RELATED-TO values ────────────────────────────────────────────────

// RFC 9253 §3 — A VTODO MAY have multiple RELATED-TO properties (RFC 5545 §3.6.2
// allows any number). Each expresses a distinct relationship.
func TestRFC9253_3_MultipleRelatedToPropertiesRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "multi-rel-col")

	parentUID := "multi-parent-001"
	depUID := "multi-dep-001"
	taskUID := "multi-task-001"

	s.putTodo(t, "multi-rel-col", parentUID)
	s.putTodo(t, "multi-rel-col", depUID)
	s.putTodo(t, "multi-rel-col", taskUID,
		`RELATED-TO;RELTYPE=PARENT:`+parentUID,
		`RELATED-TO;RELTYPE=DEPENDS-ON:`+depUID,
	)

	resp := s.do(t, "GET", objectPath("multi-rel-col", taskUID), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, parentUID)
	require.Contains(t, resp.Body, depUID)
}

// ─── §4 GAP parameter ─────────────────────────────────────────────────────────

// RFC 9253 §4 — The GAP parameter on RELATED-TO specifies a duration offset
// between the completion of a predecessor and the start of the successor.
func TestRFC9253_4_GapParameterRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "gap-col")

	uid := "gap-task-001"
	prereqUID := "gap-prereq-001"
	s.putTodo(t, "gap-col", prereqUID)
	s.putTodo(t, "gap-col", uid,
		`RELATED-TO;RELTYPE=DEPENDS-ON;GAP=PT1H:`+prereqUID,
	)

	resp := s.do(t, "GET", objectPath("gap-col", uid), nil, "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Body, "GAP=PT1H")
}

// ─── §5 LINK property ─────────────────────────────────────────────────────────

// RFC 9253 §5 — The LINK property provides a typed URL to an external resource
// associated with the component. This is distinct from URL (§3.8.4.6 of 5545).
func TestRFC9253_5_LinkPropertyRoundtrip(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "link-col")

	uid := "link-task-001"
	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalStakk//ConformanceTest//EN\r\n" +
		"BEGIN:VTODO\r\n" +
		"UID:" + uid + "\r\n" +
		"DTSTAMP:" + testDTSTAMP + "\r\n" +
		"SUMMARY:Link Test\r\n" +
		"LINK;LINKREL=related:https://example.com/related-resource\r\n" +
		"END:VTODO\r\nEND:VCALENDAR\r\n"

	resp := s.do(t, "PUT", objectPath("link-col", uid), calContentType(), body)
	// LINK is a new property from RFC 9253. Server may accept (2xx) or reject
	// with 400 if it does not recognize it. Must not be 5xx.
	require.Less(t, resp.StatusCode, 500,
		"PUT with LINK property must not cause 5xx")

	if resp.StatusCode == http.StatusCreated {
		getResp := s.do(t, "GET", objectPath("link-col", uid), nil, "")
		require.Equal(t, http.StatusOK, getResp.StatusCode)
		require.Contains(t, getResp.Body, "LINK")
	}
}

// ─── calendar-query with RELATED-TO filter ────────────────────────────────────

// RFC 4791 §7.8 + RFC 9253 §3 — A calendar-query SHOULD be able to filter
// VTODO components by RELATED-TO property value, enabling task hierarchy retrieval.
func TestRFC9253_3_CalendarQueryFilterByRelatedTo(t *testing.T) {
	s := newServer(t)
	s.mkcol(t, "relquery-col")

	parentUID := "relq-parent-001"
	s.putTodo(t, "relquery-col", parentUID)
	s.putTodo(t, "relquery-col", "relq-child-001",
		`RELATED-TO;RELTYPE=PARENT:`+parentUID,
	)
	s.putTodo(t, "relquery-col", "relq-unrelated-001")

	// Query for tasks with RELATED-TO matching the parent UID.
	body := `<?xml version="1.0" encoding="utf-8"?>` +
		`<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
		`<D:prop><D:getetag/></D:prop>` +
		`<C:filter><C:comp-filter name="VCALENDAR">` +
		`<C:comp-filter name="VTODO">` +
		`<C:prop-filter name="RELATED-TO">` +
		`<C:text-match>` + parentUID + `</C:text-match>` +
		`</C:prop-filter>` +
		`</C:comp-filter></C:comp-filter></C:filter>` +
		`</C:calendar-query>`

	resp := s.do(t, "REPORT", collectionPath("relquery-col"),
		xmlContentType(), body)
	require.Equal(t, http.StatusMultiStatus, resp.StatusCode)

	ms := parseMultistatus(t, resp.Body)
	require.NotNil(t, ms.Response(objectPath("relquery-col", "relq-child-001")),
		"child task must appear in RELATED-TO filter query")
	require.Nil(t, ms.Response(objectPath("relquery-col", "relq-unrelated-001")),
		"unrelated task must NOT appear in RELATED-TO filter query")
}
