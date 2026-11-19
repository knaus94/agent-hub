package hub

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/knaus94/agent-hub/internal/protocol"
	"github.com/knaus94/agent-hub/internal/relay"
)

// owned is an agent process the hub started for a chat begun in the web app. It runs through a relay like Zed's entries,
// so its chats reach the timeline the same way; the hub is its ACP client over stdio.
type owned struct {
	sourceID string
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	// sessions counts the chats prepared in this process, guarded by Server.ownedMu.
	sessions int
	writes   sync.Mutex
	mu       sync.Mutex
	sequence int
	pending  map[int]chan rpcReply
	done     chan struct{}
	// attach is what its chats take besides text: its relay is this binary's, so it passes attachments on.
	attach protocol.Attach
}

type rpcReply struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

var errAgentExited = errors.New("agent exited")

// ownedFor reuses the process already running this agent in this directory, as Zed runs one per project.
func (s *Server) ownedFor(agent agentEntry, cwd string) (*owned, error) {
	key := agent.name + "\x00" + cwd
	s.ownedMu.Lock()
	defer s.ownedMu.Unlock()
	if process := s.processes[key]; process != nil {
		select {
		case <-process.done:
		default:
			return process, nil
		}
	}
	process, err := s.spawn(agent, cwd)
	if err != nil {
		return nil, err
	}
	s.processes[key] = process
	return process, nil
}

func (s *Server) spawn(agent agentEntry, cwd string) (*owned, error) {
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(self, append([]string{"relay", agent.name, agent.command}, agent.args...)...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	for name, value := range agent.env {
		cmd.Env = append(cmd.Env, name+"="+value)
	}
	// The agent goes away with the hub instead of running on unattended.
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	process := &owned{sourceID: relay.Slug(agent.name, cmd.Process.Pid), cmd: cmd, stdin: stdin, pending: map[int]chan rpcReply{}, done: make(chan struct{})}
	s.withTimeline(func(t *Timeline) { t.MarkOwned(process.sourceID) })
	go func() {
		process.read(stdout)
		_ = cmd.Wait()
		close(process.done)
	}()
	initialized, err := process.request("initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"_meta":       map[string]any{"terminal_output": true},
			"elicitation": map[string]any{"form": map[string]any{}},
			// As Zed does: switches such as fast mode then come as true or false, not as an on/off choice.
			"session": map[string]any{"configOptions": map[string]any{"boolean": map[string]any{}}},
		},
	})
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}
	var answer struct {
		AgentCapabilities struct {
			PromptCapabilities promptCapabilities `json:"promptCapabilities"`
		} `json:"agentCapabilities"`
	}
	_ = json.Unmarshal(initialized, &answer)
	prompt := answer.AgentCapabilities.PromptCapabilities
	process.attach = protocol.Attach{Links: true, Images: prompt.Image, Files: prompt.EmbeddedContext}
	// The relay's socket exists by now; following it at once makes the new chat appear without waiting for a scan.
	s.relays.scan()
	return process, nil
}

// stop ends the agent: its input closes, and a relay that does not exit soon after is told to.
func (p *owned) stop() {
	p.writes.Lock()
	_ = p.stdin.Close()
	p.writes.Unlock()
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
		_ = p.cmd.Process.Signal(syscall.SIGTERM)
	}
}

func (p *owned) send(message any) error {
	line, err := json.Marshal(message)
	if err != nil {
		return err
	}
	p.writes.Lock()
	defer p.writes.Unlock()
	_, err = p.stdin.Write(append(line, '\n'))
	return err
}

// request waits for the agent's reply; a prompt's reply comes only when its turn ends.
func (p *owned) request(method string, params any) (json.RawMessage, error) {
	reply := make(chan rpcReply, 1)
	p.mu.Lock()
	p.sequence++
	id := p.sequence
	p.pending[id] = reply
	p.mu.Unlock()
	if err := p.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	select {
	case answer := <-reply:
		if answer.Error != nil {
			return nil, fmt.Errorf("%s: %s", method, answer.Error.Message)
		}
		return answer.Result, nil
	case <-p.done:
		return nil, errAgentExited
	}
}

func (p *owned) read(stdout io.Reader) {
	reader := bufio.NewReaderSize(stdout, 64*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			p.handle(line)
		}
		if err != nil {
			return
		}
	}
}

func (p *owned) handle(line []byte) {
	var message struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		rpcReply
	}
	if json.Unmarshal(line, &message) != nil || !present(message.ID) {
		return
	}
	if message.Method == "" {
		var id int
		if json.Unmarshal(message.ID, &id) != nil {
			return
		}
		p.mu.Lock()
		reply := p.pending[id]
		delete(p.pending, id)
		p.mu.Unlock()
		if reply != nil {
			reply <- message.rpcReply
		}
		return
	}
	if message.Method == "session/request_permission" || message.Method == "elicitation/create" {
		var params struct {
			SessionID string `json:"sessionId"`
		}
		// A chat's question waits in the web app, which answers it through the relay; one outside a chat has no
		// place there and is refused like any other request.
		if json.Unmarshal(message.Params, &params) == nil && params.SessionID != "" {
			return
		}
	}
	// The hub offers no file system or terminal of its own; agents run those tools themselves.
	_ = p.send(map[string]any{"jsonrpc": "2.0", "id": message.ID, "error": map[string]any{"code": -32601, "message": "not supported by agent-hub"}})
}
