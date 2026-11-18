// Package hub serves the web app and streams every relayed chat to it over a WebSocket.
package hub

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"net"
	"net/http"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/knaus94/agent-hub/internal/protocol"
)

const (
	flushInterval = 80 * time.Millisecond
	authTimeout   = 10 * time.Second
	writeTimeout  = 10 * time.Second
	pingInterval  = 30 * time.Second
	sendQueue     = 256
)

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".webp":        "image/webp",
	".woff2":       "font/woff2",
	".json":        "application/json",
	".webmanifest": "application/manifest+json",
}

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	cancel context.CancelFunc
	once   sync.Once
	// local is a browser on this computer: a loopback name that did not come through Cloudflare.
	local bool
	label string
	// address is where the browser connects from, as Cloudflare reports it; wrong codes are counted by it.
	address string
	// guarded by Server.mu
	authed bool
	open   string
	// device is the token this browser logged in with after a code, which logging out revokes.
	device string
	// draft is the chat prepared for this browser's new-chat screen.
	draft string
	// visible is whether the page is on screen, as it reports; a chat open there is not notified of.
	visible bool
}

// pushDevice is what the browser's push subscriptions are bound to: its device, or this computer's own token.
func (c *client) pushDevice() string {
	if c.device == "" {
		return "config"
	}
	return hashToken(c.device)
}

func (c *client) close() {
	c.once.Do(c.cancel)
}

// enqueue never blocks: a browser that cannot keep up is dropped and gets everything again when it reconnects.
func (c *client) enqueue(data []byte) {
	select {
	case c.send <- data:
	default:
		c.close()
	}
}

type Server struct {
	config Config
	assets fs.FS
	relays *relays
	logins *logins
	// mu owns the timeline and the clients' state.
	mu       sync.Mutex
	timeline *Timeline
	clients  map[*client]struct{}
	// processes are the agent processes started for chats begun in the web app, by agent and directory.
	ownedMu   sync.Mutex
	processes map[string]*owned
	drafts    map[string]*draft
	// ownedSessions are the chats those processes hold, by session.
	ownedSessions map[string]*owned
	zed           zedThreads
	archiveMu     sync.Mutex
	// quick are the user's quick actions, guarded by mu.
	quick   []protocol.QuickAction
	quickMu sync.Mutex
	// voiceTickets let browsers upload a recording each, guarded by mu; voiceMu lets one be recognised at a time.
	voiceTickets map[string]voiceTicket
	voiceMu      sync.Mutex
	// push is nil when its state could not be read; notifications are then off.
	push *pushes
}

func NewServer(config Config, assets fs.FS) *Server {
	s := &Server{config: config, assets: assets, logins: &logins{dir: config.Home}, timeline: NewTimeline(), clients: map[*client]struct{}{}, processes: map[string]*owned{}, drafts: map[string]*draft{}, ownedSessions: map[string]*owned{}, zed: newZedThreads(), voiceTickets: map[string]voiceTicket{}}
	s.relays = &relays{dir: config.RelayDir, links: map[string]bool{}, apply: s.withTimeline}
	return s
}

func (s *Server) withTimeline(change func(*Timeline)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	change(s.timeline)
}

func (s *Server) Run() error {
	s.loadArchive()
	s.loadQuick()
	var err error
	if s.push, err = loadPushes(s.config.Home); err != nil {
		fmt.Fprintf(os.Stderr, "agent-hub: %s: %v; notifications are off\n", pushFile, err)
	}
	go s.followZedArchive()
	s.relays.start()
	go func() {
		for range time.Tick(flushInterval) {
			s.flush()
		}
	}()
	address := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)
	login := ""
	// Under systemd stdout goes to the journal, which should not keep the token.
	if info, err := os.Stdout.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		login = "/#token=" + s.config.Token
	}
	fmt.Printf("agent-hub on http://%s%s\n", address, login)
	return http.ListenAndServe(address, s)
}

// allowed keeps a page on another site, or a DNS-rebinding name, away from agents that run with full access.
func (s *Server) allowed(r *http.Request) bool {
	if !slices.ContainsFunc(s.config.AllowedHosts, func(pattern string) bool { return hostMatches(pattern, r.Host) }) {
		return false
	}
	origin := r.Header.Get("Origin")
	return origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host || slices.Contains(s.config.AllowedOrigins, origin)
}

