// Package caldav implements the caldav.Backend interface for CalStakk.
package caldav

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	gocaldav "github.com/emersion/go-webdav/caldav"
	"github.com/jpincas/calstakk/internal/storage"
)

// Backend implements caldav.Backend backed by the filesystem storage layer.
type Backend struct {
	store *storage.Store
}

// New returns a Backend backed by store.
func New(store *storage.Store) *Backend {
	return &Backend{store: store}
}

// CurrentUserPrincipal returns the path to the single CalStakk principal.
func (b *Backend) CurrentUserPrincipal(_ context.Context) (string, error) {
	return storage.PrincipalPath, nil
}

// CalendarHomeSetPath returns the path to the calendar home set.
func (b *Backend) CalendarHomeSetPath(_ context.Context) (string, error) {
	return storage.CalendarHomePath, nil
}

// ListCalendars lists all collections.
func (b *Backend) ListCalendars(_ context.Context) ([]gocaldav.Calendar, error) {
	cols, err := b.store.ListCollections()
	if err != nil {
		return nil, fmt.Errorf("listing calendars: %w", err)
	}

	cals := make([]gocaldav.Calendar, len(cols))
	for i, c := range cols {
		cals[i] = gocaldav.Calendar{
			Path:                  c.Path,
			Name:                  c.DisplayName,
			SupportedComponentSet: []string{ical.CompEvent, ical.CompToDo},
		}
	}
	return cals, nil
}

// GetCalendar returns a single calendar by URL path.
func (b *Backend) GetCalendar(_ context.Context, path string) (*gocaldav.Calendar, error) {
	col, err := b.store.GetCollection(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, webdav.NewHTTPError(http.StatusNotFound, err)
		}
		return nil, err
	}

	return &gocaldav.Calendar{
		Path:                  col.Path,
		Name:                  col.DisplayName,
		SupportedComponentSet: []string{ical.CompEvent, ical.CompToDo},
	}, nil
}

// CreateCalendar creates a new calendar collection.
func (b *Backend) CreateCalendar(_ context.Context, cal *gocaldav.Calendar) error {
	name := storage.CollectionName(cal.Path)
	if name == "" {
		return webdav.NewHTTPError(http.StatusBadRequest, fmt.Errorf("invalid calendar path"))
	}
	if err := b.store.CreateCollection(name); err != nil {
		return webdav.NewHTTPError(http.StatusConflict, err)
	}
	return nil
}

// GetCalendarObject returns a single calendar object by URL path.
func (b *Backend) GetCalendarObject(_ context.Context, path string, _ *gocaldav.CalendarCompRequest) (*gocaldav.CalendarObject, error) {
	obj, err := b.store.GetObject(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, webdav.NewHTTPError(http.StatusNotFound, err)
		}
		return nil, err
	}

	data, err := b.store.ReadObject(path)
	if err != nil {
		return nil, err
	}

	cal, err := ical.NewDecoder(bytes.NewReader(data)).Decode()
	if err != nil {
		return nil, fmt.Errorf("decoding ical: %w", err)
	}

	return &gocaldav.CalendarObject{
		Path:          obj.Path,
		ModTime:       obj.ModTime,
		ContentLength: obj.Size,
		ETag:          obj.ETag,
		Data:          cal,
	}, nil
}

// ListCalendarObjects lists all objects in a collection.
func (b *Backend) ListCalendarObjects(_ context.Context, path string, _ *gocaldav.CalendarCompRequest) ([]gocaldav.CalendarObject, error) {
	objs, err := b.store.ListObjects(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, webdav.NewHTTPError(http.StatusNotFound, err)
		}
		return nil, err
	}

	cos := make([]gocaldav.CalendarObject, 0, len(objs))
	for _, obj := range objs {
		data, err := b.store.ReadObject(obj.Path)
		if err != nil {
			continue
		}
		cal, err := ical.NewDecoder(bytes.NewReader(data)).Decode()
		if err != nil {
			continue
		}
		cos = append(cos, gocaldav.CalendarObject{
			Path:          obj.Path,
			ModTime:       obj.ModTime,
			ContentLength: obj.Size,
			ETag:          obj.ETag,
			Data:          cal,
		})
	}
	return cos, nil
}

