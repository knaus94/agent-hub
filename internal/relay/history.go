package relay

import (
	"encoding/json"
	"net"
	"strings"
	"sync"
)

const (
	historyLimit = 16 << 20
	// Above the history limit, so the replay a new subscriber gets never counts as a stall.
	backlogLimit = 2 * historyLimit
)

// chunk is a run of streamed text for one message, kept as text so that appending stays cheap.
type chunk struct {
	kind      string
	sessionID string
	messageID *string
	text      strings.Builder
}

type record struct {
	source from
	raw    []byte
	chunk  *chunk
	size   int
}

// history is what a new subscriber needs to rebuild every session of the process. Streamed text chunks are merged,
// and the oldest records go once the total passes the limit; `dropped` tells subscribers that the start is missing.
type history struct {
	records []*record
	size    int
	dropped int
}

func textChunk(message *wire) (kind, text string, ok bool) {
	update := message.Params.Update
	if message.Method != "session/update" || (update.SessionUpdate != "agent_message_chunk" && update.SessionUpdate != "agent_thought_chunk") {
		return "", "", false
	}
	var content struct {
		Type string  `json:"type"`
		Text *string `json:"text"`
	}
	if json.Unmarshal(update.Content, &content) != nil || content.Type != "text" || content.Text == nil {
		return "", "", false
	}
	return update.SessionUpdate, *content.Text, true
}

func sameMessage(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (h *history) remember(source from, raw []byte, message *wire) {
	kind, text, isChunk := textChunk(message)
	if isChunk {
		if count := len(h.records); count > 0 {
			last := h.records[count-1].chunk
			if last != nil && h.records[count-1].source == source && last.kind == kind &&
				last.sessionID == message.Params.SessionID && sameMessage(last.messageID, message.Params.Update.MessageID) {
				last.text.WriteString(text)
				h.records[count-1].size += len(text)
				h.size += len(text)
				h.trim()
				return
			}
		}
		next := &chunk{kind: kind, sessionID: message.Params.SessionID, messageID: message.Params.Update.MessageID}
		next.text.WriteString(text)
		h.push(&record{source: source, chunk: next, size: len(raw)})
		return
	}
	h.push(&record{source: source, raw: append([]byte(nil), raw...), size: len(raw)})
}

func (h *history) push(entry *record) {
	h.records = append(h.records, entry)
	h.size += entry.size
	h.trim()
}

func (h *history) trim() {
	for h.size > historyLimit && len(h.records) > 1 {
		h.size -= h.records[0].size
		h.records[0] = nil
		h.records = h.records[1:]
		h.dropped++
	}
}

func (h *history) each(visit func(source from, raw []byte)) {
	for _, entry := range h.records {
		if entry.chunk != nil {
			visit(entry.source, entry.chunk.message())
		} else {
			visit(entry.source, entry.raw)
		}
	}
}

func (c *chunk) message() []byte {
	type content struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type update struct {
		SessionUpdate string  `json:"sessionUpdate"`
		Content       content `json:"content"`
		MessageID     *string `json:"messageId,omitempty"`
	}
	raw, _ := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		Method  string `json:"method"`
		Params  struct {
			SessionID string `json:"sessionId"`
			Update    update `json:"update"`
		} `json:"params"`
	}{
		JSONRPC: "2.0",
		Method:  "session/update",
		Params: struct {
			SessionID string `json:"sessionId"`
			Update    update `json:"update"`
		}{c.sessionID, update{c.kind, content{"text", c.text.String()}, c.messageID}},
	})
	return raw
}

// connection serialises writes to one control socket: command replies and subscription events share it.
type connection struct {
	conn net.Conn
	mu   sync.Mutex
}

func (c *connection) write(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := c.conn.Write(data)
	return err
}

// subscriber queues events for one socket and writes them from its own goroutine, so a slow reader never holds up
// the agent's traffic. One that falls too far behind is dropped; it can subscribe again.
type subscriber struct {
	out    *connection
	gone   func(*subscriber)
	mu     sync.Mutex
	queue  [][]byte
	queued int
	closed bool
	wake   chan struct{}
}

func newSubscriber(out *connection, gone func(*subscriber)) *subscriber {
	s := &subscriber{out: out, gone: gone, wake: make(chan struct{}, 1)}
	go s.run()
	return s
}

func (s *subscriber) push(event []byte, limited bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if limited && s.queued > backlogLimit {
		s.closeLocked()
		return
	}
	s.queue = append(s.queue, event)
	s.queued += len(event)
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *subscriber) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closeLocked()
	}
}

func (s *subscriber) closeLocked() {
	s.closed = true
	_ = s.out.conn.Close()
	close(s.wake)
}

func (s *subscriber) run() {
	defer s.gone(s)
	for range s.wake {
		s.mu.Lock()
		batch := s.queue
		s.queue = nil
		s.mu.Unlock()
		written := 0
		for _, event := range batch {
			if s.out.write(event) != nil {
				s.mu.Lock()
				if !s.closed {
					s.closeLocked()
				}
				s.mu.Unlock()
				return
			}
			written += len(event)
		}
		s.mu.Lock()
		s.queued -= written
		s.mu.Unlock()
	}
}
