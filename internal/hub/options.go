package hub

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// primary settings come first, as Zed shows them; the rest keep the agent's order.
var primary = []string{"model", "thought_level"}

func rank(category *string) int {
	if category != nil {
		if index := slices.Index(primary, *category); index >= 0 {
			return index
		}
	}
	return len(primary)
}

// describeOptions gives the web app every choice and switch a session offers.
func describeOptions(all []option) []protocol.ConfigOption {
	described := []protocol.ConfigOption{}
	for _, o := range all {
		if !(o.kind == "select" && len(o.values) > 0) && o.kind != "boolean" {
			continue
		}
		choices := make([]protocol.ConfigChoice, len(o.values))
		for i, c := range o.values {
			choices[i] = protocol.ConfigChoice{Value: c.value, Name: c.name, Description: c.description}
		}
		described = append(described, protocol.ConfigOption{ID: o.id, Name: o.name, Category: o.category, Type: o.kind, Current: o.raw, Choices: choices})
	}
	slices.SortStableFunc(described, func(a, b protocol.ConfigOption) int {
		return rank(a.Category) - rank(b.Category)
	})
	return described
}

func (t *Timeline) Options(sessionID string) []protocol.ConfigOption {
	if s := t.sessions[sessionID]; s != nil {
		return describeOptions(s.options)
	}
	return nil
}

// offered checks that value fits the setting configID: one of its choices, or true or false for a switch.
func offered(options []protocol.ConfigOption, configID string, value json.RawMessage) error {
	index := slices.IndexFunc(options, func(o protocol.ConfigOption) bool { return o.ID == configID })
	if index < 0 {
		return fmt.Errorf("no setting %s", configID)
	}
	o := options[index]
	if o.Type == "boolean" {
		var flag bool
		return json.Unmarshal(value, &flag)
	}
	var choice string
	if json.Unmarshal(value, &choice) == nil && slices.ContainsFunc(o.Choices, func(c protocol.ConfigChoice) bool { return c.Value == choice }) {
		return nil
	}
	return fmt.Errorf("%s has no choice %s", configID, value)
}
