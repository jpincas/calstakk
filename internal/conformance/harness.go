// Package conformance is an RFC-driven HTTP conformance test suite for CalStakk.
//
// Every test boots the real server in-process via httptest.NewServer and fires
// raw HTTP requests, asserting exact wire-level behavior: status codes, response
// headers, and the XML bodies mandated by the relevant RFC.  Test names embed
// the RFC number and section so failures map directly to spec clauses.
//
// Red/green contract: tests fail for real until the backend implements the
// feature. `make conformance` shows the current pass/fail score. `make
// check-fast` (lint + build) stays green throughout build-out.
//
// Spec sources: specs/rfc*.txt (RFC text files in the repository root).
package conformance

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jpincas/calstakk/internal/backend"
	"github.com/jpincas/calstakk/internal/server"
	"github.com/jpincas/calstakk/internal/storage"
	"github.com/stretchr/testify/require"
)

// ─── XML namespaces ───────────────────────────────────────────────────────────

const (
	nsDAV    = "DAV:"
	nsCalDAV = "urn:ietf:params:xml:ns:caldav"
	nsCS     = "http://calendarserver.org/ns/"
)

// ─── CalDAV path constants ────────────────────────────────────────────────────

const (
	principalPath    = storage.PrincipalPath    // /calstakk
	calendarHomePath = storage.CalendarHomePath // /calstakk/calendars
)

func collectionPath(name string) string {
	return calendarHomePath + "/" + name
}

func objectPath(collection, uid string) string {
	return calendarHomePath + "/" + collection + "/" + uid + ".ics"
}

// ─── In-process test server ───────────────────────────────────────────────────

// srv wraps an in-process CalDAV server for conformance testing.
type srv struct {
	ts   *httptest.Server
	base string
}

// newServer boots an in-process CalDAV server backed by a temp directory.
// The server is closed automatically when the test ends.
func newServer(t *testing.T) *srv {
	t.Helper()
	store, err := storage.New(t.TempDir())
	require.NoError(t, err)
	be := backend.New(store)
	hs := server.New(be)
	ts := httptest.NewServer(hs)
	t.Cleanup(ts.Close)
	return &srv{ts: ts, base: ts.URL}
}

// ─── Raw HTTP helpers ─────────────────────────────────────────────────────────

// rawResp is the result of a raw HTTP round-trip.
type rawResp struct {
	StatusCode int
	Header     http.Header
	Body       string
}

// do issues an arbitrary HTTP method with optional headers and body.
// Redirects are followed (use doNoRedirect for redirect-checking tests).
func (s *srv) do(t *testing.T, method, path string, headers map[string]string, body string) *rawResp {
	t.Helper()
	return s.request(t, s.ts.Client(), method, path, headers, body)
}

// doNoRedirect issues a request without following redirects.
// The returned response reflects the raw 3xx redirect, not the final target.
func (s *srv) doNoRedirect(t *testing.T, method, path string, headers map[string]string, body string) *rawResp {
	t.Helper()
	client := &http.Client{
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: s.ts.Client().Transport,
	}
	return s.request(t, client, method, path, headers, body)
}

func (s *srv) request(t *testing.T, client *http.Client, method, path string, headers map[string]string, body string) *rawResp {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, s.base+path, bodyReader)
	require.NoError(t, err)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return &rawResp{
		StatusCode: resp.StatusCode,
		Header:     resp.Header,
		Body:       string(data),
	}
}

// ─── Multistatus XML parsing ──────────────────────────────────────────────────

// Multistatus is a parsed DAV:multistatus response body.
type Multistatus struct {
	Responses []*MSResponse
}

// Response returns the DAV:response for the given href path, or nil.
func (ms *Multistatus) Response(href string) *MSResponse {
	for _, r := range ms.Responses {
		if r.Href == href {
			return r
		}
	}
	return nil
}

// Len returns the number of responses.
func (ms *Multistatus) Len() int { return len(ms.Responses) }