// remoteAddress is the browser's address: Cloudflare puts it in Cf-Connecting-Ip, replacing any the browser sent;
// a browser on this computer has only the connection's.
func remoteAddress(r *http.Request) string {
	if address := r.Header.Get("Cf-Connecting-Ip"); address != "" {
		return address
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// isLocal tells this computer's browser from one behind the tunnel, which also connects from loopback: Cloudflare
// sends the public name and adds Cf-Connecting-Ip to every request it forwards.
func isLocal(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	return (host == "127.0.0.1" || host == "localhost" || host == "::1") && r.Header.Get("Cf-Connecting-Ip") == ""
}

// hostMatches allows "*.example.com" for a tunnel whose name changes on every start; the origin must still equal it.
func hostMatches(pattern, host string) bool {
	if suffix, wildcard := strings.CutPrefix(pattern, "*"); wildcard && strings.HasPrefix(suffix, ".") {
		return strings.HasSuffix(host, suffix) && len(host) > len(suffix)
	}
	return pattern == host
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/ws" {
		s.serveSocket(w, r)
		return
	}
	if r.URL.Path == "/voice" {
		s.serveVoice(w, r)
		return
	}
	s.serveStatic(w, r)
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	data, err := fs.ReadFile(s.assets, name)
	if name == "" || err != nil {
		name = "index.html"
		if data, err = fs.ReadFile(s.assets, name); err != nil {
			http.NotFound(w, r)
			return
		}
	}
	header := w.Header()
	contentType, known := contentTypes[path.Ext(name)]
	if !known {
		contentType = "application/octet-stream"
	}
	header.Set("Content-Type", contentType)
	if strings.HasPrefix(name, "assets/") {
		header.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		header.Set("Cache-Control", "no-cache")
	}
	header.Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "no-referrer")
	_, _ = w.Write(data)
}

func (s *Server) serveSocket(w http.ResponseWriter, r *http.Request) {
	// allowed() has checked the origin already.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	c := &client{conn: conn, send: make(chan []byte, sendQueue), cancel: cancel, local: isLocal(r), label: r.UserAgent(), address: remoteAddress(r)}
	s.mu.Lock()
	s.clients[c] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, c)
		s.mu.Unlock()
		c.close()
		_ = conn.CloseNow()
	}()

	go func() {
		// Proxies such as Cloudflare close a WebSocket that stays silent; a quiet chat list would otherwise reconnect.
		ping := time.NewTicker(pingInterval)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ping.C:
				pingCtx, done := context.WithTimeout(ctx, writeTimeout)
				err := conn.Ping(pingCtx)
				done()
				if err != nil {
					c.close()
					return
				}
			case data := <-c.send:
				writeCtx, done := context.WithTimeout(ctx, writeTimeout)
				err := conn.Write(writeCtx, websocket.MessageText, data)
				done()
				if err != nil {
					c.close()
					return
				}
			}
		}
	}()
	timer := time.AfterFunc(authTimeout, func() {
		s.mu.Lock()
		authed := c.authed
		s.mu.Unlock()
		if !authed {
			c.close()
		}
	})
	defer timer.Stop()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		request, ok := parseClientMessage(data)
		s.mu.Lock()
		authed := c.authed
		s.mu.Unlock()
		if !ok {
			if !authed {
				return
			}
			continue
		}
		if !s.handle(c, request) {
			return
		}
	}
}

type clientMessage struct {
	Type      string                  `json:"type"`
	Token     *string                 `json:"token"`
	Code      *string                 `json:"code"`
	SessionID *string                 `json:"sessionId"`
	Text      *string                 `json:"text"`
	AgentID   *string                 `json:"agentId"`
	Cwd       *string                 `json:"cwd"`
	EntryID   *string                 `json:"entryId"`
	Response  json.RawMessage         `json:"response"`
	ConfigID  *string                 `json:"configId"`
	Value     json.RawMessage         `json:"value"`
	From      *int                    `json:"from"`
	Archived  *bool                   `json:"archived"`
	Actions   *[]protocol.QuickAction `json:"actions"`
	Visible   *bool                   `json:"visible"`
	Endpoint  *string                 `json:"endpoint"`
	// Subscription is the browser's PushSubscription as JSON.
	Subscription *struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	} `json:"subscription"`
	Before *int `json:"before"`
}

