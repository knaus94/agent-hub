// Package relay sits between an ACP client (Zed) and an agent process. Every line passes through unchanged; a copy
// goes to subscribers on a local socket, which also accepts commands that write into the agent's sessions.
package relay

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

type from string

const (
	fromClient from = "client"
	fromAgent  from = "agent"
	fromRelay  from = "relay"
)

var nonWord = regexp.MustCompile(`[^a-z0-9]+`)

// Slug names a relay's socket and log after its agent entry and process.
func Slug(name string, pid int) string {
	return fmt.Sprintf("%s-%d", strings.Trim(nonWord.ReplaceAllString(strings.ToLower(name), "-"), "-"), pid)
}

// SocketDir is where relays listen and where the hub and ctl look for them.
func SocketDir() (string, error) {
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		return "", errors.New("XDG_RUNTIME_DIR is not set")
	}
	return filepath.Join(runtime, "agent-hub"), nil
}

// wire holds the few fields the relay reads from an ACP message. Decoding is best effort: a field of an unexpected
// shape is left empty and the rest still counts.
type wire struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params struct {
		SessionID string          `json:"sessionId"`
		Cwd       string          `json:"cwd"`
		RequestID json.RawMessage `json:"requestId"`
		Update    struct {
			SessionUpdate string          `json:"sessionUpdate"`
			MessageID     *string         `json:"messageId"`
			Content       json.RawMessage `json:"content"`
		} `json:"update"`
	} `json:"params"`
	Result struct {
		SessionID         string `json:"sessionId"`
		Outcome           string `json:"outcome"`
		AgentCapabilities *struct {
			PromptCapabilities json.RawMessage `json:"promptCapabilities"`
		} `json:"agentCapabilities"`
	} `json:"result"`
}

func decode(line []byte) (*wire, bool) {
	trimmed := bytes.TrimSpace(line)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}
	var message wire
	if err := json.Unmarshal(trimmed, &message); err != nil {
		var typeError *json.UnmarshalTypeError
		if !errors.As(err, &typeError) {
			return nil, false
		}
	}
	return &message, true
}

func (w *wire) hasID() bool {
	return len(w.ID) > 0 && string(w.ID) != "null"
}

// stringID is the id as a string when it is one: the relay's own ids always are.
func (w *wire) stringID() string {
	var id string
	if json.Unmarshal(w.ID, &id) != nil {
		return ""
	}
	return id
}

type session struct {
	id  string
	cwd string
}

type Relay struct {
	name      string
	slug      string
	idPrefix  string
	startedAt int64

	agentIn   io.WriteCloser
	toAgent   sync.Mutex
	toClient  sync.Mutex
	logMu     sync.RWMutex
	logLines  chan []byte
	logDone   bool
	logClosed chan struct{}

	mu       sync.Mutex
	history  history
	watchers map[*subscriber]struct{}
	sessions []session
	creating map[string]string
	pending  map[string]chan []byte
	sequence int
	// asked are the agent's requests the client has not answered yet; answered are those the hub answered instead,
	// whose late reply from the client must not reach the agent a second time.
	asked    map[string]bool
	answered map[string]bool
	// prompt is what the agent said its prompts may hold besides text, from its answer to initialize.
	prompt json.RawMessage
}

// Run relays between this process's stdio and the agent command until the agent exits, and returns its exit code.
func Run(name string, command []string) int {
	pid := os.Getpid()
	r := &Relay{
		name:      name,
		slug:      Slug(name, pid),
		idPrefix:  fmt.Sprintf("agent-hub:%d:", pid),
		startedAt: time.Now().UnixMilli(),
		watchers:  map[*subscriber]struct{}{},
		creating:  map[string]string{},
		pending:   map[string]chan []byte{},
		asked:     map[string]bool{},
		answered:  map[string]bool{},
	}

	agent := exec.Command(command[0], command[1:]...)
	agent.Stderr = os.Stderr
	agentIn, err := agent.StdinPipe()
	if err != nil {
		return r.fail(command[0], err)
	}
	agentOut, err := agent.StdoutPipe()
	if err != nil {
		return r.fail(command[0], err)
	}
	if err := agent.Start(); err != nil {
		return r.fail(command[0], err)
	}
	r.agentIn = agentIn

	// A broken pipe on stdout must come back as an error, not kill the relay and every chat behind it.
	ignored := make(chan os.Signal, 1)
	signal.Notify(ignored, syscall.SIGPIPE)
	forwarded := make(chan os.Signal, 1)
	signal.Notify(forwarded, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for sig := range forwarded {
			_ = agent.Process.Signal(sig)
		}
	}()

	r.openLog()
	socketPath := r.listen()

	go r.pumpClient()
	// The agent's output is read to the end before waiting, or its last lines would be lost.
	r.pumpAgent(agentOut)
	_ = agent.Wait()

	if socketPath != "" {
		_ = os.Remove(socketPath)
	}
	r.closeLog()
	if code := agent.ProcessState.ExitCode(); code >= 0 {
		return code
	}
	return 1
}

