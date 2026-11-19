package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// A new chat is prepared as soon as its agent and project are picked, the way Zed opens a session for a new thread:
// its settings and slash commands then come from the agent itself. One untouched draft per agent and project serves
// every browser. After draftIdle without a message it is closed, and its agent, which takes hundreds of megabytes,
// stops with it unless it runs other chats.
const draftIdle = 15 * time.Minute

type draft struct {
	ready     chan struct{}
	err       error
	sessionID string
	process   *owned
	timer     *time.Timer
	// options are the settings the agent answered with last, for a browser that asks before the timeline has them.
	options []json.RawMessage
}

type preparedMessage struct {
	Type      string `json:"type"`
	AgentID   string `json:"agentId"`
	Cwd       string `json:"cwd"`
	SessionID string `json:"sessionId"`
	// Attach is told here: a draft is not among the chats listed, and the timeline may not have it yet.
	Attach protocol.Attach `json:"attach"`
}

func (s *Server) prepare(c *client, agentID, cwd string) {
	d := s.draftFor(agentID, cwd)
	<-d.ready
	if d.err != nil {
		fmt.Fprintf(os.Stderr, "agent-hub: prepare %s in %s: %v\n", agentID, cwd, d.err)
		c.enqueue(encode(failedMessage{"failed", "", "start-failed"}))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Set together with the snapshot under the timeline's lock, so a later change of the draft reaches this browser.
	c.draft = d.sessionID
	options := s.timeline.Options(d.sessionID)
	if len(options) == 0 {
		options = describeOptions(parseOptions(d.options))
	}
	commands := s.timeline.Commands(d.sessionID)
	if commands == nil {
		commands = []protocol.Command{}
	}
	c.enqueue(encode(preparedMessage{"prepared", agentID, cwd, d.sessionID, d.process.attach}))
	c.enqueue(encode(optionsMessage{"options", d.sessionID, options}))
	c.enqueue(encode(commandsMessage{"commands", d.sessionID, commands}))
}

func (s *Server) draftFor(agentID, cwd string) *draft {
	key := agentID + "\x00" + cwd
	s.ownedMu.Lock()
	defer s.ownedMu.Unlock()
	if d := s.drafts[key]; d != nil {
		if d.timer != nil {
			d.timer.Reset(draftIdle)
		}
		return d
	}
	d := &draft{ready: make(chan struct{})}
	s.drafts[key] = d
	go s.create(key, d, agentID, cwd)
	return d
}

func (s *Server) create(key string, d *draft, agentID, cwd string) {
	defer close(d.ready)
	id, process, err := s.newSession(d, agentID, cwd)
	s.ownedMu.Lock()
	defer s.ownedMu.Unlock()
	if err != nil {
		d.err = err
		delete(s.drafts, key)
		return
	}
	process.sessions++
	s.ownedSessions[id] = process
	d.sessionID, d.process = id, process
	d.timer = time.AfterFunc(draftIdle, func() { s.discard(key, d) })
}

// newSession starts a session the way Zed starts a new thread: the agent's own command and environment, then the
// entry's default settings in the order the settings file lists them.
func (s *Server) newSession(d *draft, agentID, cwd string) (string, *owned, error) {
	agents, err := loadAgents()
	if err != nil {
		return "", nil, err
	}
	index := slices.IndexFunc(agents, func(a agentEntry) bool { return a.name == agentID })
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() || index < 0 {
		return "", nil, errors.New("unknown agent or directory")
	}
	agent := agents[index]
	process, err := s.ownedFor(agent, cwd)
	if err != nil {
		return "", nil, err
	}
	result, err := process.request("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}})
	if err != nil {
		return "", nil, err
	}
	created := object(result)
	id := deref(created.str("sessionId"))
	if id == "" {
		return "", nil, errors.New("session/new gave no session")
	}
	s.withTimeline(func(t *Timeline) { t.Hide(id) })
	d.options, _ = created.array("configOptions")
	defaults := object(agent.defaults)
	for _, name := range orderedKeys(agent.defaults) {
		reply, err := process.request("session/set_config_option", map[string]any{"sessionId": id, "configId": name, "value": defaults[name]})
		if values, ok := object(reply).array("configOptions"); err == nil && ok {
			d.options = values
		}
	}
	return id, process, nil
}

// useDraft turns a draft into a chat once a message is sent to it: it is listed, no longer closed when idle, and
// added to Zed's sidebar as Zed lists a thread it starts.
func (s *Server) useDraft(sessionID, text string) {
	used := ""
	s.ownedMu.Lock()
	for key, d := range s.drafts {
		if d.sessionID == sessionID {
			delete(s.drafts, key)
			d.timer.Stop()
			used = key
		}
	}
	s.ownedMu.Unlock()
	if used == "" {
		return
	}
	s.withTimeline(func(t *Timeline) { t.Show(sessionID) })
	agentID, cwd, _ := strings.Cut(used, "\x00")
	if err := s.zed.add(sessionID, agentID, firstLine(text), cwd, time.Now()); err != nil && !errors.Is(err, errNoZed) {
		fmt.Fprintf(os.Stderr, "agent-hub: add the chat to Zed: %v\n", err)
	}
}

func (s *Server) discard(key string, d *draft) {
	s.ownedMu.Lock()
	if s.drafts[key] != d {
		s.ownedMu.Unlock()
		return
	}
	delete(s.drafts, key)
	delete(s.ownedSessions, d.sessionID)
	d.process.sessions--
	idle := d.process.sessions == 0
	if idle && s.processes[key] == d.process {
		delete(s.processes, key)
	}
	s.ownedMu.Unlock()
	_, _ = d.process.request("session/close", map[string]any{"sessionId": d.sessionID})
	if idle {
		d.process.stop()
	}
}
