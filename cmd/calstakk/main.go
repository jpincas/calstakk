package main

import (
	"log"
	"os"

	"github.com/jpincas/calstakk/internal/caldav"
	"github.com/jpincas/calstakk/internal/cli"
	"github.com/jpincas/calstakk/internal/config"
	"github.com/jpincas/calstakk/internal/server"
	"github.com/jpincas/calstakk/internal/storage"
	"github.com/spf13/cobra"
)

func main() {
	var overridePort int
	var overrideWebDir string

	root := cli.NewRootCmd()

	serveCmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the CalDAV HTTP server",
		RunE: func(cmd *cobra.Command, args []string) error {
			serverURL, _ := root.PersistentFlags().GetString("server-url")
			cfg, err := config.Load(serverURL, overridePort)
			if err != nil {
				return err
			}
			if overrideWebDir != "" {
				cfg.Server.WebDir = overrideWebDir
			}

			store, err := storage.New(cfg.Server.DataDir)
			if err != nil {
				return err
			}

			backend := caldav.New(store)

			srv := server.New(backend).
				WithWebDir(cfg.Server.WebDir)

			if cfg.Server.WebDir != "" {
				log.Printf("calstakk serving on %s:%d (data: %s, web: %s)",
					cfg.Server.Host, cfg.Server.Port, cfg.Server.DataDir, cfg.Server.WebDir)
			} else {
				log.Printf("calstakk serving on %s:%d (data: %s)",
					cfg.Server.Host, cfg.Server.Port, cfg.Server.DataDir)
			}
			return srv.ListenAndServe(cfg.Server.Host, cfg.Server.Port)
		},
	}

	serveCmd.Flags().IntVar(&overridePort, "port", 0, "port to listen on (overrides config)")
	serveCmd.Flags().StringVar(&overrideWebDir, "web-dir", "", "directory to serve web UI from (overrides config)")
	root.AddCommand(serveCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
