// Package storage implements on-disk storage for CalStakk.
//
// Disk layout per collection:
//
//	<data_dir>/
//	  <collection-name>/
//	    calendar/  <uid>.ics    calendar objects (VEVENT, VTODO)
//
// CalDAV URL paths:
//
//	/calstakk                                      user principal
//	/calstakk/calendars                            calendar home set
//	/calstakk/calendars/<name>                     calendar collection
//	/calstakk/calendars/<name>/<uid>.ics           calendar object
package storage

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	PrincipalPath    = "/calstakk"
	CalendarHomePath = "/calstakk/calendars"
)

// Store is the filesystem-backed storage layer.
type Store struct {
	dataDir string
}

// New returns a Store rooted at dataDir, creating the directory if needed.
// Any collections with legacy flat-layout .ics files are migrated into
// the calendar/ subdirectory automatically.
func New(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating data dir: %w", err)
	}
	s := &Store{dataDir: dataDir}
	if err := s.migrateAll(); err != nil {
		return nil, fmt.Errorf("migrating storage layout: %w", err)
	}
	return s, nil
}

// CollectionName extracts the collection name from a CalDAV calendar URL path.
// e.g. "/calstakk/calendars/work" → "work"
func CollectionName(urlPath string) string {
	p := strings.TrimPrefix(urlPath, CalendarHomePath)
	p = strings.Trim(p, "/")
	parts := strings.SplitN(p, "/", 2)
	return parts[0]
}

// ObjectUID extracts the UID portion from a CalDAV object URL path.
// e.g. "/calstakk/calendars/work/abc123.ics" → "abc123"
func ObjectUID(urlPath string) string {
	return strings.TrimSuffix(filepath.Base(urlPath), ".ics")
}

// Collection represents a collection on disk.
type Collection struct {
	Name        string
	DisplayName string
	Path        string // CalDAV URL path (no trailing slash)
}

// Object holds metadata for a single calendar object file.
type Object struct {
	Path     string    // CalDAV URL path
	FilePath string    // absolute filesystem path
	ModTime  time.Time // last-modified time
	ETag     string
	Size     int64
}

// ListCollections returns all collections in the data directory.
func (s *Store) ListCollections() ([]Collection, error) {
	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		return nil, fmt.Errorf("listing collections: %w", err)
	}

	var cols []Collection
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		cols = append(cols, s.collectionFromName(e.Name()))
	}
	return cols, nil
}

// GetCollection returns a Collection by CalDAV URL path.
func (s *Store) GetCollection(urlPath string) (*Collection, error) {
	name := CollectionName(urlPath)
	if name == "" {
		return nil, os.ErrNotExist
	}

	dirPath := filepath.Join(s.dataDir, name)
	info, err := os.Stat(dirPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrNotExist
	}

	col := s.collectionFromName(name)
	return &col, nil
}

// GetCollectionByName returns a Collection by plain name (not URL path).
func (s *Store) GetCollectionByName(name string) (*Collection, error) {
	dirPath := filepath.Join(s.dataDir, name)
	info, err := os.Stat(dirPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrNotExist
	}
	col := s.collectionFromName(name)
	return &col, nil
}

// CreateCollection creates a new collection directory.
func (s *Store) CreateCollection(name string) error {
	dirPath := filepath.Join(s.dataDir, name)
	if err := os.Mkdir(dirPath, 0o755); err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("collection %q already exists", name)
		}
		return fmt.Errorf("creating collection: %w", err)
	}
	if err := os.Mkdir(filepath.Join(dirPath, "calendar"), 0o755); err != nil {
		return fmt.Errorf("creating calendar subdir: %w", err)
	}
	return nil
}

// DeleteCollection removes a collection directory and all its objects.
func (s *Store) DeleteCollection(name string) error {
	dirPath := filepath.Join(s.dataDir, name)
	if err := os.RemoveAll(dirPath); err != nil {
		return fmt.Errorf("deleting collection: %w", err)
	}
	return nil
}

