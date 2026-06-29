// Package server wires all HTTP handlers onto a single server.
//
// Path routing:
//
//	/app/...        static web UI (if configured)
//	everything else CalDAV (VEVENT, VTODO)
package server

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	gocaldav "github.com/emersion/go-webdav/caldav"
	caldavbackend "github.com/jpincas/calstakk/internal/caldav"
)

// Server routes requests to CalDAV and the web UI.
type Server struct {
	caldavHandler http.Handler
	webDir        string
}

// New returns a Server backed by the given CalDAV backend.
func New(backend *caldavbackend.Backend) *Server {
	return &Server{
		caldavHandler: &gocaldav.Handler{Backend: backend},
	}
}

// WithWebDir enables the static web UI served from dir at /app/.
func (s *Server) WithWebDir(dir string) *Server {
	s.webDir = dir
	return s
}

// ServeHTTP dispatches by path prefix.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path

	// Redirect bare root to the web UI.
	if p == "/" && s.webDir != "" {
		http.Redirect(w, r, "/app/", http.StatusFound)
		return
	}

	// Static web UI.
	if strings.HasPrefix(p, "/app") {
		if s.webDir != "" {
			// Strip the /app prefix without using http.StripPrefix (which redirects
			// /app → /app/ and causes a redirect loop for SPA deep-link URLs).
			r2 := r.Clone(r.Context())
			r2.URL.Path = strings.TrimPrefix(p, "/app")
			if r2.URL.Path == "" {
				r2.URL.Path = "/"
			}
			spaHandler(s.webDir).ServeHTTP(w, r2)
		} else {
			http.Error(w, "web UI not configured (set --web-dir or CALSTAKK_WEB_DIR)", http.StatusNotFound)
		}
		return
	}

	// CalDAV catches everything else (principal discovery, calendars, well-known).
	s.caldavHandler.ServeHTTP(w, r)
}

// ListenAndServe starts the server on host:port.
func (s *Server) ListenAndServe(host string, port int) error {
	addr := fmt.Sprintf("%s:%d", host, port)
	return http.ListenAndServe(addr, s)
}

// spaHandler serves static files from dir; any path that doesn't map to a
// real file gets index.html so the SPA router handles client-side navigation.
// All file serving goes through http.FileServer except the SPA fallback, which
// is written directly to avoid FileServer's directory-redirect behavior.
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/")
		if rel == "" {
			rel = "index.html"
		}
		f, err := http.Dir(dir).Open(rel)
		if err != nil {
			serveIndex(w, dir)
			return
		}
		defer func() { _ = f.Close() }()
		st, err := f.Stat()
		if err != nil || st.IsDir() {
			// Directory — send index.html for SPA routing.
			serveIndex(w, dir)
			return
		}
		// Real file: let FileServer handle caching headers, ETag, etc.
		fs.ServeHTTP(w, r)
	})
}

// serveIndex writes the SPA's index.html directly, bypassing any redirect logic.
func serveIndex(w http.ResponseWriter, dir string) {
	data, err := os.ReadFile(dir + "/index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
