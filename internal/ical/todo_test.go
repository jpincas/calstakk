package ical_test

import (
	"testing"

	"github.com/jpincas/calstakk/internal/dto"
	calical "github.com/jpincas/calstakk/internal/ical"
	"github.com/stretchr/testify/require"
)

func roundtripTodo(t *testing.T, td *dto.Todo) *dto.Todo {
	t.Helper()
	comp, err := calical.TodoFromDTO(td)
	require.NoError(t, err)
	got, err := calical.TodoToDTO(comp, td.Href)
	require.NoError(t, err)
	return got
}

func TestTodo_BasicRoundtrip(t *testing.T) {
	td := &dto.Todo{
		UID:     "todo-uid-1",
		Summary: "File accounts",
		Status:  "NEEDS-ACTION",
		Href:    "/calstakk/calendars/work/todo-uid-1.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, td.UID, got.UID)
	require.Equal(t, td.Summary, got.Summary)
	require.Equal(t, td.Status, got.Status)
}

func TestTodo_DueDate(t *testing.T) {
	td := &dto.Todo{
		UID:     "due-uid",
		Summary: "Submit report",
		Due:     "2026-06-30",
		Href:    "/calstakk/calendars/work/due-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, "2026-06-30", got.Due)
}

func TestTodo_Priority(t *testing.T) {
	td := &dto.Todo{
		UID:      "pri-uid",
		Summary:  "Urgent task",
		Priority: 1,
		Href:     "/calstakk/calendars/work/pri-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, 1, got.Priority)
}

func TestTodo_PercentComplete(t *testing.T) {
	td := &dto.Todo{
		UID:             "pct-uid",
		Summary:         "In progress",
		PercentComplete: 50,
		Status:          "IN-PROCESS",
		Href:            "/calstakk/calendars/work/pct-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, 50, got.PercentComplete)
}

func TestTodo_RelatedTo(t *testing.T) {
	td := &dto.Todo{
		UID:       "child-uid",
		Summary:   "Sub-task",
		RelatedTo: "parent-uid-123",
		Href:      "/calstakk/calendars/work/child-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, "parent-uid-123", got.RelatedTo)
}

func TestTodo_Categories(t *testing.T) {
	td := &dto.Todo{
		UID:        "cat-uid",
		Summary:    "Tagged task",
		Categories: []string{"work", "urgent"},
		Href:       "/calstakk/calendars/work/cat-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.ElementsMatch(t, td.Categories, got.Categories)
}

func TestTodo_Completed(t *testing.T) {
	td := &dto.Todo{
		UID:             "done-uid",
		Summary:         "Done task",
		Status:          "COMPLETED",
		PercentComplete: 100,
		Completed:       "2026-05-11T12:00:00Z",
		Href:            "/calstakk/calendars/work/done-uid.ics",
	}
	got := roundtripTodo(t, td)
	require.Equal(t, "COMPLETED", got.Status)
	require.Equal(t, 100, got.PercentComplete)
	require.NotEmpty(t, got.Completed)
}
