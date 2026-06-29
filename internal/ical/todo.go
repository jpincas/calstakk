package ical

import (
	"fmt"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/jpincas/calstakk/internal/dto"
)

// TodoToDTO converts a VTODO component to a dto.Todo.
func TodoToDTO(comp *ical.Component, href string) (*dto.Todo, error) {
	if comp.Name != ical.CompToDo {
		return nil, fmt.Errorf("expected VTODO, got %s", comp.Name)
	}

	t := &dto.Todo{Href: href}

	uid, err := comp.Props.Text(ical.PropUID)
	if err != nil {
		return nil, fmt.Errorf("reading UID: %w", err)
	}
	t.UID = uid

	t.Summary, _ = comp.Props.Text(ical.PropSummary)
	t.Description, _ = comp.Props.Text(ical.PropDescription)
	t.Status, _ = comp.Props.Text(ical.PropStatus)
	t.RelatedTo, _ = comp.Props.Text(ical.PropRelatedTo)

	// DUE — DateTime(nil) reads TZID param automatically.
	if dueProp := comp.Props.Get(ical.PropDue); dueProp != nil {
		if dueProp.Params.Get(ical.ParamValue) == string(ical.ValueDate) {
			if dt, err := dueProp.DateTime(nil); err == nil {
				t.Due = dt.Format("2006-01-02")
			}
		} else {
			if dt, err := dueProp.DateTime(nil); err == nil {
				t.Due = dt.Format(time.RFC3339)
				if loc := dt.Location(); loc != nil && loc.String() != "UTC" {
					t.Timezone = loc.String()
				}
			}
		}
	}

	// DTSTART
	if dtsProp := comp.Props.Get(ical.PropDateTimeStart); dtsProp != nil {
		if dt, err := dtsProp.DateTime(nil); err == nil {
			t.Start = dt.Format(time.RFC3339)
			if t.Timezone == "" {
				if loc := dt.Location(); loc != nil && loc.String() != "UTC" {
					t.Timezone = loc.String()
				}
			}
		}
	}

	// COMPLETED
	if cProp := comp.Props.Get(ical.PropCompleted); cProp != nil {
		if dt, err := cProp.DateTime(nil); err == nil {
			t.Completed = dt.UTC().Format(time.RFC3339)
		}
	}

	// PERCENT-COMPLETE
	if pcProp := comp.Props.Get(ical.PropPercentComplete); pcProp != nil {
		var pct int
		if _, err := fmt.Sscanf(pcProp.Value, "%d", &pct); err == nil {
			t.PercentComplete = pct
		}
	}

	// PRIORITY
	if priProp := comp.Props.Get(ical.PropPriority); priProp != nil {
		var pri int
		if _, err := fmt.Sscanf(priProp.Value, "%d", &pri); err == nil {
			t.Priority = pri
		}
	}

	// CATEGORIES — one prop per category (see TodoFromDTO)
	for _, catProp := range comp.Props.Values(ical.PropCategories) {
		cat := strings.TrimSpace(catProp.Value)
		if cat != "" {
			t.Categories = append(t.Categories, cat)
		}
	}

	// CREATED
	if createdProp := comp.Props.Get(ical.PropCreated); createdProp != nil {
		if dt, err := createdProp.DateTime(nil); err == nil {
			t.Created = dt.UTC().Format(time.RFC3339)
		}
	}

	return t, nil
}

// TodoFromDTO builds a VTODO component from a dto.Todo.
func TodoFromDTO(t *dto.Todo) (*ical.Component, error) {
	comp := ical.NewComponent(ical.CompToDo)
	now := time.Now().UTC()

	comp.Props.SetText(ical.PropUID, t.UID)
	comp.Props.SetText(ical.PropSummary, t.Summary)
	comp.Props.SetDateTime(ical.PropDateTimeStamp, now)

	// CREATED: preserve on update, set to now on first creation.
	var created time.Time
	if t.Created != "" {
		if ct, err := parseDateTime(t.Created); err == nil {
			created = ct.UTC()
		}
	}
	if created.IsZero() {
		created = now
	}
	comp.Props.SetDateTime(ical.PropCreated, created)

	if t.Description != "" {
		comp.Props.SetText(ical.PropDescription, t.Description)
	}
	if t.Status != "" {
		comp.Props.SetText(ical.PropStatus, t.Status)
	}
	if t.RelatedTo != "" {
		comp.Props.SetText(ical.PropRelatedTo, t.RelatedTo)
	}

	// Resolve named timezone once for all datetime properties.
	var tzLoc *time.Location
	if t.Timezone != "" {
		if loc, err := time.LoadLocation(t.Timezone); err == nil {
			tzLoc = loc
		}
	}

	// DUE
	if t.Due != "" {
		due, err := parseDateTime(t.Due)
		if err != nil {
			return nil, fmt.Errorf("parsing due %q: %w", t.Due, err)
		}
		if !strings.Contains(t.Due, "T") {
			comp.Props.SetDate(ical.PropDue, due)
		} else {
			if tzLoc != nil {
				due = due.In(tzLoc)
			}
			comp.Props.SetDateTime(ical.PropDue, due)
		}
	}

	// DTSTART
	if t.Start != "" {
		start, err := parseDateTime(t.Start)
		if err != nil {
			return nil, fmt.Errorf("parsing dtstart %q: %w", t.Start, err)
		}
		if tzLoc != nil {
			start = start.In(tzLoc)
		}
		comp.Props.SetDateTime(ical.PropDateTimeStart, start)
	}

	// COMPLETED — always UTC per RFC 5545 §3.8.2.1.
	if t.Completed != "" {
		completed, err := parseDateTime(t.Completed)
		if err != nil {
			return nil, fmt.Errorf("parsing completed %q: %w", t.Completed, err)
		}
		comp.Props.SetDateTime(ical.PropCompleted, completed.UTC())
	}

	// PERCENT-COMPLETE — always written; 0 is a valid value meaning "not started".
	comp.Props.Set(&ical.Prop{Name: ical.PropPercentComplete, Value: fmt.Sprintf("%d", t.PercentComplete)})

	// PRIORITY
	if t.Priority > 0 {
		comp.Props.Set(&ical.Prop{Name: ical.PropPriority, Value: fmt.Sprintf("%d", t.Priority)})
	}

	// CATEGORIES — one prop per category to avoid TEXT escaping of commas
	for _, cat := range t.Categories {
		comp.Props.Add(&ical.Prop{Name: ical.PropCategories, Value: cat})
	}

	return comp, nil
}