// ListObjects returns all .ics objects in a collection.
func (s *Store) ListObjects(collectionURLPath string) ([]Object, error) {
	name := CollectionName(collectionURLPath)
	dirPath := filepath.Join(s.dataDir, name, "calendar")

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("listing objects: %w", err)
	}

	var objs []Object
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".ics") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		fPath := filepath.Join(dirPath, e.Name())
		etag, err := etagFromFile(fPath)
		if err != nil {
			continue
		}
		uid := strings.TrimSuffix(e.Name(), ".ics")
		objs = append(objs, Object{
			Path:     collectionURLPath + "/" + uid + ".ics",
			FilePath: fPath,
			ModTime:  info.ModTime(),
			ETag:     etag,
			Size:     info.Size(),
		})
	}
	return objs, nil
}

// GetObject returns metadata for a single calendar object by CalDAV URL path.
func (s *Store) GetObject(urlPath string) (*Object, error) {
	fPath := s.filePathFromURL(urlPath)

	info, err := os.Stat(fPath)
	if err != nil {
		return nil, err
	}

	etag, err := etagFromFile(fPath)
	if err != nil {
		return nil, err
	}

	return &Object{
		Path:     urlPath,
		FilePath: fPath,
		ModTime:  info.ModTime(),
		ETag:     etag,
		Size:     info.Size(),
	}, nil
}

// ReadObject reads and returns the raw .ics bytes for a calendar object.
func (s *Store) ReadObject(urlPath string) ([]byte, error) {
	fPath := s.filePathFromURL(urlPath)
	return os.ReadFile(fPath)
}

// WriteObject writes raw .ics bytes to the file for a calendar object.
func (s *Store) WriteObject(urlPath string, data []byte) error {
	fPath := s.filePathFromURL(urlPath)
	if err := os.MkdirAll(filepath.Dir(fPath), 0o755); err != nil {
		return fmt.Errorf("ensuring parent dir: %w", err)
	}
	return os.WriteFile(fPath, data, 0o644)
}

// DeleteObject removes a calendar object file.
func (s *Store) DeleteObject(urlPath string) error {
	fPath := s.filePathFromURL(urlPath)
	if err := os.Remove(fPath); err != nil {
		return fmt.Errorf("deleting object: %w", err)
	}
	return nil
}

// ObjectExists reports whether an object exists at the given URL path.
func (s *Store) ObjectExists(urlPath string) bool {
	_, err := os.Stat(s.filePathFromURL(urlPath))
	return err == nil
}

// --- internal helpers ---

func (s *Store) collectionFromName(name string) Collection {
	return Collection{
		Name:        name,
		DisplayName: name,
		Path:        CalendarHomePath + "/" + name,
	}
}

// filePathFromURL maps a CalDAV calendar object URL to the filesystem path
// under the collection's calendar/ subdirectory.
func (s *Store) filePathFromURL(urlPath string) string {
	name := CollectionName(urlPath)
	uid := ObjectUID(urlPath)
	return filepath.Join(s.dataDir, name, "calendar", uid+".ics")
}

func etagFromFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// migrateAll inspects every collection directory and moves legacy flat .ics
// files into the calendar/ subdirectory. Also ensures contacts/ and files/
// subdirs exist. Idempotent.
func (s *Store) migrateAll() error {
	entries, err := os.ReadDir(s.dataDir)
	if os.IsNotExist(err) {
		return nil // nothing to migrate
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if err := s.migrateCollection(e.Name()); err != nil {
			return fmt.Errorf("migrating collection %q: %w", e.Name(), err)
		}
	}
	return nil
}

func (s *Store) migrateCollection(name string) error {
	colDir := filepath.Join(s.dataDir, name)
	calDir := filepath.Join(colDir, "calendar")

	if err := os.MkdirAll(calDir, 0o755); err != nil {
		return err
	}

	// Move any .ics files that are directly in colDir (legacy flat layout).
	entries, err := os.ReadDir(colDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".ics") {
			continue
		}
		src := filepath.Join(colDir, e.Name())
		dst := filepath.Join(calDir, e.Name())
		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("moving %s → %s: %w", src, dst, err)
		}
		log.Printf("storage: migrated %s/%s into calendar/", name, e.Name())
	}
	return nil
}
