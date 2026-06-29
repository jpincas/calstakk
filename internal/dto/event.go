package dto

// Occurrence is a single occurrence of an event, used when expanding recurring events.
// OccurrenceDate is synthesized and not stored in the iCalendar data.
type Occurrence struct {
	Event
	OccurrenceDate string `json:"occurrence_date"`
}

// Event is the JSON wire shape for a VEVENT calendar object.
type Event struct {
	UID          string   `json:"uid"`
	Summary      string   `json:"summary"`
	Description  string   `json:"description,omitempty"`
	Start        string   `json:"dtstart"`
	End          string   `json:"dtend,omitempty"`
	Duration     string   `json:"duration,omitempty"`
	AllDay       bool     `json:"all_day"`
	Location     string   `json:"location,omitempty"`
	Status       string   `json:"status,omitempty"`
	RRule        string   `json:"rrule,omitempty"`
	ExDates      []string `json:"exdates,omitempty"`
	RDates       []string `json:"rdates,omitempty"`
	RecurrenceID string   `json:"recurrence_id,omitempty"`
	Timezone     string   `json:"timezone,omitempty"`
	Created      string   `json:"created,omitempty"`
	Href         string   `json:"href"`
}
