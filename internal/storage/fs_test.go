package storage_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/jpincas/calstakk/internal/storage"
	"github.com/stretchr/testify/require"
)

func newStore(t *testing.T) *storage.Store {
	t.Helper()
	s, err := storage.New(t.TempDir())
	require.NoError(t, err)
	return s
}

// --- CollectionName ---

func TestCollectionName(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/calstakk/calendars/work", "work"},
		{"/calstakk/calendars/work/", "work"},
		{"/calstakk/calendars/work/abc.ics", "work"},
	}
	for _, tc := range cases {
		got := storage.CollectionName(tc.path)
		if got != tc.want {
			t.Errorf("CollectionName(%q) = %q; want %q", tc.path, got, tc.want)
		}
	}
}

func TestObjectUID(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/calstakk/calendars/work/abc123.ics", "abc123"},
		{"/calstakk/calendars/work/my-uid.ics", "my-uid"},
	}
	for _, tc := range cases {
		got := storage.ObjectUID(tc.path)
		if got != tc.want {
			t.Errorf("ObjectUID(%q) = %q; want %q", tc.path, got, tc.want)
		}
	}
}

// --- Collection lifecycle ---

func TestListCollections_Empty(t *testing.T) {
	s := newStore(t)
	cols, err := s.ListCollections()
	require.NoError(t, err)
	require.Empty(t, cols)
}

func TestCreateAndListCollections(t *testing.T) {
	s := newStore(t)

	require.NoError(t, s.CreateCollection("work"))
	require.NoError(t, s.CreateCollection("home"))

	cols, err := s.ListCollections()
	require.NoError(t, err)
	require.Len(t, cols, 2)

	names := map[string]bool{cols[0].Name: true, cols[1].Name: true}
	require.True(t, names["work"])
	require.True(t, names["home"])
}

func TestCreateCollection_DuplicateReturnsError(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))
	err := s.CreateCollection("work")
	require.Error(t, err)
}

func TestGetCollection(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	col, err := s.GetCollection("/calstakk/calendars/work")
	require.NoError(t, err)
	require.Equal(t, "work", col.Name)
	require.Equal(t, "/calstakk/calendars/work", col.Path)
}

func TestGetCollection_NotFound(t *testing.T) {
	s := newStore(t)
	_, err := s.GetCollection("/calstakk/calendars/nonexistent")
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestDeleteCollection(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	require.NoError(t, s.DeleteCollection("work"))

	cols, err := s.ListCollections()
	require.NoError(t, err)
	require.Empty(t, cols)
}

func TestDeleteCollection_RemovesObjects(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	objPath := "/calstakk/calendars/work/abc.ics"
	require.NoError(t, s.WriteObject(objPath, []byte("BEGIN:VCALENDAR\nEND:VCALENDAR")))

	require.NoError(t, s.DeleteCollection("work"))

	// Collection directory must be gone
	cols, err := s.ListCollections()
	require.NoError(t, err)
	require.Empty(t, cols)
}

// --- Object lifecycle ---

func TestWriteAndReadObject(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	data := []byte("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR")
	objPath := "/calstakk/calendars/work/abc.ics"

	require.NoError(t, s.WriteObject(objPath, data))

	got, err := s.ReadObject(objPath)
	require.NoError(t, err)
	require.Equal(t, data, got)
}

func TestGetObject_Metadata(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	data := []byte("BEGIN:VCALENDAR\nEND:VCALENDAR")
	objPath := "/calstakk/calendars/work/abc.ics"
	require.NoError(t, s.WriteObject(objPath, data))

	obj, err := s.GetObject(objPath)
	require.NoError(t, err)
	require.Equal(t, objPath, obj.Path)
	require.NotEmpty(t, obj.ETag)
	require.Equal(t, int64(len(data)), obj.Size)
}

func TestGetObject_NotFound(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	_, err := s.GetObject("/calstakk/calendars/work/nonexistent.ics")
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestObjectExists(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	objPath := "/calstakk/calendars/work/abc.ics"
	require.False(t, s.ObjectExists(objPath))

	require.NoError(t, s.WriteObject(objPath, []byte("data")))
	require.True(t, s.ObjectExists(objPath))
}

func TestDeleteObject(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	objPath := "/calstakk/calendars/work/abc.ics"
	require.NoError(t, s.WriteObject(objPath, []byte("data")))
	require.NoError(t, s.DeleteObject(objPath))
	require.False(t, s.ObjectExists(objPath))
}

func TestListObjects(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	for _, uid := range []string{"a", "b", "c"} {
		path := "/calstakk/calendars/work/" + uid + ".ics"
		require.NoError(t, s.WriteObject(path, []byte("data")))
	}

	objs, err := s.ListObjects("/calstakk/calendars/work")
	require.NoError(t, err)
	require.Len(t, objs, 3)
}

func TestETag_ChangesOnWrite(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	objPath := "/calstakk/calendars/work/abc.ics"
	require.NoError(t, s.WriteObject(objPath, []byte("version 1")))

	obj1, err := s.GetObject(objPath)
	require.NoError(t, err)

	require.NoError(t, s.WriteObject(objPath, []byte("version 2")))

	obj2, err := s.GetObject(objPath)
	require.NoError(t, err)

	require.NotEqual(t, obj1.ETag, obj2.ETag)
}

func TestETag_StableOnSameContent(t *testing.T) {
	s := newStore(t)
	require.NoError(t, s.CreateCollection("work"))

	objPath := "/calstakk/calendars/work/abc.ics"
	data := []byte("stable content")
	require.NoError(t, s.WriteObject(objPath, data))

	obj1, _ := s.GetObject(objPath)

	// Write the exact same bytes again.
	require.NoError(t, s.WriteObject(objPath, data))

	obj2, _ := s.GetObject(objPath)
	require.Equal(t, obj1.ETag, obj2.ETag)
}

// TestDataDir_CreatedIfAbsent checks that New creates the data dir.
func TestDataDir_CreatedIfAbsent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "calstakk", "data")
	_, err := storage.New(dir)
	require.NoError(t, err)

	info, err := os.Stat(dir)
	require.NoError(t, err)
	require.True(t, info.IsDir())
}