// MSResponse is a single DAV:response within a multistatus.
type MSResponse struct {
	Href  string
	props map[string]*MSProp // "{ns}local" → prop
}

// Prop returns the property with the given local name (searches all namespaces).
// Returns nil if the property is not present in any propstat.
func (r *MSResponse) Prop(local string) *MSProp {
	if r == nil {
		return nil
	}
	suffix := "}" + local
	for k, v := range r.props {
		if strings.HasSuffix(k, suffix) || k == local {
			return v
		}
	}
	return nil
}

// PropStatus returns the HTTP status code for the named property, or 0.
func (r *MSResponse) PropStatus(local string) int {
	p := r.Prop(local)
	if p == nil {
		return 0
	}
	return p.Status
}

// MSProp is a property entry from a DAV:propstat.
type MSProp struct {
	Status   int      // HTTP status from the enclosing propstat
	text     string   // concatenated character data
	children []string // local names of first-level child elements
}

// Text returns the plain-text content of the property value.
func (p *MSProp) Text() string {
	if p == nil {
		return ""
	}
	return p.text
}

// HasChild returns true if the property value contains a direct child element
// with the given local name.
func (p *MSProp) HasChild(local string) bool {
	if p == nil {
		return false
	}
	for _, c := range p.children {
		if c == local {
			return true
		}
	}
	return false
}

// ─── XML unmarshal intermediates ──────────────────────────────────────────────

type xmlMSInner struct {
	InnerXML string `xml:",innerxml"`
}

type xmlMSPropstat struct {
	Prop   xmlMSInner `xml:"prop"`
	Status string     `xml:"status"`
}

type xmlMSResponse struct {
	Href      string          `xml:"href"`
	Propstats []xmlMSPropstat `xml:"propstat"`
	Status    string          `xml:"status"`
}

type xmlMultistatus struct {
	XMLName   xml.Name        `xml:"multistatus"`
	Responses []xmlMSResponse `xml:"response"`
}

// parseMultistatus parses a DAV:multistatus XML body into a Multistatus.
// The test fails immediately if the XML is malformed.
func parseMultistatus(t *testing.T, body string) *Multistatus {
	t.Helper()
	var raw xmlMultistatus
	require.NoError(t, xml.Unmarshal([]byte(body), &raw),
		"parseMultistatus: invalid XML:\n%s", body)

	ms := &Multistatus{}
	for _, rr := range raw.Responses {
		mr := &MSResponse{
			Href:  rr.Href,
			props: make(map[string]*MSProp),
		}
		for _, ps := range rr.Propstats {
			code := parseHTTPStatus(ps.Status)
			for key, prop := range extractProps(ps.Prop.InnerXML, code) {
				mr.props[key] = prop
			}
		}
		ms.Responses = append(ms.Responses, mr)
	}
	return ms
}

// extractProps tokenises the inner XML of a <DAV:prop> element and returns a
// map of "{ns}local" → MSProp for each child property element.
// A namespace-declaration wrapper is prepended so prefix-qualified names
// resolve correctly even when outer xmlns declarations are absent.
func extractProps(innerXML string, statusCode int) map[string]*MSProp {
	props := make(map[string]*MSProp)
	if strings.TrimSpace(innerXML) == "" {
		return props
	}

	// Wrap with common namespace declarations so the decoder resolves prefixes
	// that were declared on ancestor elements in the original response.
	const nsWrap = `<X xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">`
	wrapped := nsWrap + innerXML + `</X>`

	dec := xml.NewDecoder(strings.NewReader(wrapped))
	depth := 0
	var curKey string
	var curText strings.Builder
	var curChildren []string

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch v := tok.(type) {
		case xml.StartElement:
			depth++
			switch depth {
			case 1:
				// The <X> wrapper — skip.
			case 2:
				// First-level child = a property element.
				curKey = xmlPropKey(v.Name)
				curText.Reset()
				curChildren = nil
			case 3:
				// Grandchild = direct child of the property value.
				curChildren = append(curChildren, v.Name.Local)
			}
		case xml.EndElement:
			switch {
			case depth == 2 && curKey != "":
				props[curKey] = &MSProp{
					Status:   statusCode,
					text:     strings.TrimSpace(curText.String()),
					children: curChildren,
				}
				curKey = ""
				curText.Reset()
				curChildren = nil
			}
			depth--
		case xml.CharData:
			if depth == 2 {
				curText.Write(v)
			}
		}
	}
	return props
}