// parseClientMessage accepts only the messages the web app sends: anyone who reaches the socket can send anything.
func parseClientMessage(data []byte) (clientMessage, bool) {
	var m clientMessage
	var shape map[string]json.RawMessage
	if json.Unmarshal(data, &shape) != nil || shape == nil || json.Unmarshal(data, &m) != nil {
		return m, false
	}
	switch m.Type {
	case "auth":
		return m, m.Token != nil || m.Code != nil
	case "logout":
		return m, true
	case "open":
		return m, string(shape["sessionId"]) == "null" || m.SessionID != nil
	case "send":
		return m, m.SessionID != nil && m.Text != nil
	case "cancel":
		return m, m.SessionID != nil
	case "older":
		return m, m.SessionID != nil && m.Before != nil
	case "archive":
		return m, m.SessionID != nil && m.Archived != nil
	case "quick":
		return m, m.Actions != nil
	case "voice":
		return m, true
	case "visible":
		return m, m.Visible != nil
	case "push-subscribe":
		return m, m.Subscription != nil
	case "push-unsubscribe":
		return m, m.Endpoint != nil
	case "prepare":
		return m, m.AgentID != nil && m.Cwd != nil
	case "answer":
		return m, m.SessionID != nil && m.EntryID != nil && present(m.Response)
	case "configure":
		return m, m.SessionID != nil && m.ConfigID != nil && present(m.Value)
	}
	return m, false
}

func encode(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}

type deniedMessage struct {
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

type sessionMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type sessionsMessage struct {
	Type     string                    `json:"type"`
	Sessions []protocol.SessionSummary `json:"sessions"`
}

// timelineMessage carries the entries from index Start on; "older" carries the page that ends where they begin.
type timelineMessage struct {
	Type      string           `json:"type"`
	SessionID string           `json:"sessionId"`
	Start     int              `json:"start"`
	Entries   []protocol.Entry `json:"entries"`
}

type patchMessage struct {
	Type      string            `json:"type"`
	SessionID string            `json:"sessionId"`
	Changes   []protocol.Change `json:"changes"`
}

type failedMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

type readyMessage struct {
	Type     string                    `json:"type"`
	Sessions []protocol.SessionSummary `json:"sessions"`
	Agents   []protocol.AgentOption    `json:"agents"`
	Projects []protocol.ProjectOption  `json:"projects"`
	Quick    []protocol.QuickAction    `json:"quick"`
	// Voice is whether the web app may offer voice input.
	Voice bool `json:"voice"`
	// Push is the key to subscribe to notifications with, empty while the hub has no address of its own: a
	// subscription made at an address that changes on every start would die with it.
	Push string `json:"push"`
}

type commandsMessage struct {
	Type      string             `json:"type"`
	SessionID string             `json:"sessionId"`
	Commands  []protocol.Command `json:"commands"`
}

type optionsMessage struct {
	Type      string                  `json:"type"`
	SessionID string                  `json:"sessionId"`
	Options   []protocol.ConfigOption `json:"options"`
}

// handle reports whether the connection stays open.
func (s *Server) handle(c *client, m clientMessage) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !c.authed {
		if reason := s.login(c, m); reason != "" {
			c.enqueue(encode(deniedMessage{"denied", reason}))
			time.AfterFunc(time.Second, c.close)
			return true
		}
		c.authed = true
		agents, _ := loadAgents()
		c.enqueue(encode(readyMessage{"ready", s.timeline.Summaries(), describeAgents(agents), projects(s.config.ProjectRoots), s.quick, s.config.Voice != nil, s.pushKey()}))
		return true
	}
	switch m.Type {
	case "logout":
		if c.device != "" {
			if err := s.logins.revoke(c.device, time.Now()); err != nil {
				fmt.Fprintf(os.Stderr, "agent-hub: logout: %v\n", err)
			}
			if s.push != nil {
				device := c.pushDevice()
				s.push.forget(func(p pushSubscription) bool { return p.Device == device })
			}
		}
		return false
	case "open":
		c.open = ""
		if m.SessionID != nil {
			c.open, c.draft = *m.SessionID, ""
			// A browser that reconnects keeps the older entries it has loaded.
			from := math.MaxInt
			if m.From != nil {
				from = *m.From
			}
			if start, entries := s.timeline.Tail(c.open, from); entries != nil {
				c.enqueue(encode(timelineMessage{"timeline", c.open, start, entries}))
			}
			if commands := s.timeline.Commands(c.open); commands != nil {
				c.enqueue(encode(commandsMessage{"commands", c.open, commands}))
			}
			if options := s.timeline.Options(c.open); options != nil {
				c.enqueue(encode(optionsMessage{"options", c.open, options}))
			}
		}
	case "send":
		if strings.TrimSpace(*m.Text) != "" {
			if target := s.timeline.Find(*m.SessionID); target == nil || !target.Online {
				c.enqueue(encode(failedMessage{"failed", *m.SessionID, "offline"}))
			} else {
				go s.useDraft(*m.SessionID, *m.Text)
				go s.deliver(c, *target, *m.SessionID, *m.Text)
			}
		}
	case "archive":
		s.archive(*m.SessionID, *m.Archived)
	case "quick":
		s.setQuick(c, *m.Actions)
	case "voice":
		s.voiceTicketFor(c)
	case "visible":
		c.visible = *m.Visible
	case "push-subscribe":
		if s.pushKey() != "" {
			subscription := pushSubscription{m.Subscription.Endpoint, m.Subscription.Keys.P256dh, m.Subscription.Keys.Auth, c.pushDevice()}
			if err := s.push.subscribe(subscription); err != nil {
				fmt.Fprintf(os.Stderr, "agent-hub: push subscription refused: %v\n", err)
			}
		}
	case "push-unsubscribe":
		if s.push != nil {
			device := c.pushDevice()
			s.push.forget(func(p pushSubscription) bool { return p.Endpoint == *m.Endpoint && p.Device == device })
		}
	case "older":
		if start, entries := s.timeline.Older(*m.SessionID, *m.Before); entries != nil {
			c.enqueue(encode(timelineMessage{"older", *m.SessionID, start, entries}))
		}
	case "cancel":
		if target := s.timeline.Find(*m.SessionID); target != nil && target.Online {
			go func() { _, _ = s.relays.command(target.SourceID, RelayCommand{Op: "cancel", SessionID: *m.SessionID}) }()
		}
	case "prepare":
		go s.prepare(c, *m.AgentID, *m.Cwd)
	case "configure":
		s.configure(c, *m.SessionID, *m.ConfigID, m.Value)
	case "answer":
		s.answer(c, *m.SessionID, *m.EntryID, m.Response)
	}
	return true
}

