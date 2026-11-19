package hub

import "time"

// A ticket lets a browser make one upload over HTTP, soon after it asked for it over its socket: a recording to
// recognise or a message with attachments. The upload's results come back on that socket.
const ticketTTL = time.Minute

type ticket struct {
	client  *client
	expires time.Time
}

type ticketMessage struct {
	Type   string `json:"type"`
	Ticket string `json:"ticket,omitempty"`
	Error  string `json:"error,omitempty"`
}

// ticketFor gives a browser a ticket for one upload. The caller holds s.mu.
func (s *Server) ticketFor(c *client) {
	now := time.Now()
	for value, held := range s.tickets {
		if now.After(held.expires) {
			delete(s.tickets, value)
		}
	}
	value, err := randomToken()
	if err != nil {
		c.enqueue(encode(ticketMessage{Type: "ticket", Error: err.Error()}))
		return
	}
	s.tickets[value] = ticket{c, now.Add(ticketTTL)}
	c.enqueue(encode(ticketMessage{Type: "ticket", Ticket: value}))
}

// spendTicket is the browser a ticket was given to, once; nil for a ticket unknown or expired.
func (s *Server) spendTicket(value string) *client {
	s.mu.Lock()
	held, found := s.tickets[value]
	delete(s.tickets, value)
	s.mu.Unlock()
	if !found || time.Now().After(held.expires) {
		return nil
	}
	return held.client
}