// QueryCalendarObjects returns objects matching the given query.
func (b *Backend) QueryCalendarObjects(_ context.Context, path string, query *gocaldav.CalendarQuery) ([]gocaldav.CalendarObject, error) {
	objs, err := b.store.ListObjects(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, webdav.NewHTTPError(http.StatusNotFound, err)
		}
		return nil, err
	}

	var cos []gocaldav.CalendarObject
	for _, obj := range objs {
		data, err := b.store.ReadObject(obj.Path)
		if err != nil {
			continue
		}
		cal, err := ical.NewDecoder(bytes.NewReader(data)).Decode()
		if err != nil {
			continue
		}
		co := gocaldav.CalendarObject{
			Path:          obj.Path,
			ModTime:       obj.ModTime,
			ContentLength: obj.Size,
			ETag:          obj.ETag,
			Data:          cal,
		}
		ok, err := gocaldav.Match(query.CompFilter, &co)
		if err != nil || !ok {
			continue
		}
		cos = append(cos, co)
	}
	return cos, nil
}

// PutCalendarObject writes a calendar object to storage.
func (b *Backend) PutCalendarObject(_ context.Context, path string, cal *ical.Calendar, opts *gocaldav.PutCalendarObjectOptions) (*gocaldav.CalendarObject, error) {
	compType, uid, err := gocaldav.ValidateCalendarObject(cal)
	if err != nil {
		return nil, webdav.NewHTTPError(http.StatusBadRequest, err)
	}
	if uid == "" {
		return nil, webdav.NewHTTPError(http.StatusBadRequest, fmt.Errorf("calendar object must have a UID"))
	}

	// Validate RELATED-TO for VTODO objects.
	if compType == ical.CompToDo {
		for _, child := range cal.Children {
			if child.Name != ical.CompToDo {
				continue
			}
			parentUID, _ := child.Props.Text(ical.PropRelatedTo)
			if parentUID != "" {
				collectionPath := path[:strings.LastIndex(path, "/")]
				if err := validateRelatedTo(b.store, collectionPath, parentUID); err != nil {
					return nil, err
				}
			}
		}
	}

	exists := b.store.ObjectExists(path)

	if opts.IfNoneMatch.IsWildcard() && exists {
		return nil, webdav.NewHTTPError(http.StatusPreconditionFailed, fmt.Errorf("object already exists"))
	}
	if opts.IfMatch.IsSet() && !exists {
		return nil, webdav.NewHTTPError(http.StatusPreconditionFailed, fmt.Errorf("object does not exist"))
	}

	var buf bytes.Buffer
	if err := ical.NewEncoder(&buf).Encode(cal); err != nil {
		return nil, fmt.Errorf("encoding ical: %w", err)
	}

	if err := b.store.WriteObject(path, buf.Bytes()); err != nil {
		return nil, fmt.Errorf("writing object: %w", err)
	}

	obj, err := b.store.GetObject(path)
	if err != nil {
		return nil, err
	}

	return &gocaldav.CalendarObject{
		Path:          obj.Path,
		ModTime:       obj.ModTime,
		ContentLength: obj.Size,
		ETag:          obj.ETag,
		Data:          cal,
	}, nil
}

// DeleteCalendarObject deletes a calendar object or collection from storage.
// go-webdav routes all DELETE requests here regardless of whether the target
// is a collection or an individual object.
func (b *Backend) DeleteCalendarObject(_ context.Context, path string) error {
	// A collection path has no .ics suffix; an object path does.
	if !strings.HasSuffix(path, ".ics") {
		name := storage.CollectionName(path)
		if err := b.store.DeleteCollection(name); err != nil {
			return err
		}
		return nil
	}

	if err := b.store.DeleteObject(path); err != nil {
		if os.IsNotExist(err) {
			return webdav.NewHTTPError(http.StatusNotFound, err)
		}
		return err
	}
	return nil
}