func (r *Relay) fail(command string, err error) int {
	fmt.Fprintf(os.Stderr, "[agent-hub relay] could not start %s: %v\n", command, err)
	return 1
}

// readLines calls onLine for every newline-terminated line, of any length, then for an unterminated tail.
// It splits on the newline byte only: CR and U+2028 can sit unescaped inside a JSON string.
func readLines(reader io.Reader, onLine func([]byte)) {
	buffered := bufio.NewReaderSize(reader, 64*1024)
	for {
		line, err := buffered.ReadBytes('\n')
		if len(line) > 0 {
			onLine(line)
		}
		if err != nil {
			return
		}
	}
}

func (r *Relay) writeAgent(line []byte) {
	r.toAgent.Lock()
	defer r.toAgent.Unlock()
	_, _ = r.agentIn.Write(line)
}

func (r *Relay) writeClient(line []byte) {
	r.toClient.Lock()
	defer r.toClient.Unlock()
	_, _ = os.Stdout.Write(line)
}

func (r *Relay) pumpClient() {
	readLines(os.Stdin, func(line []byte) {
		if r.alreadyAnswered(line) {
			return
		}
		r.track(fromClient, line)
		r.writeAgent(line)
	})
	r.toAgent.Lock()
	_ = r.agentIn.Close()
	r.toAgent.Unlock()
}

func (r *Relay) pumpAgent(agentOut io.Reader) {
	idPrefix := []byte(r.idPrefix)
	readLines(agentOut, func(line []byte) {
		r.track(fromAgent, line)
		if !(bytes.Contains(line, idPrefix) && r.settle(line)) {
			r.writeClient(line)
		}
	})
}

