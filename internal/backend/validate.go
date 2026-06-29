package backend

import (
	"bytes"
	"fmt"
	"net/http"

	"github.com/emersion/go-ical"
	"github.com/jpincas/calstakk/internal/protocol/webdav"
	"github.com/jpincas/calstakk/internal/storage"
)

// validateRelatedTo checks that a VTODO's RELATED-TO UID references an
// existing VTODO within the same collection. Cross-collection references
// are not supported.
func validateRelatedTo(store *storage.Store, collectionPath, parentUID string) error {
	objs, err := store.ListObjects(collectionPath)
	if err != nil {
		return fmt.Errorf("listing objects for validation: %w", err)
	}

	for _, obj := range objs {
		data, err := store.ReadObject(obj.Path)
		if err != nil {
			continue
		}
		cal, err := ical.NewDecoder(bytes.NewReader(data)).Decode()
		if err != nil {
			continue
		}
		for _, child := range cal.Children {
			if child.Name != ical.CompToDo {
				continue
			}
			uid, _ := child.Props.Text(ical.PropUID)
			if uid == parentUID {
				return nil
			}
		}
	}

	return webdav.NewHTTPError(http.StatusConflict,
		fmt.Errorf("RELATED-TO UID %q not found in collection", parentUID))
}
