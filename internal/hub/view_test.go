package hub

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// say has the agent of source "src" write a piece of its reply in a chat.
func say(t *Timeline, sessionID, text string) {
	t.Apply("src", "agent", json.RawMessage(fmt.Sprintf(
		`{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":%q,"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":%q}}}}`,
		sessionID, text)))
}

// sent drains what a browser was sent, as "type:sessionId".
func sent(c *client) []string {
	var got []string
	for {
		select {
		case data := <-c.send:
			var m struct{ Type, SessionID string }
			_ = json.Unmarshal(data, &m)
			got = append(got, m.Type+":"+m.SessionID)
		default:
			return got
		}
	}
}

func newViewServer() (*Server, *client) {
	timeline := NewTimeline()
	timeline.Attach("src", "Claude (test)", 0)
	timeline.Live("src")
	say(timeline, "a", "one")
	say(timeline, "b", "two")
	say(timeline, "c", "three")
	timeline.Flush()
	c := &client{send: make(chan []byte, 64), authed: true}
	return &Server{timeline: timeline, clients: map[*client]struct{}{c: {}}}, c
}

func TestViewSendsEachPaneWhatItLacks(t *testing.T) {
	s, c := newViewServer()
	zero := 0
	steps := []struct {
		panes []pane
		want  []string
	}{
		{[]pane{{"a", nil}}, []string{"timeline:a"}},
		// A chat already shown is not sent again when another joins it.
		{[]pane{{"a", nil}, {"b", nil}}, []string{"timeline:b"}},
		{[]pane{{"b", nil}}, nil},
		// After a reconnect every pane asks from where it holds entries.
		{[]pane{{"a", &zero}, {"b", &zero}}, []string{"timeline:a", "timeline:b"}},
	}
	for i, step := range steps {
		s.view(c, step.panes)
		got := slices.DeleteFunc(sent(c), func(m string) bool { return !strings.HasPrefix(m, "timeline:") })
		if !slices.Equal(got, step.want) {
			t.Errorf("step %d: sent %v, want %v", i, got, step.want)
		}
	}
	if !slices.Equal(c.open, []string{"a", "b"}) {
		t.Errorf("open = %v", c.open)
	}
}

func TestFlushSendsChangesOfEveryShownChat(t *testing.T) {
	s, c := newViewServer()
	s.view(c, []pane{{"a", nil}, {"b", nil}})
	sent(c)
	say(s.timeline, "a", " more")
	say(s.timeline, "b", " more")
	say(s.timeline, "c", " more")
	s.flush()
	got := slices.DeleteFunc(sent(c), func(m string) bool { return m == "sessions:" })
	if !slices.Equal(got, []string{"patch:a", "patch:b"}) {
		t.Errorf("sent %v, want patches of a and b only", got)
	}
}

func TestViewMessageIsChecked(t *testing.T) {
	for message, valid := range map[string]bool{
		`{"type":"view","panes":[]}`: true,
		`{"type":"view","panes":[{"sessionId":"a"},{"sessionId":"b","from":3},{"sessionId":"c"},{"sessionId":"d"}]}`:          true,
		`{"type":"view","panes":[{"sessionId":"a"},{"sessionId":"b"},{"sessionId":"c"},{"sessionId":"d"},{"sessionId":"e"}]}`: false,
		`{"type":"view","panes":[{"sessionId":""}]}`: false,
		`{"type":"view"}`: false,
	} {
		if _, ok := parseClientMessage([]byte(message)); ok != valid {
			t.Errorf("%s: valid = %v, want %v", message, ok, valid)
		}
	}
}
