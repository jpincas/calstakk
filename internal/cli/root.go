// Package cli defines the CalStakk CLI commands.
package cli

import (
	"github.com/jpincas/calstakk/internal/config"
	"github.com/spf13/cobra"
)

// NewRootCmd returns the root cobra command with all subcommands registered.
func NewRootCmd() *cobra.Command {
	var serverURL string

	root := &cobra.Command{
		Use:          "calstakk",
		Short:        "Agent-friendly CalDAV server and CLI",
		SilenceUsage: true,
		// Load config before every subcommand so that serverURL defaults to
		// the configured value when --server-url is not supplied.
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if serverURL != "" {
				return nil // flag explicitly set; skip config load
			}
			cfg, err := config.Load("", 0)
			if err != nil {
				return err
			}
			serverURL = cfg.Client.ServerURL
			return nil
		},
	}

	root.PersistentFlags().StringVar(&serverURL, "server-url", "", "CalDAV server URL (overrides config)")

	// Collection commands
	root.AddCommand(newListCollectionsCmd(&serverURL))
	root.AddCommand(newCreateCollectionCmd(&serverURL))
	root.AddCommand(newDeleteCollectionCmd(&serverURL))

	// Event commands
	root.AddCommand(newCreateEventCmd(&serverURL))
	root.AddCommand(newListEventsCmd(&serverURL))
	root.AddCommand(newGetEventCmd(&serverURL))
	root.AddCommand(newUpdateEventCmd(&serverURL))
	root.AddCommand(newDeleteEventCmd(&serverURL))

	// Todo commands
	root.AddCommand(newCreateTodoCmd(&serverURL))
	root.AddCommand(newListTodosCmd(&serverURL))
	root.AddCommand(newGetTodoCmd(&serverURL))
	root.AddCommand(newUpdateTodoCmd(&serverURL))
	root.AddCommand(newCompleteTodoCmd(&serverURL))
	root.AddCommand(newDeleteTodoCmd(&serverURL))

	return root
}
