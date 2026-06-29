package ical_test

import (
	"testing"
	"time"

	"github.com/jpincas/calstakk/internal/dto"
	calical "github.com/jpincas/calstakk/internal/ical"
	"github.com/stretchr/testify/require"
)

func TestExpandOccurrences_NonRecurring(t *testing.T) {
	e := &dto.Event{
		UID:     "single-uid",
		Summary: "One-off",
		Start:   "2026-05-15T09:00:00Z",
		End:     "2026-05-15T10:00:00Z",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 31, 23, 59, 59, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/single-uid.ics", from, to, nil)
	require.NoError(t, err)
	require.Len(t, occs, 1)
	require.Equal(t, "One-off", occs[0].Summary)
}

func TestExpandOccurrences_NonRecurring_OutsideRange(t *testing.T) {
	e := &dto.Event{
		UID:     "outside-uid",
		Summary: "Outside range",
		Start:   "2026-06-15T09:00:00Z",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/outside-uid.ics", from, to, nil)
	require.NoError(t, err)
	require.Empty(t, occs)
}

func TestExpandOccurrences_WeeklyRecurring(t *testing.T) {
	e := &dto.Event{
		UID:     "weekly-uid",
		Summary: "Weekly Review",
		Start:   "2026-05-11T14:00:00Z",
		RRule:   "FREQ=WEEKLY",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 11, 0, 0, 0, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/weekly-uid.ics", from, to, nil)
	require.NoError(t, err)
	require.Equal(t, 5, len(occs), "expected 5 weekly occurrences in ~1 month")
}

func TestExpandOccurrences_RecurrenceWithCount(t *testing.T) {
	e := &dto.Event{
		UID:     "count-uid",
		Summary: "3-week series",
		Start:   "2026-05-11T10:00:00Z",
		RRule:   "FREQ=WEEKLY;COUNT=3",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/count-uid.ics", from, to, nil)
	require.NoError(t, err)
	require.Len(t, occs, 3)
}

func TestExpandOccurrences_OccurrenceDates(t *testing.T) {
	e := &dto.Event{
		UID:     "dates-uid",
		Summary: "Weekly",
		Start:   "2026-05-11T14:00:00Z",
		RRule:   "FREQ=WEEKLY;COUNT=3",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/dates-uid.ics", from, to, nil)
	require.NoError(t, err)

	// Verify occurrence_date is set and different for each occurrence
	require.NotEmpty(t, occs[0].OccurrenceDate)
	require.NotEmpty(t, occs[1].OccurrenceDate)
	require.NotEqual(t, occs[0].OccurrenceDate, occs[1].OccurrenceDate)
}

func TestExpandOccurrences_MonthlySeries(t *testing.T) {
	e := &dto.Event{
		UID:     "monthly-uid",
		Summary: "Monthly call",
		Start:   "2026-01-15T10:00:00Z",
		RRule:   "FREQ=MONTHLY;COUNT=6",
	}
	comp, err := calical.EventFromDTO(e)
	require.NoError(t, err)

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)

	occs, err := calical.ExpandOccurrences(comp, "/test/monthly-uid.ics", from, to, nil)
	require.NoError(t, err)
	require.Len(t, occs, 6)
}
