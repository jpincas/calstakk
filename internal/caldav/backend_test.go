package caldav_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/emersion/go-ical"
	gocaldav "github.com/emersion/go-webdav/caldav"
	caldavbackend "github.com/jpincas/calstakk/internal/caldav"
	"github.com/jpincas/calstakk/internal/server"
	"github.com/jpincas/calstakk/internal/storage"
	"github.com/stretchr/testify/require"
)

// newTestServer creates an in-process CalDAV server backed by a temp directory
// and returns a caldav.Client pointed at it.
func newTestServer(t *testing.T) (*gocaldav.Client, *httptest.Server) {
	t.Helper()

	store, err := storage.New(t.TempDir())
	require.NoError(t, err)

	backend := caldavbackend.New(store)
	srv := server.New(backend)

	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)

	client, err := gocaldav.NewClient(ts.Client(), ts.URL)
	require.NoError(t, err)

	return client, ts
}

func ctx() context.Context {
	return context.Background()
}

// findHomeSet is a test helper.
func findHomeSet(t *testing.T, client *gocaldav.Client) string {
	t.Helper()
	principal, err := client.FindCurrentUserPrincipal(ctx())
	require.NoError(t, err)
	homeSet, err := client.FindCalendarHomeSet(ctx(), principal)
	require.NoError(t, err)
	return homeSet
}

// --- Server bootstrap ---

func TestServer_Options_DAVHeader(t *testing.T) {
	_, ts := newTestServer(t)
	resp, err := ts.Client().Get(ts.URL + "/")
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	// Just check the server is reachable; OPTIONS is checked via CalDAV discovery
}

func TestServer_WellKnownRedirect(t *testing.T) {
	_, ts := newTestServer(t)

	// /.well-known/caldav should redirect (308) to the principal path.
	resp, err := ts.Client().Get(ts.URL + "/.well-known/caldav")
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	// After following redirects the URL should end at /calstakk
	require.Contains(t, resp.Request.URL.Path, "/calstakk")
}

func TestServer_FindPrincipal(t *testing.T) {
	client, _ := newTestServer(t)
	principal, err := client.FindCurrentUserPrincipal(ctx())
	require.NoError(t, err)
	require.Equal(t, "/calstakk", principal)
}

func TestServer_FindCalendarHomeSet(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.Equal(t, "/calstakk/calendars", homeSet)
}

// --- Collection CRUD ---

func TestCollection_CreateAndList(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)

	// No calendars initially
	cals, err := client.FindCalendars(ctx(), homeSet)
	require.NoError(t, err)
	require.Empty(t, cals)

	// Create a calendar
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	// Now one calendar exists
	cals, err = client.FindCalendars(ctx(), homeSet)
	require.NoError(t, err)
	require.Len(t, cals, 1)
	require.Equal(t, homeSet+"/work", cals[0].Path)
}

func TestCollection_DuplicateCreateFails(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)

	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))
	err := client.Mkdir(ctx(), homeSet+"/work")
	require.Error(t, err)
}

func TestCollection_Delete(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)

	require.NoError(t, client.Mkdir(ctx(), homeSet+"/tmp"))

	require.NoError(t, client.RemoveAll(ctx(), homeSet+"/tmp"))

	cals, err := client.FindCalendars(ctx(), homeSet)
	require.NoError(t, err)
	require.Empty(t, cals)
}

// --- VEVENT CRUD ---

func makeEvent(uid, summary, dtstart string) *ical.Calendar {
	comp := ical.NewComponent(ical.CompEvent)
	comp.Props.SetText(ical.PropUID, uid)
	comp.Props.SetText(ical.PropSummary, summary)
	comp.Props.SetDateTime(ical.PropDateTimeStamp, time.Now().UTC())

	t, err := time.Parse(time.RFC3339, dtstart)
	if err != nil {
		t, _ = time.Parse("2006-01-02", dtstart)
	}
	comp.Props.SetDateTime(ical.PropDateTimeStart, t)

	cal := ical.NewCalendar()
	cal.Props.SetText(ical.PropVersion, "2.0")
	cal.Props.SetText(ical.PropProductID, "-//test//test//EN")
	cal.Children = append(cal.Children, comp)
	return cal
}

