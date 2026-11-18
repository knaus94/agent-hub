package hub

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const scanInterval = 1500 * time.Millisecond

// liveFallback is how long a relay that does not say when its history ends gets to replay it.
const liveFallback = 10 * time.Second

type relayEvent struct {
	Event   string          `json:"event"`
	Name    string          `json:"name"`
	Dropped int             `json:"dropped"`
	From    string          `json:"from"`
	Message json.RawMessage `json:"message"`
}

// RelayCommand is what the hub asks a relay to do in one of its sessions.
type RelayCommand struct {
	Op             string          `json:"op"`
	SessionID      string          `json:"sessionId"`
	Text           string          `json:"text,omitempty"`
	Echo           bool            `json:"echo,omitempty"`
	PromptRequired bool            `json:"promptRequired,omitempty"`
	ID             json.RawMessage `json:"id,omitempty"`
	Result         json.RawMessage `json:"result,omitempty"`
	ConfigID       string          `json:"configId,omitempty"`
	Value          json.RawMessage `json:"value,omitempty"`
}

// RelayReply carries the agent's reply message, or the relay's own error.
type RelayReply struct {
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

// relays finds relay sockets, follows each relay's traffic into the timeline, and sends relays commands.
type relays struct {
	dir   string
	apply func(func(*Timeline))
	mu    sync.Mutex
	links map[string]bool
}

func (r *relays) start() {
	go func() {
		for {
			r.scan()
			time.Sleep(scanInterval)
		}
	}()
}

func (r *relays) scan() {
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".sock") {
			continue
		}
		sourceID := strings.TrimSuffix(name, ".sock")
		r.mu.Lock()
		linked := r.links[sourceID]
		r.links[sourceID] = true
		r.mu.Unlock()
		if !linked {
			go r.follow(sourceID)
		}
	}
}

// follow subscribes to one relay until its socket closes. A refused connection is a socket left by a relay that died;
// the next scan tries again.
func (r *relays) follow(sourceID string) {
	defer func() {
		r.mu.Lock()
		delete(r.links, sourceID)
		r.mu.Unlock()
	}()
	conn, err := net.Dial("unix", filepath.Join(r.dir, sourceID+".sock"))
	if err != nil {
		return
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(`{"op":"subscribe"}` + "\n")); err != nil {
		return
	}
	attached := false
	reader := bufio.NewReaderSize(conn, 64*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			break
		}
		var event relayEvent
		if json.Unmarshal(line, &event) != nil {
			continue
		}
		switch event.Event {
		case "hello":
			attached = true
			r.apply(func(t *Timeline) { t.Attach(sourceID, event.Name, event.Dropped) })
			// A relay older than the "live" event replays its history without saying when it is done.
			time.AfterFunc(liveFallback, func() { r.apply(func(t *Timeline) { t.Live(sourceID) }) })
		case "line":
			r.apply(func(t *Timeline) { t.Apply(sourceID, event.From, event.Message) })
		case "live":
			r.apply(func(t *Timeline) { t.Live(sourceID) })
		}
	}
	if attached {
		r.apply(func(t *Timeline) { t.Detach(sourceID) })
	}
}

// command sends one command and waits for its reply; a prompt's reply comes only when the turn ends.
func (r *relays) command(sourceID string, command RelayCommand) (RelayReply, error) {
	var reply RelayReply
	conn, err := net.Dial("unix", filepath.Join(r.dir, sourceID+".sock"))
	if err != nil {
		return reply, err
	}
	defer conn.Close()
	line, _ := json.Marshal(command)
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return reply, err
	}
	answer, err := bufio.NewReaderSize(conn, 64*1024).ReadBytes('\n')
	if err != nil {
		return reply, err
	}
	err = json.Unmarshal(answer, &reply)
	return reply, err
}