// xmlPropKey returns a "{namespace}local" key for a property name.
func xmlPropKey(name xml.Name) string {
	if name.Space == "" {
		return name.Local
	}
	return "{" + name.Space + "}" + name.Local
}

// parseHTTPStatus extracts the numeric code from "HTTP/1.1 200 OK".
func parseHTTPStatus(status string) int {
	parts := strings.Fields(status)
	if len(parts) < 2 {
		return 0
	}
	code := 0
	for _, c := range parts[1] {
		if c < '0' || c > '9' {
			break
		}
		code = code*10 + int(c-'0')
	}
	return code
}

// ─── Header maps ──────────────────────────────────────────────────────────────

func depthHeader(d string) map[string]string { return map[string]string{"Depth": d} }
func xmlContentType() map[string]string {
	return map[string]string{"Content-Type": "application/xml; charset=utf-8"}
}
func calContentType() map[string]string {
	return map[string]string{"Content-Type": "text/calendar; charset=utf-8"}
}
func withHeaders(maps ...map[string]string) map[string]string {
	out := make(map[string]string)
	for _, m := range maps {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// ─── iCalendar fixture builders ───────────────────────────────────────────────

const (
	testDTSTAMP = "20260101T000000Z"
	testDTSTART = "20260115T100000Z"
	testDTEND   = "20260115T110000Z"
	testDUE     = "20260120T120000Z"
)

// vtodo returns a minimal valid VTODO VCALENDAR string.
// Extra iCalendar property lines (e.g. "STATUS:COMPLETED\r\n") may be appended.
func vtodo(uid string, extra ...string) string {
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//CalStakk//ConformanceTest//EN\r\n")
	sb.WriteString("BEGIN:VTODO\r\n")
	fmt.Fprintf(&sb, "UID:%s\r\n", uid)
	fmt.Fprintf(&sb, "DTSTAMP:%s\r\n", testDTSTAMP)
	sb.WriteString("SUMMARY:Test Todo\r\n")
	for _, line := range extra {
		line = strings.TrimRight(line, "\r\n")
		sb.WriteString(line + "\r\n")
	}
	sb.WriteString("END:VTODO\r\n")
	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

// vevent returns a minimal valid VEVENT VCALENDAR string.
func vevent(uid string, extra ...string) string {
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//CalStakk//ConformanceTest//EN\r\n")
	sb.WriteString("BEGIN:VEVENT\r\n")
	fmt.Fprintf(&sb, "UID:%s\r\n", uid)
	fmt.Fprintf(&sb, "DTSTAMP:%s\r\n", testDTSTAMP)
	fmt.Fprintf(&sb, "DTSTART:%s\r\n", testDTSTART)
	fmt.Fprintf(&sb, "DTEND:%s\r\n", testDTEND)
	sb.WriteString("SUMMARY:Test Event\r\n")
	for _, line := range extra {
		line = strings.TrimRight(line, "\r\n")
		sb.WriteString(line + "\r\n")
	}
	sb.WriteString("END:VEVENT\r\n")
	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

// ─── PROPFIND / REPORT XML body builders ──────────────────────────────────────

func propfindAllprop() string {
	return xml.Header + `<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>`
}

func propfindPropname() string {
	return xml.Header + `<D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>`
}

// propfindProps builds a PROPFIND body requesting specific properties.
// Provide pairs of (namespace-URI, local-name); DAV: and CalDAV namespaces
// are automatically prefixed as D: and C: respectively.
func propfindProps(pairs ...string) string {
	var sb strings.Builder
	sb.WriteString(xml.Header)
	sb.WriteString(`<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop>`)
	for i := 0; i+1 < len(pairs); i += 2 {
		ns, local := pairs[i], pairs[i+1]
		switch ns {
		case nsDAV:
			fmt.Fprintf(&sb, `<D:%s/>`, local)
		case nsCalDAV:
			fmt.Fprintf(&sb, `<C:%s/>`, local)
		default:
			fmt.Fprintf(&sb, `<%s xmlns="%s"/>`, local, ns)
		}
	}
	sb.WriteString(`</D:prop></D:propfind>`)
	return sb.String()
}

// calendarQueryByComp builds a calendar-query REPORT body for a specific
// component type (e.g. "VTODO", "VEVENT").
func calendarQueryByComp(compName string) string {
	return xml.Header + fmt.Sprintf(
		`<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">`+
			`<D:prop><D:getetag/><C:calendar-data/></D:prop>`+
			`<C:filter><C:comp-filter name="VCALENDAR">`+
			`<C:comp-filter name="%s"/>`+
			`</C:comp-filter></C:filter>`+
			`</C:calendar-query>`,
		compName,
	)
}

// calendarQueryByTimeRange builds a calendar-query REPORT with a time-range filter.
func calendarQueryByTimeRange(compName, start, end string) string {
	return xml.Header + fmt.Sprintf(
		`<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">`+
			`<D:prop><D:getetag/><C:calendar-data/></D:prop>`+
			`<C:filter><C:comp-filter name="VCALENDAR">`+
			`<C:comp-filter name="%s">`+
			`<C:time-range start="%s" end="%s"/>`+
			`</C:comp-filter>`+
			`</C:comp-filter></C:filter>`+
			`</C:calendar-query>`,
		compName, start, end,
	)
}

// calendarMultiget builds a calendar-multiget REPORT body for the given hrefs.
func calendarMultiget(hrefs ...string) string {
	var sb strings.Builder
	sb.WriteString(xml.Header)
	sb.WriteString(`<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">`)
	sb.WriteString(`<D:prop><D:getetag/><C:calendar-data/></D:prop>`)
	for _, h := range hrefs {
		fmt.Fprintf(&sb, `<D:href>%s</D:href>`, h)
	}
	sb.WriteString(`</C:calendar-multiget>`)
	return sb.String()
}

// syncCollectionReport builds a sync-collection REPORT body.
// Pass an empty syncToken for the initial (full) sync.
func syncCollectionReport(syncToken string) string {
	return xml.Header + fmt.Sprintf(
		`<D:sync-collection xmlns:D="DAV:"><D:sync-token>%s</D:sync-token>`+
			`<D:sync-level>1</D:sync-level>`+
			`<D:prop><D:getetag/></D:prop></D:sync-collection>`,
		syncToken,
	)
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

// mkcol creates a calendar collection using MKCOL and asserts 201 Created.
// Returns the collection path.
func (s *srv) mkcol(t *testing.T, name string) string {
	t.Helper()
	path := collectionPath(name)
	resp := s.do(t, "MKCOL", path, nil, "")
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"MKCOL %s failed: %s", path, resp.Body)
	return path
}

// putObject PUTs a calendar object at the given path. Returns the ETag.
func (s *srv) putObject(t *testing.T, path, body string) string {
	t.Helper()
	resp := s.do(t, "PUT", path, calContentType(), body)
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"PUT %s failed (status %d): %s", path, resp.StatusCode, resp.Body)
	return resp.Header.Get("ETag")
}

// putTodo creates a VTODO at objectPath(collection, uid) and returns the ETag.
func (s *srv) putTodo(t *testing.T, collection, uid string, extra ...string) string {
	t.Helper()
	return s.putObject(t, objectPath(collection, uid), vtodo(uid, extra...))
}

// putEvent creates a VEVENT at objectPath(collection, uid) and returns the ETag.
func (s *srv) putEvent(t *testing.T, collection, uid string, extra ...string) string {
	t.Helper()
	return s.putObject(t, objectPath(collection, uid), vevent(uid, extra...))
}
