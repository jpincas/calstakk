package ical_test

import (
	"testing"
	"time"

	"github.com/emersion/go-ical"
	"github.com/jpincas/calstakk/internal/dto"
	calical "github.com/jpincas/calstakk/internal/ical"
	"github.com/stretchr/testify/require"
)

// roundtripEvent converts dto.Event → component → dto.Event and asserts key fields.
func roundtripEvent(t *testing.T, e *dto.Event) *dto.Event {
	t.Helper()
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)
	got, err := calical.EventToDTO(comp, e.Href)
	require.NoError(t, err)
	return got
}

func TestEvent_BasicRoundtrip(t *testing.T) {
	e := &dto.Event{
		UID:     "test-uid-1",
		Summary: "Stand-up",
		Start:   "2026-05-12T09:00:00Z",
		End:     "2026-05-12T09:15:00Z",
		Href:    "/calstakk/calendars/work/test-uid-1.ics",
	}
	got := roundtripEvent(t, e)
	require.Equal(t, e.UID, got.UID)
	require.Equal(t, e.Summary, got.Summary)
}

func TestEvent_AllDay(t *testing.T) {
	e := &dto.Event{
		UID:     "allday-uid",
		Summary: "Bank Holiday",
		Start:   "2026-05-25",
		End:     "2026-05-26",
		AllDay:  true,
		Href:    "/calstakk/calendars/work/allday-uid.ics",
	}
	got := roundtripEvent(t, e)
	require.True(t, got.AllDay)
	require.Equal(t, "2026-05-25", got.Start)
}

func TestEvent_AllDay_NoTrailingT(t *testing.T) {
	// All-day dtstart must not contain 'T' (must be DATE, not DATETIME)
	e := &dto.Event{
		UID:     "ad-uid",
		Summary: "All day",
		Start:   "2026-06-01",
		AllDay:  true,
		Href:    "/calstakk/calendars/work/ad-uid.ics",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)
	dtsProp := comp.Props.Get(ical.PropDateTimeStart)
	require.NotNil(t, dtsProp)
	// VALUE=DATE must be set
	valueParam := dtsProp.Params.Get(ical.ParamValue)
	require.Equal(t, string(ical.ValueDate), valueParam)
}

func TestEvent_OptionalFields(t *testing.T) {
	e := &dto.Event{
		UID:         "opt-uid",
		Summary:     "Meeting",
		Start:       "2026-05-12T10:00:00Z",
		Description: "Discuss roadmap",
		Location:    "Board Room",
		Status:      "CONFIRMED",
		Href:        "/calstakk/calendars/work/opt-uid.ics",
	}
	got := roundtripEvent(t, e)
	require.Equal(t, e.Description, got.Description)
	require.Equal(t, e.Location, got.Location)
	require.Equal(t, e.Status, got.Status)
}

func TestEvent_WithRRule(t *testing.T) {
	e := &dto.Event{
		UID:     "rec-uid",
		Summary: "Weekly Review",
		Start:   "2026-05-11T14:00:00Z",
		RRule:   "FREQ=WEEKLY",
		Href:    "/calstakk/calendars/work/rec-uid.ics",
	}
	got := roundtripEvent(t, e)
	require.Equal(t, "FREQ=WEEKLY", got.RRule)
}

func TestEvent_WrapInCalendar(t *testing.T) {
	e := &dto.Event{UID: "wrap-uid", Summary: "Test", Start: "2026-05-12T09:00:00Z"}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)
	cal := calical.WrapInCalendar(comp)

	require.Equal(t, ical.CompCalendar, cal.Name)
	require.Len(t, cal.Children, 1)
	require.Equal(t, ical.CompEvent, cal.Children[0].Name)
}

func TestEvent_FirstComponent(t *testing.T) {
	e := &dto.Event{UID: "fc-uid", Summary: "Test", Start: "2026-05-12T09:00:00Z"}
	comp, _ := calical.EventFromDTO(e)
	cal := calical.WrapInCalendar(comp)

	found := calical.FirstComponent(cal, ical.CompEvent)
	require.NotNil(t, found)
	require.Equal(t, ical.CompEvent, found.Name)

	notFound := calical.FirstComponent(cal, ical.CompToDo)
	require.Nil(t, notFound)
}

func TestEvent_Duration(t *testing.T) {
	e := &dto.Event{
		UID:      "dur-uid",
		Summary:  "One hour meeting",
		Start:    "2026-05-12T09:00:00Z",
		Duration: "PT1H",
		Href:     "/calstakk/calendars/work/dur-uid.ics",
	}
	got := roundtripEvent(t, e)
	require.Equal(t, "PT1H", got.Duration)
}

func TestEvent_DTSTAMP_IsSet(t *testing.T) {
	e := &dto.Event{UID: "stamp-uid", Summary: "Test", Start: "2026-05-12T09:00:00Z"}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)
	stamp := comp.Props.Get(ical.PropDateTimeStamp)
	require.NotNil(t, stamp)
	t0, err := stamp.DateTime(time.UTC)
	require.NoError(t, err)
	require.False(t, t0.IsZero())
}