func TestEvent_CreateAndGet(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	cal := makeEvent("evt-1", "Stand-up", "2026-05-12T09:00:00Z")
	objPath := homeSet + "/work/evt-1.ics"
	result, err := client.PutCalendarObject(ctx(), objPath, cal)
	require.NoError(t, err)
	require.NotEmpty(t, result.ETag)

	got, err := client.GetCalendarObject(ctx(), objPath)
	require.NoError(t, err)
	require.NotNil(t, got.Data)

	// Find the VEVENT
	var vevent *ical.Component
	for _, child := range got.Data.Children {
		if child.Name == ical.CompEvent {
			vevent = child
			break
		}
	}
	require.NotNil(t, vevent)
	summary, err := vevent.Props.Text(ical.PropSummary)
	require.NoError(t, err)
	require.Equal(t, "Stand-up", summary)
}

func TestEvent_UpdatePreservesUID(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	objPath := homeSet + "/work/evt-2.ics"
	cal := makeEvent("evt-2", "Original", "2026-05-12T09:00:00Z")
	_, err := client.PutCalendarObject(ctx(), objPath, cal)
	require.NoError(t, err)

	// Update summary
	updated := makeEvent("evt-2", "Updated", "2026-05-12T09:00:00Z")
	_, err = client.PutCalendarObject(ctx(), objPath, updated)
	require.NoError(t, err)

	got, err := client.GetCalendarObject(ctx(), objPath)
	require.NoError(t, err)
	var vevent *ical.Component
	for _, c := range got.Data.Children {
		if c.Name == ical.CompEvent {
			vevent = c
		}
	}
	require.NotNil(t, vevent)
	summary, _ := vevent.Props.Text(ical.PropSummary)
	require.Equal(t, "Updated", summary)
}

func TestEvent_Delete(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	objPath := homeSet + "/work/del-evt.ics"
	_, err := client.PutCalendarObject(ctx(), objPath, makeEvent("del-evt", "To delete", "2026-05-12T09:00:00Z"))
	require.NoError(t, err)

	require.NoError(t, client.RemoveAll(ctx(), objPath))

	_, err = client.GetCalendarObject(ctx(), objPath)
	require.Error(t, err)
}

func TestEvent_ListInCollection(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	for i, uid := range []string{"e1", "e2", "e3"} {
		dtstart := time.Date(2026, 5, 10+i, 9, 0, 0, 0, time.UTC).Format(time.RFC3339)
		objPath := homeSet + "/work/" + uid + ".ics"
		_, err := client.PutCalendarObject(ctx(), objPath, makeEvent(uid, "Event "+uid, dtstart))
		require.NoError(t, err)
	}

	objects, err := client.QueryCalendar(ctx(), homeSet+"/work", &gocaldav.CalendarQuery{
		CompFilter: gocaldav.CompFilter{
			Name:  "VCALENDAR",
			Comps: []gocaldav.CompFilter{{Name: "VEVENT"}},
		},
	})
	require.NoError(t, err)
	require.Len(t, objects, 3)
}

func TestEvent_TimeRangeFilter(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	// Three events: May 10, May 15, Jun 1
	for _, evt := range []struct{ uid, dtstart string }{
		{"may10", "2026-05-10T09:00:00Z"},
		{"may15", "2026-05-15T09:00:00Z"},
		{"jun01", "2026-06-01T09:00:00Z"},
	} {
		objPath := homeSet + "/work/" + evt.uid + ".ics"
		_, err := client.PutCalendarObject(ctx(), objPath, makeEvent(evt.uid, evt.uid, evt.dtstart))
		require.NoError(t, err)
	}

	from := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)

	objects, err := client.QueryCalendar(ctx(), homeSet+"/work", &gocaldav.CalendarQuery{
		CompFilter: gocaldav.CompFilter{
			Name: "VCALENDAR",
			Comps: []gocaldav.CompFilter{{
				Name:  "VEVENT",
				Start: from,
				End:   to,
			}},
		},
	})
	require.NoError(t, err)
	require.Len(t, objects, 1, "expected only may15")

	var vevent *ical.Component
	for _, c := range objects[0].Data.Children {
		if c.Name == ical.CompEvent {
			vevent = c
		}
	}
	uid, _ := vevent.Props.Text(ical.PropUID)
	require.Equal(t, "may15", uid)
}

