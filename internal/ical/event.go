// Package ical maps between iCalendar Component types and CalStakk DTOs.
package ical

import (
	"fmt"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/jpincas/calstakk/internal/dto"
	"github.com/teambition/rrule-go"
)

// EventToDTO converts a VEVENT component to a dto.Event.
func EventToDTO(comp *ical.Component, href string) (*dto.Event, error) {
	if comp.Name != ical.CompEvent {
		return nil, fmt.Errorf("expected VEVENT, got %s", comp.Name)
	}

	e := &dto.Event{Href: href}

	// Required fields
	uid, err := comp.Props.Text(ical.PropUID)
	if err != nil {
		return nil, fmt.Errorf("reading UID: %w", err)
	}
	e.UID = uid

	summary, _ := comp.Props.Text(ical.PropSummary)
	e.Summary = summary

	// DTSTART — detect DATE vs DATETIME; DateTime(nil) reads TZID param automatically.
	if dtsProp := comp.Props.Get(ical.PropDateTimeStart); dtsProp != nil {
		if dtsProp.Params.Get(ical.ParamValue) == string(ical.ValueDate) {
			e.AllDay = true
			if t, err := dtsProp.DateTime(nil); err == nil {
				e.Start = t.Format("2006-01-02")
			}
		} else {
			if t, err := dtsProp.DateTime(nil); err == nil {
				e.Start = t.Format(time.RFC3339)
				if loc := t.Location(); loc != nil && loc.String() != "UTC" {
					e.Timezone = loc.String()
				}
			}
		}
	}

	// DTEND
	if dteProp := comp.Props.Get(ical.PropDateTimeEnd); dteProp != nil {
		if dteProp.Params.Get(ical.ParamValue) == string(ical.ValueDate) {
			if t, err := dteProp.DateTime(nil); err == nil {
				e.End = t.Format("2006-01-02")
			}
		} else {
			if t, err := dteProp.DateTime(nil); err == nil {
				e.End = t.Format(time.RFC3339)
			}
		}
	}

	// DURATION
	if durProp := comp.Props.Get(ical.PropDuration); durProp != nil {
		e.Duration = durProp.Value
	}

	// Optional text fields
	e.Description, _ = comp.Props.Text(ical.PropDescription)
	e.Location, _ = comp.Props.Text(ical.PropLocation)
	e.Status, _ = comp.Props.Text(ical.PropStatus)

	// CREATED
	if createdProp := comp.Props.Get(ical.PropCreated); createdProp != nil {
		if t, err := createdProp.DateTime(nil); err == nil {
			e.Created = t.UTC().Format(time.RFC3339)
		}
	}

	// RRULE
	if rruleProp := comp.Props.Get(ical.PropRecurrenceRule); rruleProp != nil {
		e.RRule = rruleProp.Value
	}

	// EXDATE — may have multiple props with the same name
	for _, exProp := range comp.Props.Values(ical.PropExceptionDates) {
		e.ExDates = append(e.ExDates, exProp.Value)
	}

	// RDATE
	for _, rdProp := range comp.Props.Values(ical.PropRecurrenceDates) {
		e.RDates = append(e.RDates, rdProp.Value)
	}

	// RECURRENCE-ID
	if recIDProp := comp.Props.Get(ical.PropRecurrenceID); recIDProp != nil {
		e.RecurrenceID = recIDProp.Value
	}

	return e, nil
}