// configure changes a setting of a chat through its relay, which also shows the change in Zed.
func (s *Server) configure(c *client, sessionID, configID string, value json.RawMessage) {
	fail := func(err error) {
		fmt.Fprintf(os.Stderr, "agent-hub: configure %s: %v\n", configID, err)
		c.enqueue(encode(failedMessage{"failed", sessionID, "configure-failed"}))
	}
	target := s.timeline.Find(sessionID)
	if target == nil || !target.Online {
		c.enqueue(encode(failedMessage{"failed", sessionID, "offline"}))
		return
	}
	if err := offered(s.timeline.Options(sessionID), configID, value); err != nil {
		fail(err)
		return
	}
	go func() {
		reply, err := s.relays.command(target.SourceID, RelayCommand{Op: "configure", SessionID: sessionID, ConfigID: configID, Value: value})
		var answer rpcReply
		if err == nil && reply.Error != "" {
			err = errors.New(reply.Error)
		} else if err == nil && json.Unmarshal(reply.Result, &answer) == nil && answer.Error != nil {
			err = errors.New(answer.Error.Message)
		}
		if err != nil {
			fail(err)
		}
	}()
}

// answer replies to an agent's question through its relay; Zed's own reply, if it comes later, is dropped there.
func (s *Server) answer(c *client, sessionID, entryID string, response json.RawMessage) {
	fail := func(err error) {
		fmt.Fprintf(os.Stderr, "agent-hub: answer %s: %v\n", entryID, err)
		c.enqueue(encode(failedMessage{"failed", sessionID, "answer-failed"}))
	}
	question, err := s.timeline.FindQuestion(sessionID, entryID)
	if err != nil {
		fail(err)
		return
	}
	result, err := answerResult(question.Question, response)
	if err != nil {
		fail(err)
		return
	}
	go func() {
		reply, err := s.relays.command(question.SourceID, RelayCommand{Op: "answer", SessionID: sessionID, ID: question.RequestID, Result: result})
		if err == nil && reply.Error != "" {
			err = errors.New(reply.Error)
		}
		if err != nil {
			fail(err)
		}
	}()
}

