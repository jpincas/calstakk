package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/emersion/go-webdav/caldav"
	"github.com/google/uuid"
	"github.com/jpincas/calstakk/internal/dto"
	calical "github.com/jpincas/calstakk/internal/ical"
	"github.com/spf13/cobra"
)

func newCreateEventCmd(serverURL *string) *cobra.Command {
	var (
		collection   string
		summary      string
		description  string
		start        string
		end          string
		duration     string
		allDay       bool
		location     string
		status       string
		rruleStr     string
		recurrenceID string
	)

	cmd := &cobra.Command{
		Use:   "create-event",
		Short: "Create a calendar event",
		RunE: func(cmd *cobra.Command, args []string) error {
			if collection == "" {
				return fmt.Errorf("--collection is required")
			}
			if summary == "" {
				return fmt.Errorf("--summary is required")
			}
			if start == "" {
				return fmt.Errorf("--start is required")
			}

			uid := uuid.New().String()
			e := &dto.Event{
				UID:          uid,
				Summary:      summary,
				Description:  description,
				Start:        start,
				End:          end,
				Duration:     duration,
				AllDay:       allDay,
				Location:     location,
				Status:       status,
				RRule:        rruleStr,
				RecurrenceID: recurrenceID,
			}

			comp, err := calical.EventFromDTO(e)
			if err != nil {
				return fmt.Errorf("building event: %w", err)
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
				return fmt.Errorf("creating event: %w", err)
			}

			e.Href = result.Path
			return printJSON(e)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&summary, "summary", "", "event title (required)")
	cmd.Flags().StringVar(&description, "description", "", "event description")
	cmd.Flags().StringVar(&start, "start", "", "start datetime RFC 3339 or YYYY-MM-DD (required)")
	cmd.Flags().StringVar(&end, "end", "", "end datetime RFC 3339 or YYYY-MM-DD")
	cmd.Flags().StringVar(&duration, "duration", "", "ISO 8601 duration (e.g. PT1H)")
	cmd.Flags().BoolVar(&allDay, "all-day", false, "create as all-day event")
	cmd.Flags().StringVar(&location, "location", "", "event location")
	cmd.Flags().StringVar(&status, "status", "", "TENTATIVE, CONFIRMED, or CANCELED")
	cmd.Flags().StringVar(&rruleStr, "rrule", "", "recurrence rule (e.g. FREQ=WEEKLY)")
	cmd.Flags().StringVar(&recurrenceID, "recurrence-id", "", "recurrence ID for overriding an occurrence")
	return cmd
}

func newListEventsCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		from       string
		to         string
	)

	cmd := &cobra.Command{
		Use:   "list-events",
		Short: "List events in a collection",
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
						{Name: "VEVENT"},
					},
				},
			}

			if from != "" || to != "" {
				var fromT, toT time.Time
				if from != "" {
					fromT, err = time.Parse(time.RFC3339, from)
					if err != nil {
						fromT, err = time.Parse("2006-01-02", from)
					}
					if err != nil {
						return fmt.Errorf("parsing --from: must be RFC 3339 or YYYY-MM-DD")
					}
				}
				if to != "" {
					toT, err = time.Parse(time.RFC3339, to)
					if err != nil {
						toT, err = time.Parse("2006-01-02", to)
					}
					if err != nil {
						return fmt.Errorf("parsing --to: must be RFC 3339 or YYYY-MM-DD")
					}
				}
				q.CompFilter.Comps[0].Start = fromT
				q.CompFilter.Comps[0].End = toT
			}

			objects, err := client.QueryCalendar(ctx, calPath, q)
			if err != nil {
				return fmt.Errorf("listing events: %w", err)
			}

			// When a time range is specified, expand recurring events into
			// individual occurrence objects. Otherwise return master VEVENTs.
			if from != "" || to != "" {
				var fromT, toT time.Time
				if from != "" {
					fromT, _ = parseFlexTime(from)
				}
				if to != "" {
					toT, _ = parseFlexTime(to)
				}

				var occurrences []dto.Occurrence
				for _, obj := range objects {
					if obj.Data == nil {
						continue
					}
					master := calical.FirstComponent(obj.Data, "VEVENT")
					if master == nil || master.Props.Get("RRULE") == nil {
						// Non-recurring: return as a single occurrence
						e, err := calical.EventToDTO(master, obj.Path)
						if err != nil {
							continue
						}
						start := e.Start
						occurrences = append(occurrences, dto.Occurrence{
							Event:          *e,
							OccurrenceDate: start,
						})
						continue
					}
					exceptions := calical.ExtractExceptions(obj.Data)
					occs, err := calical.ExpandOccurrences(master, obj.Path, fromT, toT, exceptions)
					if err != nil {
						continue
					}
					occurrences = append(occurrences, occs...)
				}
				if occurrences == nil {
					occurrences = []dto.Occurrence{}
				}
				return printJSON(occurrences)
			}

			var events []dto.Event
			for _, obj := range objects {
				if obj.Data == nil {
					continue
				}
				comp := calical.FirstComponent(obj.Data, "VEVENT")
				if comp == nil {
					continue
				}
				e, err := calical.EventToDTO(comp, obj.Path)
				if err != nil {
					continue
				}
				events = append(events, *e)
			}

			if events == nil {
				events = []dto.Event{}
			}
			return printJSON(events)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&from, "from", "", "include events at or after this time (RFC 3339 or YYYY-MM-DD)")
	cmd.Flags().StringVar(&to, "to", "", "include events before this time (RFC 3339 or YYYY-MM-DD)")
	return cmd
}

func newGetEventCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		uid        string
	)

	cmd := &cobra.Command{
		Use:   "get-event",
		Short: "Get a single event by UID",
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
				return fmt.Errorf("getting event: %w", err)
			}

			if obj.Data == nil {
				return fmt.Errorf("no calendar data returned")
			}
			comp := calical.FirstComponent(obj.Data, "VEVENT")
			if comp == nil {
				return fmt.Errorf("no VEVENT found in object")
			}
			e, err := calical.EventToDTO(comp, obj.Path)
			if err != nil {
				return fmt.Errorf("decoding event: %w", err)
			}
			return printJSON(e)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "event UID (required)")
	return cmd
}

func newUpdateEventCmd(serverURL *string) *cobra.Command {
	var (
		collection  string
		uid         string
		summary     string
		description string
		start       string
		end         string
		duration    string
		allDay      bool
		location    string
		status      string
		rruleStr    string
	)

	cmd := &cobra.Command{
		Use:   "update-event",
		Short: "Update fields of an existing event",
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
				return fmt.Errorf("getting event: %w", err)
			}
			if obj.Data == nil {
				return fmt.Errorf("no calendar data returned")
			}
			comp := calical.FirstComponent(obj.Data, "VEVENT")
			if comp == nil {
				return fmt.Errorf("no VEVENT found")
			}
			existing, err := calical.EventToDTO(comp, obj.Path)
			if err != nil {
				return fmt.Errorf("decoding event: %w", err)
			}

			if cmd.Flags().Changed("summary") {
				existing.Summary = summary
			}
			if cmd.Flags().Changed("description") {
				existing.Description = description
			}
			if cmd.Flags().Changed("start") {
				existing.Start = start
			}
			if cmd.Flags().Changed("end") {
				existing.End = end
			}
			if cmd.Flags().Changed("duration") {
				existing.Duration = duration
			}
			if cmd.Flags().Changed("all-day") {
				existing.AllDay = allDay
			}
			if cmd.Flags().Changed("location") {
				existing.Location = location
			}
			if cmd.Flags().Changed("status") {
				existing.Status = status
			}
			if cmd.Flags().Changed("rrule") {
				existing.RRule = rruleStr
			}

			newComp, err := calical.EventFromDTO(existing)
			if err != nil {
				return fmt.Errorf("building event: %w", err)
			}
			cal := calical.WrapInCalendar(newComp)

			_, err = client.PutCalendarObject(ctx, objPath, cal)
			if err != nil {
				return fmt.Errorf("updating event: %w", err)
			}

			return printJSON(existing)
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "event UID (required)")
	cmd.Flags().StringVar(&summary, "summary", "", "event title")
	cmd.Flags().StringVar(&description, "description", "", "event description")
	cmd.Flags().StringVar(&start, "start", "", "start datetime RFC 3339 or YYYY-MM-DD")
	cmd.Flags().StringVar(&end, "end", "", "end datetime RFC 3339 or YYYY-MM-DD")
	cmd.Flags().StringVar(&duration, "duration", "", "ISO 8601 duration")
	cmd.Flags().BoolVar(&allDay, "all-day", false, "set as all-day event")
	cmd.Flags().StringVar(&location, "location", "", "event location")
	cmd.Flags().StringVar(&status, "status", "", "event status")
	cmd.Flags().StringVar(&rruleStr, "rrule", "", "recurrence rule")
	return cmd
}

func newDeleteEventCmd(serverURL *string) *cobra.Command {
	var (
		collection string
		uid        string
	)

	cmd := &cobra.Command{
		Use:   "delete-event",
		Short: "Delete an event by UID",
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
				return fmt.Errorf("deleting event: %w", err)
			}

			return printJSON(map[string]string{"deleted": uid})
		},
	}

	cmd.Flags().StringVar(&collection, "collection", "", "collection name (required)")
	cmd.Flags().StringVar(&uid, "uid", "", "event UID (required)")
	return cmd
}

// parseFlexTime parses RFC 3339 or YYYY-MM-DD.
func parseFlexTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02", s)
}

// findHomeSet is a helper that finds the CalDAV calendar home set path.
func findHomeSet(ctx context.Context, client *caldav.Client) (string, error) {
	principal, err := client.FindCurrentUserPrincipal(ctx)
	if err != nil {
		return "", fmt.Errorf("finding principal: %w", err)
	}
	homeSet, err := client.FindCalendarHomeSet(ctx, principal)
	if err != nil {
		return "", fmt.Errorf("finding home set: %w", err)
	}
	return homeSet, nil
}