// EventFromDTO builds a VEVENT component from a dto.Event.
// If e.UID is empty a new UUID is NOT generated here — callers must set it.
func EventFromDTO(e *dto.Event) (*ical.Component, error) {
	comp := ical.NewComponent(ical.CompEvent)
	now := time.Now().UTC()

	comp.Props.SetText(ical.PropUID, e.UID)
	comp.Props.SetText(ical.PropSummary, e.Summary)
	comp.Props.SetDateTime(ical.PropDateTimeStamp, now)

	// CREATED: preserve on update, set to now on first creation.
	var created time.Time
	if e.Created != "" {
		if t, err := parseDateTime(e.Created); err == nil {
			created = t.UTC()
		}
	}
	if created.IsZero() {
		created = now
	}
	comp.Props.SetDateTime(ical.PropCreated, created)

	// Resolve named timezone for datetime properties once.
	var tzLoc *time.Location
	if e.Timezone != "" {
		if loc, err := time.LoadLocation(e.Timezone); err == nil {
			tzLoc = loc
		}
	}

	// DTSTART
	if e.Start != "" {
		if e.AllDay {
			t, err := time.Parse("2006-01-02", e.Start)
			if err != nil {
				return nil, fmt.Errorf("parsing dtstart date %q: %w", e.Start, err)
			}
			comp.Props.SetDate(ical.PropDateTimeStart, t)
		} else {
			t, err := parseDateTime(e.Start)
			if err != nil {
				return nil, fmt.Errorf("parsing dtstart %q: %w", e.Start, err)
			}
			// In(loc) keeps the instant, changes the displayed timezone; SetDateTime
			// then writes TZID=name + no Z suffix — correct per RFC 5545 §3.3.5.
			if tzLoc != nil {
				t = t.In(tzLoc)
			}
			comp.Props.SetDateTime(ical.PropDateTimeStart, t)
		}
	}

	// DTEND — apply the same timezone as DTSTART.
	if e.End != "" {
		if e.AllDay {
			t, err := time.Parse("2006-01-02", e.End)
			if err != nil {
				return nil, fmt.Errorf("parsing dtend date %q: %w", e.End, err)
			}
			comp.Props.SetDate(ical.PropDateTimeEnd, t)
		} else {
			t, err := parseDateTime(e.End)
			if err != nil {
				return nil, fmt.Errorf("parsing dtend %q: %w", e.End, err)
			}
			if tzLoc != nil {
				t = t.In(tzLoc)
			}
			comp.Props.SetDateTime(ical.PropDateTimeEnd, t)
		}
	}

	// DURATION
	if e.Duration != "" {
		comp.Props.Set(&ical.Prop{Name: ical.PropDuration, Value: e.Duration})
	}

	// Optional text fields
	if e.Description != "" {
		comp.Props.SetText(ical.PropDescription, e.Description)
	}
	if e.Location != "" {
		comp.Props.SetText(ical.PropLocation, e.Location)
	}
	if e.Status != "" {
		comp.Props.SetText(ical.PropStatus, e.Status)
	}

	// RRULE
	if e.RRule != "" {
		opt, err := rrule.StrToROption("RRULE:" + e.RRule)
		if err != nil {
			return nil, fmt.Errorf("parsing rrule %q: %w", e.RRule, err)
		}
		comp.Props.SetRecurrenceRule(opt)
	}

	// EXDATE
	for _, ex := range e.ExDates {
		prop := &ical.Prop{Name: ical.PropExceptionDates, Value: ex}
		comp.Props.Add(prop)
	}

	// RDATE
	for _, rd := range e.RDates {
		prop := &ical.Prop{Name: ical.PropRecurrenceDates, Value: rd}
		comp.Props.Add(prop)
	}

	// RECURRENCE-ID
	if e.RecurrenceID != "" {
		prop := &ical.Prop{Name: ical.PropRecurrenceID, Value: e.RecurrenceID}
		comp.Props.Set(prop)
	}

	return comp, nil
}

// WrapInCalendar wraps a single component in a VCALENDAR.
func WrapInCalendar(comp *ical.Component) *ical.Calendar {
	cal := ical.NewCalendar()
	cal.Props.SetText(ical.PropVersion, "2.0")
	cal.Props.SetText(ical.PropProductID, "-//CalStakk//CalStakk//EN")
	cal.Children = append(cal.Children, comp)
	return cal
}

// FirstComponent returns the first non-VTIMEZONE child of a Calendar with the given name.
func FirstComponent(cal *ical.Calendar, compName string) *ical.Component {
	for _, child := range cal.Children {
		if child.Name == compName {
			return child
		}
	}
	return nil
}

// AllComponents returns all non-VTIMEZONE children with the given name.
func AllComponents(cal *ical.Calendar, compName string) []*ical.Component {
	var result []*ical.Component
	for _, child := range cal.Children {
		if child.Name == compName {
			result = append(result, child)
		}
	}
	return result
}

// parseDateTime parses an RFC 3339 or iCalendar datetime string.
func parseDateTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t, nil
	}
	if t, err := time.Parse("20060102T150405Z", s); err == nil {
		return t, nil
	}
	if t, err := time.Parse("20060102T150405", s); err == nil {
		return t, nil
	}
	// Attempt date-only
	if !strings.Contains(s, "T") {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse datetime %q", s)
}