// alreadyAnswered drops the client's reply to a request the hub has answered for it.
func (r *Relay) alreadyAnswered(line []byte) bool {
	r.mu.Lock()
	waiting := len(r.answered) > 0
	r.mu.Unlock()
	if !waiting {
		return false
	}
	message, ok := decode(line)
	if !ok || message.Method != "" || !message.hasID() {
		return false
	}
	id := string(message.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	found := r.answered[id]
	delete(r.answered, id)
	return found
}

// settle hands a reply to one of the relay's own requests back to its caller instead of the client.
func (r *Relay) settle(line []byte) bool {
	message, ok := decode(line)
	if !ok || message.Method != "" {
		return false
	}
	id := message.stringID()
	r.mu.Lock()
	reply, found := r.pending[id]
	delete(r.pending, id)
	r.mu.Unlock()
	if found {
		reply <- bytes.TrimRight(line, "\r\n")
	}
	return found
}

// track runs before a line is forwarded, so a quick reply is never recorded ahead of the request it answers. It records
// the line for subscribers and the log and must never block on either.
func (r *Relay) track(source from, line []byte) {
	r.queueLog(source, line)
	message, ok := decode(line)
	if !ok {
		return
	}
	raw := bytes.TrimRight(line, "\r\n")
	r.mu.Lock()
	defer r.mu.Unlock()
	// The relay's own updates to the client are echoes no subscriber reads back; out of the history, a picture sent from
	// the hub takes its room once, not twice.
	if source != fromRelay || message.Method != "session/update" {
		r.history.remember(source, raw, message)
	}
	event := lineEvent(source, raw)
	for watcher := range r.watchers {
		watcher.push(event, true)
	}
	if source == fromAgent && message.Method == "$/cancel_request" {
		delete(r.asked, string(bytes.TrimSpace(message.Params.RequestID)))
	}
	if !message.hasID() {
		return
	}
	id := string(message.ID)
	switch {
	case source == fromAgent && message.Method != "":
		r.asked[id] = true
	case source != fromAgent && message.Method == "":
		delete(r.asked, id)
	case source == fromClient && message.Method == "session/new":
		r.creating[id] = message.Params.Cwd
	case source == fromClient && (message.Method == "session/load" || message.Method == "session/resume") && message.Params.SessionID != "":
		r.remember(message.Params.SessionID, message.Params.Cwd)
	case source == fromAgent && message.Method == "":
		if capabilities := message.Result.AgentCapabilities; capabilities != nil {
			r.prompt = capabilities.PromptCapabilities
		}
		if cwd, found := r.creating[id]; found {
			delete(r.creating, id)
			if message.Result.SessionID != "" {
				r.remember(message.Result.SessionID, cwd)
			}
		}
	}
}

// remember keeps the order sessions first appeared in; "last" in ctl means the newest one.
func (r *Relay) remember(id, cwd string) {
	for i := range r.sessions {
		if r.sessions[i].id == id {
			r.sessions[i].cwd = cwd
			return
		}
	}
	r.sessions = append(r.sessions, session{id: id, cwd: cwd})
}

func lineEvent(source from, raw []byte) []byte {
	event := make([]byte, 0, len(raw)+48)
	event = append(event, `{"event":"line","from":"`...)
	event = append(event, source...)
	event = append(event, `","message":`...)
	event = append(event, raw...)
	return append(event, "}\n"...)
}

func (r *Relay) subscribe(conn *connection) *subscriber {
	watcher := newSubscriber(conn, func(s *subscriber) {
		r.mu.Lock()
		delete(r.watchers, s)
		r.mu.Unlock()
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	hello, _ := json.Marshal(map[string]any{
		"event":     "hello",
		"name":      r.name,
		"pid":       os.Getpid(),
		"cwd":       currentDir(),
		"startedAt": r.startedAt,
		"dropped":   r.history.dropped,
		// Its presence says the relay passes on attachments; a relay without it sends text alone.
		"prompt": r.prompt,
	})
	watcher.push(append(hello, '\n'), false)
	r.history.each(func(source from, raw []byte) {
		watcher.push(lineEvent(source, raw), false)
	})
	// What follows happens now, not in the replayed history.
	watcher.push([]byte(`{"event":"live"}`+"\n"), false)
	r.watchers[watcher] = struct{}{}
	return watcher
}

func currentDir() string {
	dir, _ := os.Getwd()
	return dir
}

func (r *Relay) openLog() {
	// The log holds whole conversations and the MCP configs Zed sends, so it is written only when asked for.
	if os.Getenv("AGENT_HUB_RELAY_LOG") != "1" {
		return
	}
	state := os.Getenv("XDG_STATE_HOME")
	if state == "" {
		home, _ := os.UserHomeDir()
		state = filepath.Join(home, ".local", "state")
	}
	dir := filepath.Join(state, "agent-hub", "relay")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "[agent-hub relay] log disabled: %v\n", err)
		return
	}
	file, err := os.OpenFile(filepath.Join(dir, r.slug+".jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[agent-hub relay] log disabled: %v\n", err)
		return
	}
	r.logLines = make(chan []byte, 4096)
	r.logClosed = make(chan struct{})
	go func() {
		defer close(r.logClosed)
		defer file.Close()
		writer := bufio.NewWriter(file)
		for line := range r.logLines {
			_, _ = writer.Write(line)
			if len(r.logLines) == 0 {
				_ = writer.Flush()
			}
		}
		_ = writer.Flush()
	}()
}

func (r *Relay) queueLog(source from, line []byte) {
	if r.logLines == nil {
		return
	}
	entry, _ := json.Marshal(struct {
		T    int64  `json:"t"`
		From from   `json:"from"`
		Line string `json:"line"`
	}{time.Now().UnixMilli(), source, string(bytes.TrimRight(line, "\n"))})
	r.logMu.RLock()
	defer r.logMu.RUnlock()
	if r.logDone {
		return
	}
	select {
	case r.logLines <- append(entry, '\n'):
	default: // a slow disk loses log lines, never chat traffic
	}
}

// closeLog runs after the agent exits, while the client side may still be sending.
func (r *Relay) closeLog() {
	if r.logLines == nil {
		return
	}
	r.logMu.Lock()
	r.logDone = true
	close(r.logLines)
	r.logMu.Unlock()
	<-r.logClosed
}
