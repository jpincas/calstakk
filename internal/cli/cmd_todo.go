package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jpincas/calstakk/internal/dto"
	calical "github.com/jpincas/calstakk/internal/ical"
	"github.com/jpincas/calstakk/internal/protocol/caldav"
	"github.com/spf13/cobra"
)

func newCreateTodoCmd(serverURL *string) *cobra.Command {
	var (
		collection  string
		summary     string
		description string
		due         string
		start       string
		priority    int
		parentUID   string
		categories  string
	)

	cmd := &cobra.Command{
		Use:   "create-todo",
		Short: "Create a to-do item",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if summary == "" {
				return fmt.Errorf("--summary is required")
			}

			uid := uuid.New().String()
			t := &dto.Todo{
				UID:         uid,
				Summary:     summary,
				Description: description,
				Due:         due,
				Start:       start,
				Priority:    priority,
				RelatedTo:   parentUID,
				Status:      "NEEDS-ACTION",
			}
			if categories != "" {
				t.Categories = splitComma(categories)
			}

			comp, err := calical.TodoFromDTO(t)
			if err != nil {
				return fmt.Errorf("building todo: %w", err)
			}
			cal := calical.WrapInCalendar(comp)

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			objPath := homeSet + "/" + collection + "/" + uid + ".ics"
			result, err := client.PutCalendarObject(ctx, objPath, cal)
			if err != nil {
				return fmt.Errorf("creating todo: %w", err)
			}

			t.Href = result.Path
			return printJSON(t)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&summary, "summary", "", "todo title (required)")
	cmd.Flags().StringVar(&description, "description", "", "todo description")
	cmd.Flags().StringVar(&due, "due", "", "due date/time in RFC 3339 or YYYY-MM-DD")
	cmd.Flags().StringVar(&start, "start", "", "start date/time in RFC 3339 or YYYY-MM-DD")
	cmd.Flags().IntVar(&priority, "priority", 0, "priority 1 (highest) to 9 (lowest), 0 = undefined")
	cmd.Flags().StringVar(&parentUID, "parent-uid", "", "UID of parent VTODO (sets RELATED-TO)")
	cmd.Flags().StringVar(&categories, "categories", "", "comma-separated category tags")
	return cmd
}

func newListTodosCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		status     string
		dueBefore  string
		tree       bool
	)

	cmd := &cobra.Command{
		Use:   "list-todos",
		Short: "List to-do items in a collection",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			calPath := homeSet + "/" + collection
			q := &caldav.CalendarQuery{
				CompFilter: caldav.CompFilter{
					Name: "VCALENDAR",
					Comps: []caldav.CompFilter{
						{Name: "VTODO"},
					},
				},
			}

			if dueBefore != "" {
				var dueT time.Time
				dueT, err = time.Parse(time.RFC3339, dueBefore)
				if err != nil {
					dueT, err = time.Parse("2006-01-02", dueBefore)
				}
				if err != nil {
					return fmt.Errorf("parsing --due-before: must be RFC 3339 or YYYY-MM-DD")
				}
				q.CompFilter.Comps[0].End = dueT
			}

			objects, err := client.QueryCalendar(ctx, calPath, q)
			if err != nil {
				return fmt.Errorf("listing todos: %w", err)
			}

			var todos []dto.Todo
			for _, obj := range objects {
				if obj.Data == nil {
					continue
				}
				comp := calical.FirstComponent(obj.Data, "VTODO")
				if comp == nil {
					continue
				}
				t, err := calical.TodoToDTO(comp, obj.Path)
				if err != nil {
					continue
				}
				// Filter by status if specified
				if status != "" && t.Status != status {
					continue
				}
				todos = append(todos, *t)
			}

			if todos == nil {
				todos = []dto.Todo{}
			}

			if tree {
				return printJSON(buildTodoTree(todos))
			}
			return printJSON(todos)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&status, "status", "", "filter by status (NEEDS-ACTION, IN-PROCESS, COMPLETED, CANCELED)")
	cmd.Flags().StringVar(&dueBefore, "due-before", "", "include only todos due before this time")
	cmd.Flags().BoolVar(&tree, "tree", false, "return nested parent/child structure")
	return cmd
}

func newGetTodoCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		uid        string
	)

	cmd := &cobra.Command{
		Use:   "get-todo",
		Short: "Get a single to-do item by UID",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if uid == "" {
				return fmt.Errorf("--uid is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			objPath := homeSet + "/" + collection + "/" + uid + ".ics"
			obj, err := client.GetCalendarObject(ctx, objPath)
			if err != nil {
				return fmt.Errorf("getting todo: %w", err)
			}

			if obj.Data == nil {
				return fmt.Errorf("no calendar data returned")
			}
			comp := calical.FirstComponent(obj.Data, "VTODO")
			if comp == nil {
				return fmt.Errorf("no VTODO found in object")
			}
			t, err := calical.TodoToDTO(comp, obj.Path)
			if err != nil {
				return fmt.Errorf("decoding todo: %w", err)
			}
			return printJSON(t)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "todo UID (required)")
	return cmd
}

func newUpdateTodoCmd(serverURL *string) *cobra.Command {
	var (
		collection  string
		uid         string
		summary     string
		description string
		due         string
		status      string
		pct         int
		priority    int
	)

	cmd := &cobra.Command{
		Use:   "update-todo",
		Short: "Update fields of an existing to-do item",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if uid == "" {
				return fmt.Errorf("--uid is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			objPath := homeSet + "/" + collection + "/" + uid + ".ics"
			obj, err := client.GetCalendarObject(ctx, objPath)
			if err != nil {
				return fmt.Errorf("getting todo: %w", err)
			}
			if obj.Data == nil {
				return fmt.Errorf("no calendar data returned")
			}
			comp := calical.FirstComponent(obj.Data, "VTODO")
			if comp == nil {
				return fmt.Errorf("no VTODO found")
			}
			existing, err := calical.TodoToDTO(comp, obj.Path)
			if err != nil {
				return fmt.Errorf("decoding todo: %w", err)
			}

			if cmd.Flags().Changed("summary") {
				existing.Summary = summary
			}
			if cmd.Flags().Changed("description") {
				existing.Description = description
			}
			if cmd.Flags().Changed("due") {
				existing.Due = due
			}
			if cmd.Flags().Changed("status") {
				existing.Status = status
			}
			if cmd.Flags().Changed("percent-complete") {
				existing.PercentComplete = pct
			}
			if cmd.Flags().Changed("priority") {
				existing.Priority = priority
			}

			newComp, err := calical.TodoFromDTO(existing)
			if err != nil {
				return fmt.Errorf("building todo: %w", err)
			}
			cal := calical.WrapInCalendar(newComp)

			_, err = client.PutCalendarObject(ctx, objPath, cal)
			if err != nil {
				return fmt.Errorf("updating todo: %w", err)
			}

			return printJSON(existing)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "todo UID (required)")
	cmd.Flags().StringVar(&summary, "summary", "", "todo title")
	cmd.Flags().StringVar(&description, "description", "", "todo description")
	cmd.Flags().StringVar(&due, "due", "", "due date/time")
	cmd.Flags().StringVar(&status, "status", "", "NEEDS-ACTION, IN-PROCESS, COMPLETED, or CANCELED")
	cmd.Flags().IntVar(&pct, "percent-complete", 0, "completion percentage 0–100")
	cmd.Flags().IntVar(&priority, "priority", 0, "priority 1–9")
	return cmd
}

func newCompleteTodoCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		uid        string
	)

	cmd := &cobra.Command{
		Use:   "complete-todo",
		Short: "Mark a to-do item as completed",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if uid == "" {
				return fmt.Errorf("--uid is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			objPath := homeSet + "/" + collection + "/" + uid + ".ics"
			obj, err := client.GetCalendarObject(ctx, objPath)
			if err != nil {
				return fmt.Errorf("getting todo: %w", err)
			}
			if obj.Data == nil {
				return fmt.Errorf("no calendar data returned")
			}
			comp := calical.FirstComponent(obj.Data, "VTODO")
			if comp == nil {
				return fmt.Errorf("no VTODO found")
			}
			existing, err := calical.TodoToDTO(comp, obj.Path)
			if err != nil {
				return fmt.Errorf("decoding todo: %w", err)
			}

			existing.Status = "COMPLETED"
			existing.PercentComplete = 100
			existing.Completed = time.Now().UTC().Format(time.RFC3339)

			newComp, err := calical.TodoFromDTO(existing)
			if err != nil {
				return fmt.Errorf("building todo: %w", err)
			}
			cal := calical.WrapInCalendar(newComp)

			_, err = client.PutCalendarObject(ctx, objPath, cal)
			if err != nil {
				return fmt.Errorf("completing todo: %w", err)
			}

			return printJSON(existing)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "todo UID (required)")
	return cmd
}

func newDeleteTodoCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		uid        string
	)

	cmd := &cobra.Command{
		Use:   "delete-todo",
		Short: "Delete a to-do item by UID",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if uid == "" {
				return fmt.Errorf("--uid is required")
			}

			client, err := caldav.NewClient(nil, *serverURL)
			if err != nil {
				return fmt.Errorf("creating client: %w", err)
			}

			ctx := context.Background()
			homeSet, err := findHomeSet(ctx, client)
			if err != nil {
				return err
			}

			objPath := homeSet + "/" + collection + "/" + uid + ".ics"
			if err := client.RemoveAll(ctx, objPath); err != nil {
				return fmt.Errorf("deleting todo: %w", err)
			}

			return printJSON(map[string]string{"deleted": uid})
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "todo UID (required)")
	return cmd
}

// buildTodoTree converts a flat list of todos into a nested tree based on RelatedTo.
func buildTodoTree(todos []dto.Todo) []dto.Todo {
	// Index by UID for parent lookup.
	byUID := make(map[string]*dto.Todo, len(todos))
	ptrs := make([]*dto.Todo, len(todos))
	for i := range todos {
		cp := todos[i]
		cp.Children = nil
		ptrs[i] = &cp
		byUID[cp.UID] = ptrs[i]
	}

	// Attach children to parents.
	var roots []*dto.Todo
	for _, t := range ptrs {
		if t.RelatedTo == "" {
			roots = append(roots, t)
			continue
		}
		if parent, ok := byUID[t.RelatedTo]; ok {
			parent.Children = append(parent.Children, *t)
		} else {
			roots = append(roots, t) // orphaned child becomes root
		}
	}

	result := make([]dto.Todo, len(roots))
	for i, r := range roots {
		result[i] = *r
	}
	return result
}

// splitComma splits s on commas and trims whitespace from each element.
func splitComma(s string) []string {
	var result []string
	for _, part := range splitOnComma(s) {
		part = trimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func splitOnComma(s string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}
