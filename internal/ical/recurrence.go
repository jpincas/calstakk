package ical

import (
	"fmt"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/jpincas/calstakk/internal/dto"
)

// ExpandOccurrences returns one dto.Event per occurrence of comp within [from, to).
// If comp has no RRULE (not recurring), it returns the event itself if it falls within
// the range. occurrenceDate is set to the occurrence's dtstart in RFC 3339.
// The exceptions map should contain RECURRENCE-ID overrides keyed by their RECURRENCE-ID
// value (in the same format as dtstart).
func ExpandOccurrences(comp *ical.Component, href string, from, to time.Time, exceptions map[string]*ical.Component) ([]dto.Occurrence, error) {
	if comp.Name != ical.CompEvent {
		return nil, fmt.Errorf("expected VEVENT, got %s", comp.Name)
	}

	rset, err := comp.RecurrenceSet(from.Location())
	if err != nil {
		return nil, fmt.Errorf("building recurrence set: %w", err)
	}

	baseEvent, err := EventToDTO(comp, href)
	if err != nil {
		return nil, fmt.Errorf("converting master event: %w", err)
	}

	var occurrences []dto.Occurrence

	if rset == nil {
		// Non-recurring: check if the single occurrence falls in range
		t, err := comp.Props.DateTime(ical.PropDateTimeStart, from.Location())
		if err != nil {
			return nil, fmt.Errorf("reading dtstart: %w", err)
		}
		if (from.IsZero() || !t.Before(from)) && (to.IsZero() || t.Before(to)) {
			occ := dto.Occurrence{
				Event:          *baseEvent,
				OccurrenceDate: t.Format(time.RFC3339),
			}
			occurrences = append(occurrences, occ)
		}
		return occurrences, nil
	}

	// Recurring: expand within the window
	times := rset.Between(from, to, true)
	for _, t := range times {
		occ := dto.Occurrence{
			Event:          *baseEvent,
			OccurrenceDate: t.Format(time.RFC3339),
		}

		// Apply RECURRENCE-ID override if one exists for this occurrence
		key := t.Format(time.RFC3339)
		if override, ok := exceptions[key]; ok {
			overrideDTO, err := EventToDTO(override, href)
			if err == nil {
				occ.Event = *overrideDTO
				occ.OccurrenceDate = t.Format(time.RFC3339)
			}
		}

		occ.Href = href
		occurrences = append(occurrences, occ)
	}

	return occurrences, nil
}

// ExtractExceptions extracts RECURRENCE-ID override components from a VCALENDAR,
// keyed by the RECURRENCE-ID value.
func ExtractExceptions(cal *ical.Calendar) map[string]*ical.Component {
	exceptions := make(map[string]*ical.Component)
	for _, child := range cal.Children {
		if child.Name != ical.CompEvent {
			continue
		}
		recIDProp := child.Props.Get(ical.PropRecurrenceID)
		if recIDProp == nil {
			continue
		}
		// Try parsing the recurrence-id as a time and normalise to RFC 3339
		if t, err := recIDProp.DateTime(time.Local); err == nil {
			key := t.Format(time.RFC3339)
			exceptions[key] = child
		} else {
			// Fall back to using the raw value
			key := strings.TrimSpace(recIDProp.Value)
			exceptions[key] = child
		}
	}
	return exceptions
}
