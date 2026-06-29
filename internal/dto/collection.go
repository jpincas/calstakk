package dto

// Collection is the JSON wire shape for a CalDAV collection.
type Collection struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Href        string `json:"href"`
}
