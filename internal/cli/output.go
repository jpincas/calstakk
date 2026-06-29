package cli

import (
	"encoding/json"
	"os"
)

// printJSON marshals v to JSON and writes it to stdout with a newline.
func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
