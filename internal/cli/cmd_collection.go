package cli

import (
	"context"
	"fmt"

	"github.com/jpincas/calstakk/internal/dto"
	"github.com/jpincas/calstakk/internal/protocol/caldav"
	"github.com/jpincas/calstakk/internal/storage"
	"github.com/spf13/cobra"
)

// Note: findHomeSet is defined in cmd_event.go and shared within this package.

func newListCollectionsCmd(serverURL *string) *cobra.Command {
	return &cobra.Command{
		Use:   "list-collections",
		Short: "List all calendar collections",
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			principal, err := client.FindCurrentUserPrincipal(ctx)
			if err != nil {
				return fmt.Errorf("finding principal: %w", err)
			}

			homeSet, err := client.FindCalendarHomeSet(ctx, principal)
			if err != nil {
				return fmt.Errorf("finding home set: %w", err)
			}

			cals, err := client.FindCalendars(ctx, homeSet)
			if err != nil {
				return fmt.Errorf("listing calendars: %w", err)
			}

			result := make([]dto.Collection, len(cals))
			for i, c := range cals {
				result[i] = dto.Collection{
					Name:        storage.CollectionName(c.Path),
					DisplayName: c.Name,
					Href:        c.Path,
				}
			}

			return printJSON(result)
		},
	}
}

func newCreateCollectionCmd(serverURL *string) *cobra.Command {
	var name string
	var displayName string

	cmd := &cobra.Command{
		Use:   "create-collection",
		Short: "Create a new calendar collection",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			if displayName == "" {
				displayName = name
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			principal, err := client.FindCurrentUserPrincipal(ctx)
			if err != nil {
				return fmt.Errorf("finding principal: %w", err)
			}

			homeSet, err := client.FindCalendarHomeSet(ctx, principal)
			if err != nil {
				return fmt.Errorf("finding home set: %w", err)
			}

			calPath := homeSet + "/" + name
			if err := client.Mkdir(ctx, calPath); err != nil {
				return fmt.Errorf("creating collection: %w", err)
			}

			return printJSON(dto.Collection{
				Name:        name,
				DisplayName: displayName,
				Href:        calPath,
			})
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "collection name (required)")
	cmd.Flags().StringVar(&displayName, "display-name", "", "display name (defaults to name)")
	return cmd
}

func newDeleteCollectionCmd(serverURL *string) *cobra.Command {
	var name string

	cmd := &cobra.Command{
		Use:   "delete-collection",
		Short: "Delete a calendar collection and all its contents",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			principal, err := client.FindCurrentUserPrincipal(ctx)
			if err != nil {
				return fmt.Errorf("finding principal: %w", err)
			}

			homeSet, err := client.FindCalendarHomeSet(ctx, principal)
			if err != nil {
				return fmt.Errorf("finding home set: %w", err)
			}

			calPath := homeSet + "/" + name
			if err := client.RemoveAll(ctx, calPath); err != nil {
				return fmt.Errorf("deleting collection: %w", err)
			}

			return printJSON(map[string]string{"deleted": name})
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "collection name (required)")
	return cmd
}
