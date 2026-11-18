package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
)

type command struct {
	Op             string          `json:"op"`
	SessionID      string          `json:"sessionId"`
	Text           string          `json:"text"`
	Echo           bool            `json:"echo"`
	PromptRequired bool            `json:"promptRequired"`
	ID             json.RawMessage `json:"id"`
	Result         json.RawMessage `json:"result"`
	ConfigID       string          `json:"configId"`
	Value          json.RawMessage `json:"value"`
}

type textBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// listen opens the control socket and returns its path, or "" when it could not; the relay keeps relaying without it.
func (r *Relay) listen() string {
	dir, err := SocketDir()
	if err == nil {
		err = os.MkdirAll(dir, 0o700)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "[agent-hub relay] control socket off: %v\n", err)
		return ""
	}
	path := filepath.Join(dir, r.slug+".sock")
	_ = os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[agent-hub relay] control socket off: %v\n", err)
		return ""
	}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go r.serve(&connection{conn: conn})
		}
	}()
	return path
}

func (r *Relay) serve(conn *connection) {
	var watcher *subscriber
	readLines(conn.conn, func(line []byte) {
		var request command
		if json.Unmarshal(line, &request) != nil {
			_ = conn.write([]byte(`{"error":"invalid JSON"}` + "\n"))
			return
		}
		if request.Op == "subscribe" {
			if watcher == nil {
				watcher = r.subscribe(conn)
			}
			return
		}
		go func() {
			reply, err := r.run(request)
			if err != nil {
				message, _ := json.Marshal(map[string]string{"error": err.Error()})
				_ = conn.write(append(message, '\n'))
				return
			}
			_ = conn.write(append(append(append([]byte(`{"result":`), reply...), '}'), '\n'))
		}()
	})
	if watcher != nil {
		watcher.stop()
	}
	_ = conn.conn.Close()
}

func (r *Relay) run(request command) (json.RawMessage, error) {
	if request.Op == "sessions" {
		type listed struct {
			SessionID string `json:"sessionId"`
			Cwd       string `json:"cwd,omitempty"`
		}
		r.mu.Lock()
		sessions := make([]listed, len(r.sessions))
		for i, s := range r.sessions {
			sessions[i] = listed{s.id, s.cwd}
		}
		r.mu.Unlock()
		return json.Marshal(sessions)
	}
	if request.SessionID == "" {
		return nil, errors.New("sessionId is required")
	}
	if request.Op == "answer" {
		return r.answer(request.ID, request.Result)
	}
	if request.Op == "configure" {
		return r.configure(request.SessionID, request.ConfigID, request.Value), nil
	}
	if request.Op == "cancel" {
		r.toAgentMessage(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": request.SessionID}})
		return json.RawMessage(`{"sent":true}`), nil
	}
	if request.Text == "" {
		return nil, errors.New("text is required")
	}
	prompt := []textBlock{{"text", request.Text}}
	switch request.Op {
	case "prompt":
		if request.Echo {
			r.echoUserMessage(request.SessionID, request.Text)
		}
		return r.requestAgent("session/prompt", map[string]any{"sessionId": request.SessionID, "prompt": prompt}), nil
	case "steer":
		params := map[string]any{"sessionId": request.SessionID, "prompt": prompt}
		if request.PromptRequired {
			params["_meta"] = map[string]any{"steering": map[string]string{"idleBehavior": "promptRequired"}}
		}
		reply := r.requestAgent("_session/steering", params)
		var outcome struct {
			Result struct {
				Outcome string `json:"outcome"`
			} `json:"result"`
		}
		_ = json.Unmarshal(reply, &outcome)
		if request.Echo && (outcome.Result.Outcome == "injected" || outcome.Result.Outcome == "startedNewTurn") {
			r.echoUserMessage(request.SessionID, request.Text)
		}
		return reply, nil
	}
	return nil, fmt.Errorf("unknown op: %s", request.Op)
}

func (r *Relay) toAgentMessage(message any) {
	line, _ := json.Marshal(message)
	line = append(line, '\n')
	r.track(fromRelay, line)
	r.writeAgent(line)
}

// answer replies to one of the agent's requests in the client's place, once: whoever answers first wins.
func (r *Relay) answer(id, result json.RawMessage) (json.RawMessage, error) {
	if !json.Valid(id) || !json.Valid(result) {
		return nil, errors.New("id and result are required")
	}
	key := string(bytes.TrimSpace(id))
	r.mu.Lock()
	waiting := r.asked[key]
	if waiting {
		delete(r.asked, key)
		r.answered[key] = true
	}
	r.mu.Unlock()
	if !waiting {
		return nil, errors.New("the question is no longer waiting")
	}
	r.toAgentMessage(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	return json.RawMessage(`{"sent":true}`), nil
}

// requestAgent sends a request under the relay's own id and waits for the agent's reply, which never reaches the client.
func (r *Relay) requestAgent(method string, params any) json.RawMessage {
	reply := make(chan []byte, 1)
	r.mu.Lock()
	r.sequence++
	id := fmt.Sprintf("%s%d", r.idPrefix, r.sequence)
	r.pending[id] = reply
	r.mu.Unlock()
	r.toAgentMessage(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	return <-reply
}

// configure changes a session setting, and shows the client the settings the agent answered with, since the client
// never sees the reply to a request it did not send.
func (r *Relay) configure(sessionID, configID string, value json.RawMessage) json.RawMessage {
	reply := r.requestAgent("session/set_config_option", map[string]any{"sessionId": sessionID, "configId": configID, "value": value})
	var answer struct {
		Result struct {
			ConfigOptions json.RawMessage `json:"configOptions"`
		} `json:"result"`
	}
	if json.Unmarshal(reply, &answer) == nil && len(answer.Result.ConfigOptions) > 0 {
		r.updateClient(sessionID, map[string]any{"sessionUpdate": "config_option_update", "configOptions": answer.Result.ConfigOptions})
	}
	return reply
}

// echoUserMessage shows the client a prompt it did not send, so its thread has the user's message.
func (r *Relay) echoUserMessage(sessionID, text string) {
	r.updateClient(sessionID, map[string]any{"sessionUpdate": "user_message_chunk", "content": textBlock{"text", text}})
}

func (r *Relay) updateClient(sessionID string, update any) {
	line, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "session/update",
		"params":  map[string]any{"sessionId": sessionID, "update": update},
	})
	line = append(line, '\n')
	r.track(fromRelay, line)
	r.writeClient(line)
}