// login returns why a browser may not in, or "" when it may. A code enrols the browser as a device. The token in
// config.json works only from this computer: from anywhere else the authenticator code is the way in.
func (s *Server) login(c *client, m clientMessage) string {
	if m.Type != "auth" {
		return "token"
	}
	now := time.Now()
	if m.Code != nil {
		token, err := s.logins.enrol(*m.Code, c.label, c.address, now)
		switch {
		case errors.Is(err, errCodeLocked):
			return "locked"
		case errors.Is(err, errWrongCode), errors.Is(err, errNoOTP):
			return "code"
		case err != nil:
			fmt.Fprintf(os.Stderr, "agent-hub: login: %v\n", err)
			return "code"
		}
		c.device = token
		c.enqueue(encode(sessionMessage{"session", token}))
		return ""
	}
	if s.logins.device(*m.Token, now) {
		c.device = *m.Token
		return ""
	}
	if subtle.ConstantTimeCompare([]byte(*m.Token), []byte(s.config.Token)) == 1 && c.local {
		return ""
	}
	return "token"
}

// deliver steers a running turn, or starts a turn when there is none.
func (s *Server) deliver(c *client, target Target, sessionID, text string) {
	fail := func(reason string) { c.enqueue(encode(failedMessage{"failed", sessionID, reason})) }
	// A slash command cannot join a running turn, so it waits for the turn to end, as Zed queues a message sent meanwhile.
	if target.Running && s.isCommand(sessionID, text) {
		for target.Running {
			time.Sleep(commandWait)
			var current *Target
			s.withTimeline(func(t *Timeline) { current = t.Find(sessionID) })
			if current == nil || !current.Online {
				fail("offline")
				return
			}
			target = *current
		}
	}
	if target.Running {
		reply, err := s.relays.command(target.SourceID, RelayCommand{Op: "steer", SessionID: sessionID, Text: text, Echo: true, PromptRequired: true})
		if err != nil {
			fail("send-failed")
			return
		}
		var answer struct {
			Result struct {
				Outcome string `json:"outcome"`
			} `json:"result"`
		}
		_ = json.Unmarshal(reply.Result, &answer)
		switch answer.Result.Outcome {
		case "injected":
			return
		case "promptRequired":
		default:
			fail("steer-failed")
			return
		}
	}
	// The reply comes when the turn ends; the timeline follows the turn on its own.
	if _, err := s.relays.command(target.SourceID, RelayCommand{Op: "prompt", SessionID: sessionID, Text: text, Echo: true}); err != nil {
		fail("send-failed")
	}
}

const commandWait = 500 * time.Millisecond

// isCommand reports whether text calls one of the slash commands the session's agent offers.
func (s *Server) isCommand(sessionID, text string) bool {
	name, _, _ := strings.Cut(strings.TrimSpace(text), " ")
	name, found := strings.CutPrefix(name, "/")
	if !found {
		return false
	}
	offered := false
	s.withTimeline(func(t *Timeline) {
		offered = slices.ContainsFunc(t.Commands(sessionID), func(command protocol.Command) bool { return command.Name == name })
	})
	return offered
}

func (s *Server) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	changes := s.timeline.Flush()
	for _, id := range changes.Handovers {
		go s.handOver(id)
	}
	s.notify(changes.Alerts)
	var sessions []byte
	if changes.Sessions {
		sessions = encode(sessionsMessage{"sessions", s.timeline.Summaries()})
	}
	for c := range s.clients {
		if !c.authed {
			continue
		}
		if sessions != nil {
			c.enqueue(sessions)
		}
		// The new-chat screen has no open chat, only its draft.
		for _, id := range []string{c.open, c.draft} {
			if id != "" && changes.Commands[id] {
				c.enqueue(encode(commandsMessage{"commands", id, s.timeline.Commands(id)}))
			}
			if id != "" && changes.Options[id] {
				c.enqueue(encode(optionsMessage{"options", id, s.timeline.Options(id)}))
			}
		}
		if c.open == "" {
			continue
		}
		if changes.Resets[c.open] {
			if start, entries := s.timeline.Tail(c.open, math.MaxInt); entries != nil {
				c.enqueue(encode(timelineMessage{"timeline", c.open, start, entries}))
			}
			continue
		}
		// A replayed history goes out whole once it has come, not as an entry at a time.
		if s.timeline.Replaying(c.open) {
			continue
		}
		if changed := changes.Patches[c.open]; changed != nil {
			list := make([]protocol.Change, 0, len(changed))
			for index := range changed {
				if entry := s.timeline.Entry(c.open, index); entry != nil {
					list = append(list, protocol.Change{Index: index, Entry: entry})
				}
			}
			slices.SortFunc(list, func(a, b protocol.Change) int { return a.Index - b.Index })
			c.enqueue(encode(patchMessage{"patch", c.open, list}))
		}
	}
}