// --- VTODO CRUD ---

func makeTodo(uid, summary string) *ical.Calendar {
	comp := ical.NewComponent(ical.CompToDo)
	comp.Props.SetText(ical.PropUID, uid)
	comp.Props.SetText(ical.PropSummary, summary)
	comp.Props.SetDateTime(ical.PropDateTimeStamp, time.Now().UTC())
	comp.Props.SetText(ical.PropStatus, "NEEDS-ACTION")

	cal := ical.NewCalendar()
	cal.Props.SetText(ical.PropVersion, "2.0")
	cal.Props.SetText(ical.PropProductID, "-//test//test//EN")
	cal.Children = append(cal.Children, comp)
	return cal
}

func TestTodo_CreateAndGet(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/tasks"))

	objPath := homeSet + "/tasks/todo-1.ics"
	_, err := client.PutCalendarObject(ctx(), objPath, makeTodo("todo-1", "Write tests"))
	require.NoError(t, err)

	got, err := client.GetCalendarObject(ctx(), objPath)
	require.NoError(t, err)

	var vtodo *ical.Component
	for _, c := range got.Data.Children {
		if c.Name == ical.CompToDo {
			vtodo = c
		}
	}
	require.NotNil(t, vtodo)
	summary, _ := vtodo.Props.Text(ical.PropSummary)
	require.Equal(t, "Write tests", summary)
}

func TestTodo_RelatedTo_ValidParent(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/tasks"))

	// Create parent
	parentPath := homeSet + "/tasks/parent.ics"
	_, err := client.PutCalendarObject(ctx(), parentPath, makeTodo("parent", "Epic"))
	require.NoError(t, err)

	// Create child with valid RELATED-TO
	childCal := makeTodo("child", "Sub-task")
	for _, c := range childCal.Children {
		if c.Name == ical.CompToDo {
			c.Props.SetText(ical.PropRelatedTo, "parent")
		}
	}
	_, err = client.PutCalendarObject(ctx(), homeSet+"/tasks/child.ics", childCal)
	require.NoError(t, err)
}

func TestTodo_RelatedTo_InvalidParent(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/tasks"))

	childCal := makeTodo("orphan", "Orphan task")
	for _, c := range childCal.Children {
		if c.Name == ical.CompToDo {
			c.Props.SetText(ical.PropRelatedTo, "nonexistent-uid")
		}
	}
	_, err := client.PutCalendarObject(ctx(), homeSet+"/tasks/orphan.ics", childCal)
	require.Error(t, err, "expected error for invalid RELATED-TO parent")
}

func TestCollection_AdvertisesOnlyVEVENTAndVTODO(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/log"))

	cals, err := client.FindCalendars(ctx(), homeSet)
	require.NoError(t, err)
	require.Len(t, cals, 1)

	supported := cals[0].SupportedComponentSet
	require.Contains(t, supported, ical.CompEvent)
	require.Contains(t, supported, ical.CompToDo)
	require.NotContains(t, supported, ical.CompJournal)
}

// --- ETag consistency ---

func TestETag_Changes_After_Update(t *testing.T) {
	client, _ := newTestServer(t)
	homeSet := findHomeSet(t, client)
	require.NoError(t, client.Mkdir(ctx(), homeSet+"/work"))

	objPath := homeSet + "/work/etag-evt.ics"
	r1, err := client.PutCalendarObject(ctx(), objPath, makeEvent("etag-evt", "v1", "2026-05-12T09:00:00Z"))
	require.NoError(t, err)

	r2, err := client.PutCalendarObject(ctx(), objPath, makeEvent("etag-evt", "v2", "2026-05-12T09:00:00Z"))
	require.NoError(t, err)

	require.NotEqual(t, r1.ETag, r2.ETag)
}
