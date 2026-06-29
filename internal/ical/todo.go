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

	// DUE
	if dueProp := comp.Props.Get(ical.PropDue); dueProp != nil {
		valueParam := dueProp.Params.Get(ical.ParamValue)
		if valueParam == string(ical.ValueDate) {
			if dt, err := dueProp.DateTime(time.UTC); err == nil {
				t.Due = dt.Format("2006-01-02")
			}
		} else {
			if dt, err := dueProp.DateTime(time.Local); err == nil {
				t.Due = dt.Format(time.RFC3339)
			}
		}
	}

	// DTSTART
	if dtsProp := comp.Props.Get(ical.PropDateTimeStart); dtsProp != nil {
		if dt, err := dtsProp.DateTime(time.Local); err == nil {
			t.Start = dt.Format(time.RFC3339)
		}
	}

	// COMPLETED
	if cProp := comp.Props.Get(ical.PropCompleted); cProp != nil {
		if dt, err := cProp.DateTime(time.UTC); err == nil {
			t.Completed = dt.Format(time.RFC3339)
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

	return t, nil
}

// TodoFromDTO builds a VTODO component from a dto.Todo.
func TodoFromDTO(t *dto.Todo) (*ical.Component, error) {
	comp := ical.NewComponent(ical.CompToDo)
	now := time.Now().UTC()

	comp.Props.SetText(ical.PropUID, t.UID)
	comp.Props.SetText(ical.PropSummary, t.Summary)
	comp.Props.SetDateTime(ical.PropDateTimeStamp, now)

	if t.Description != "" {
		comp.Props.SetText(ical.PropDescription, t.Description)
	}
	if t.Status != "" {
		comp.Props.SetText(ical.PropStatus, t.Status)
	}
	if t.RelatedTo != "" {
		comp.Props.SetText(ical.PropRelatedTo, t.RelatedTo)
	}

	// DUE
	if t.Due != "" {
		due, err := parseDateTime(t.Due)
		if err != nil {
			return nil, fmt.Errorf("parsing due %q: %w", t.Due, err)
		}
		// Use DATE type if the string is date-only
		if !strings.Contains(t.Due, "T") {
			comp.Props.SetDate(ical.PropDue, due)
		} else {
			comp.Props.SetDateTime(ical.PropDue, due)
		}
	}

	// DTSTART
	if t.Start != "" {
		start, err := parseDateTime(t.Start)
		if err != nil {
			return nil, fmt.Errorf("parsing dtstart %q: %w", t.Start, err)
		}
		comp.Props.SetDateTime(ical.PropDateTimeStart, start)
	}

	// COMPLETED
	if t.Completed != "" {
		completed, err := parseDateTime(t.Completed)
		if err != nil {
			return nil, fmt.Errorf("parsing completed %q: %w", t.Completed, err)
		}
		comp.Props.SetDateTime(ical.PropCompleted, completed)
	}

	// PERCENT-COMPLETE
	if t.PercentComplete > 0 {
		comp.Props.Set(&ical.Prop{Name: ical.PropPercentComplete, Value: fmt.Sprintf("%d", t.PercentComplete)})
	}

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
