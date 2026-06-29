package dto

// Todo is the JSON wire shape for a VTODO calendar object.
type Todo struct {
	UID             string   `json:"uid"`
	Summary         string   `json:"summary"`
	Description     string   `json:"description,omitempty"`
	Due             string   `json:"due,omitempty"`
	Start           string   `json:"dtstart,omitempty"`
	Status          string   `json:"status,omitempty"`
	PercentComplete int      `json:"percent_complete"`
	Completed       string   `json:"completed,omitempty"`
	Priority        int      `json:"priority,omitempty"`
	Categories      []string `json:"categories,omitempty"`
	RelatedTo       string   `json:"related_to,omitempty"`
	Children        []Todo   `json:"children,omitempty"`
	Href            string   `json:"href"`
}
