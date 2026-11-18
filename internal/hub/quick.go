package hub

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/knaus94/agent-hub/internal/protocol"
)

const (
	quickFile   = "quick.json"
	quickMax    = 50
	quickLabel  = 40
	quickText   = 4000
	quickIDSize = 64
)

var agentKinds = []string{"claude", "codex", "opencode", "other"}

type quickMessage struct {
	Type    string                 `json:"type"`
	Actions []protocol.QuickAction `json:"actions"`
}

func (s *Server) loadQuick() {
	s.quick = []protocol.QuickAction{}
	var actions []protocol.QuickAction
	err := readJSON(filepath.Join(s.config.Home, quickFile), &actions)
	if err == nil {
		err = validQuick(actions)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(os.Stderr, "agent-hub: %s: %v\n", quickFile, err)
		return
	}
	if actions != nil {
		s.quick = actions
	}
}

// validQuick holds the quick actions a browser sends to what the web app can make: anyone who reaches the socket
// and logs in can send anything.
func validQuick(actions []protocol.QuickAction) error {
	if len(actions) > quickMax {
		return fmt.Errorf("more than %d quick actions", quickMax)
	}
	ids := map[string]bool{}
	for _, action := range actions {
		switch {
		case action.ID == "" || len(action.ID) > quickIDSize || ids[action.ID]:
			return errors.New("a quick action needs its own id")
		case strings.TrimSpace(action.Label) == "" || utf8.RuneCountInString(action.Label) > quickLabel:
			return fmt.Errorf("a quick action's name is 1 to %d characters", quickLabel)
		case strings.TrimSpace(action.Text) == "" || utf8.RuneCountInString(action.Text) > quickText:
			return fmt.Errorf("a quick action's text is 1 to %d characters", quickText)
		}
		for _, agent := range action.Agents {
			if !slices.Contains(agentKinds, agent) {
				return fmt.Errorf("unknown agent %q", agent)
			}
		}
		ids[action.ID] = true
	}
	return nil
}

// setQuick replaces the quick actions and shows them to every browser. A list it refuses goes back to the sender as
// the one kept, so the browser does not show actions that were never saved. The caller holds s.mu.
func (s *Server) setQuick(c *client, actions []protocol.QuickAction) {
	if err := validQuick(actions); err != nil {
		fmt.Fprintf(os.Stderr, "agent-hub: quick actions refused: %v\n", err)
		c.enqueue(encode(quickMessage{"quick", s.quick}))
		return
	}
	for i := range actions {
		if actions[i].Agents == nil {
			actions[i].Agents = []string{}
		}
	}
	s.quick = actions
	message := encode(quickMessage{"quick", actions})
	for c := range s.clients {
		if c.authed {
			c.enqueue(message)
		}
	}
	go func() {
		s.quickMu.Lock()
		defer s.quickMu.Unlock()
		// The list is taken when it is written, so of two quick changes the later one is what stays on disk.
		s.mu.Lock()
		current := s.quick
		s.mu.Unlock()
		if err := writeJSON(filepath.Join(s.config.Home, quickFile), current); err != nil {
			fmt.Fprintf(os.Stderr, "agent-hub: %s: %v\n", quickFile, err)
		}
	}()
}
