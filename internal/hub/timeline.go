package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// message is one ACP message as a relay reports it.
type message struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

func present(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && string(trimmed) != "null"
}

// fields reads an ACP object loosely: a value of an unexpected shape reads as absent.
type fields map[string]json.RawMessage

func object(raw json.RawMessage) fields {
	var f fields
	if !present(raw) || json.Unmarshal(raw, &f) != nil {
		return nil
	}
	return f
}

func (f fields) str(key string) *string {
	var value string
	if raw, ok := f[key]; ok && present(raw) && json.Unmarshal(raw, &value) == nil {
		return &value
	}
	return nil
}

func (f fields) number(key string) *float64 {
	var value float64
	if raw, ok := f[key]; ok && present(raw) && json.Unmarshal(raw, &value) == nil {
		return &value
	}
	return nil
}

func (f fields) object(key string) fields {
	return object(f[key])
}

func (f fields) array(key string) ([]json.RawMessage, bool) {
	var values []json.RawMessage
	raw, ok := f[key]
	if !ok || !present(raw) || bytes.TrimSpace(raw)[0] != '[' || json.Unmarshal(raw, &values) != nil {
		return nil, false
	}
	return values, true
}

func textOf(raw json.RawMessage) *string {
	block := object(raw)
	if kind := block.str("type"); kind == nil || *kind != "text" {
		return nil
	}
	return block.str("text")
}

// shownImages are the kinds of picture the web app draws; anything else in an image block is left out.
var shownImages = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

func imageOf(raw json.RawMessage) *protocol.Image {
	block := object(raw)
	if kind := block.str("type"); kind == nil || *kind != "image" {
		return nil
	}
	mime, data := deref(block.str("mimeType")), deref(block.str("data"))
	if !shownImages[mime] || data == "" {
		return nil
	}
	return &protocol.Image{MimeType: mime, Data: data}
}

func promptImages(raw json.RawMessage) []protocol.Image {
	var blocks []json.RawMessage
	_ = json.Unmarshal(raw, &blocks)
	var images []protocol.Image
	for _, block := range blocks {
		if image := imageOf(block); image != nil {
			images = append(images, *image)
		}
	}
	return images
}

func promptText(raw json.RawMessage) string {
	var blocks []json.RawMessage
	_ = json.Unmarshal(raw, &blocks)
	var texts []string
	for _, block := range blocks {
		if text := textOf(block); text != nil {
			texts = append(texts, *text)
		}
	}
	return strings.Join(texts, "\n")
}

var (
	claudeName   = regexp.MustCompile(`(?i)claude`)
	codexName    = regexp.MustCompile(`(?i)codex`)
	opencodeName = regexp.MustCompile(`(?i)opencode|qwen`)
	hubSuffix    = regexp.MustCompile(`(?i)\s*·\s*hub$`)
	accountParen = regexp.MustCompile(`\(([^)]+)\)`)
	emailDomain  = regexp.MustCompile(`@.*$`)
	agentPrefix  = regexp.MustCompile(`(?i)^(claude|codex|opencode)(-acp)?\s*`)
)

// describeSource names an agent entry for people: "Claude (name@mail) · hub" is account "name", "Codex API" is "API".
func describeSource(name string) (label string, account *string) {
	label = hubSuffix.ReplaceAllString(name, "")
	if match := accountParen.FindStringSubmatch(label); match != nil {
		value := emailDomain.ReplaceAllString(match[1], "")
		return label, &value
	}
	if rest := strings.TrimSpace(agentPrefix.ReplaceAllString(label, "")); rest != "" {
		return label, &rest
	}
	return label, nil
}

func agentOf(name string) string {
	switch {
	case claudeName.MatchString(name):
		return "claude"
	case codexName.MatchString(name):
		return "codex"
	case opencodeName.MatchString(name):
		return "opencode"
	}
	return "other"
}

func toolContent(values []json.RawMessage) []protocol.ToolContent {
	content := []protocol.ToolContent{}
	for _, value := range values {
		block := object(value)
		kind := block.str("type")
		switch {
		case kind == nil:
		case *kind == "content":
			if image := imageOf(block["content"]); image != nil {
				content = append(content, protocol.ImageContent{Type: "image", Image: *image})
			} else if text := textOf(block["content"]); text != nil {
				content = append(content, protocol.TextContent{Type: "text", Text: *text})
			}
		case *kind == "diff":
			content = append(content, protocol.DiffContent{Type: "diff", Path: deref(block.str("path")), OldText: block.str("oldText"), NewText: deref(block.str("newText"))})
		case *kind == "terminal":
			content = append(content, protocol.TerminalContent{Type: "terminal"})
		}
	}
	return content
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type choice struct {
	value, name string
	description *string
}

type option struct {
	id       string
	name     string
	kind     string
	category *string
	current  *string
	// raw is the current value as the agent sent it: a string for a choice, true or false for a switch.
	raw    json.RawMessage
	values []choice
}

func parseOptions(values []json.RawMessage) []option {
	var parsed []option
	for _, value := range values {
		entry := object(value)
		id := entry.str("id")
		if entry == nil || id == nil {
			continue
		}
		listed, _ := entry.array("options")
		var flat []json.RawMessage
		for _, item := range listed {
			if nested, isGroup := object(item).array("options"); isGroup {
				flat = append(flat, nested...)
			} else {
				flat = append(flat, item)
			}
		}
		var choices []choice
		for _, item := range flat {
			c := object(item)
			if v := c.str("value"); v != nil && *v != "" {
				name := *v
				if n := c.str("name"); n != nil {
					name = *n
				}
				choices = append(choices, choice{*v, name, c.str("description")})
			}
		}
		parsed = append(parsed, option{
			id: *id, name: deref(entry.str("name")), kind: deref(entry.str("type")), category: entry.str("category"),
			current: entry.str("currentValue"), raw: entry["currentValue"], values: choices,
		})
	}
	return parsed
}

func findOption(all []option, category string) *option {
	for i := range all {
		if all[i].category != nil && *all[i].category == category {
			return &all[i]
		}
	}
	for i := range all {
		if all[i].id == category {
			return &all[i]
		}
	}
	return nil
}

// optionLabel names the current value of an option; current overrides the option's own when given.
func optionLabel(all []option, category string, current *string) *string {
	found := findOption(all, category)
	if current == nil && found != nil {
		current = found.current
	}
	if current == nil || *current == "" {
		return nil
	}
	if found != nil {
		for _, c := range found.values {
			if c.value == *current {
				return &c.name
			}
		}
	}
	return current
}

type steer struct {
	sessionID string
	index     int
}

type source struct {
	id string
	// name is the Zed agent entry the relay runs, which names its command and account.
	name    string
	label   string
	account *string
	agent   string
	// owned sources are agent processes the hub started; their client is the hub, not Zed.
	owned  bool
	online bool
	// live once the relay has replayed its history: what happens from then on is new, and worth a notification.
	live     bool
	creating map[string]*string
	// Request ids are only unique per connection: Zed numbers each agent process's requests from zero.
	prompts map[string]string
	steers  map[string]steer
	configs map[string]string
	// questions are the agent's requests waiting for the user, by request id; url forms also by elicitation id.
	questions    map[string]questionRef
	elicitations map[string]questionRef
}

type questionRef struct {
	sessionID string
	index     int
}

type streaming struct {
	kind      string
	index     int
	messageID *string
}

type reuse struct {
	index int
	text  string
}

type session struct {
	id        string
	sourceID  string
	cwd       *string
	title     *string
	updatedAt int64
	// turnAt is when the last turn began. The list is ordered by it: every chunk of a running turn touches
	// updatedAt, and two chats at work would trade places all the time.
	turnAt    int64
	entries   []protocol.Entry
	sequence  int
	tools     map[string]int
	streaming *streaming
	echo      *string
	// echoImages counts the pictures of the prompt just sent that the agent may still echo.
	echoImages int
	reuse      *reuse
	prompts    map[string]struct{}
	// Zed closed the session: its agent process no longer holds it, so nothing can be sent to it there.
	closed  bool
	options []option
	modeID  *string
	model   *string
	context *protocol.Context
	plan    []protocol.PlanItem
	// commands are the slash commands the agent advertises; pending holds the indexes of unanswered questions.
	commands []protocol.Command
	pending  map[int]bool
	// replaying while the agent answers session/load with the whole conversation: a browser gets it once it has come.
	replaying bool
}

const outputLimit = 64 * 1024

// Changes is what happened since the last flush: summaries to resend, timelines to resend whole, entries to patch.
type Changes struct {
	Sessions bool
	Resets   map[string]bool
	Patches  map[string]map[int]bool
	// Commands and Options name the sessions whose slash commands or settings changed.
	Commands map[string]bool
	Options  map[string]bool
	// Handovers are chats begun in the web app that Zed has now loaded itself: the hub's copy is to be closed.
	Handovers []string
	// Alerts are what the user is notified of: a turn that ended, or an agent waiting for an answer.
	Alerts []Alert
}

type Alert struct {
	// Kind is "done", "failed" or "ask".
	Kind      string
	SessionID string
	// Text is the question asked, for "ask".
	Text string
}

func newChanges() Changes {
	return Changes{Resets: map[string]bool{}, Patches: map[string]map[int]bool{}, Commands: map[string]bool{}, Options: map[string]bool{}}
}

// Timeline builds every session's timeline from the ACP traffic relays report, the way Zed builds its thread view.
// It is not safe for concurrent use.
type Timeline struct {
	sources    map[string]*source
	sessions   map[string]*session
	order      []string
	pendingCut map[string]bool
	owned      map[string]bool
	// hidden are sessions not listed: chats prepared for the new-chat screen that nothing was sent to yet.
	hidden map[string]bool
	// A chat is archived when the web app archived it or Zed did. Zed rewrites a thread's flag from memory whenever
	// the thread changes, so its 0 does not undo an archive made here; only restoring it here does.
	archived    map[string]bool
	zedArchived map[string]bool
	// handed maps a chat Zed took over to the hub's agent process that held it; that process's late updates are dropped.
	handed  map[string]string
	changes Changes
	now     func() int64
}

func NewTimeline() *Timeline {
	return &Timeline{
		sources:    map[string]*source{},
		sessions:   map[string]*session{},
		pendingCut: map[string]bool{},
		owned:      map[string]bool{},
		hidden:     map[string]bool{},
		archived:   map[string]bool{},
		handed:     map[string]string{},
		changes:    newChanges(),
		now:        func() int64 { return time.Now().UnixMilli() },
	}
}

// Attach starts or restarts a source. A new subscription replays the relay's history, so whatever the source built
// before is rebuilt from scratch.
func (t *Timeline) Attach(sourceID, name string, dropped int) {
	for _, id := range append([]string(nil), t.order...) {
		if t.sessions[id].sourceID == sourceID {
			t.forget(id)
			delete(t.changes.Patches, id)
		}
	}
	label, account := describeSource(name)
	t.sources[sourceID] = &source{
		id: sourceID, name: hubSuffix.ReplaceAllString(name, ""), label: label, account: account, agent: agentOf(name), online: true, owned: t.owned[sourceID],
		creating: map[string]*string{}, prompts: map[string]string{}, steers: map[string]steer{}, configs: map[string]string{},
		questions: map[string]questionRef{}, elicitations: map[string]questionRef{},
	}
	t.changes.Sessions = true
	if dropped > 0 {
		t.pendingCut[sourceID] = true
	}
}

func (t *Timeline) forget(id string) {
	delete(t.sessions, id)
	for i, existing := range t.order {
		if existing == id {
			t.order = append(t.order[:i], t.order[i+1:]...)
			break
		}
	}
}

// MarkOwned records, before its relay is followed, that the hub itself started this source.
func (t *Timeline) MarkOwned(sourceID string) {
	t.owned[sourceID] = true
}

// Live marks a source as caught up with its history.
func (t *Timeline) Live(sourceID string) {
	if src := t.sources[sourceID]; src != nil {
		src.live = true
	}
}

// alert notes something to notify the user of: only as it happens, not as a relay replays it, and not for a chat
// being prepared or put away.
func (t *Timeline) alert(src *source, s *session, kind, text string) {
	if src.live && !t.hidden[s.id] && !t.IsArchived(s.id) {
		t.changes.Alerts = append(t.changes.Alerts, Alert{kind, s.id, text})
	}
}

func (t *Timeline) Detach(sourceID string) {
	src := t.sources[sourceID]
	if src == nil {
		return
	}
	src.online = false
	for id, holder := range t.handed {
		if holder == sourceID {
			delete(t.handed, id)
		}
	}
	for _, s := range t.sessions {
		if s.sourceID == sourceID {
			clear(s.prompts)
			if s.replaying {
				s.replaying = false
				t.changes.Resets[s.id] = true
			}
		}
	}
	t.changes.Sessions = true
}

func (t *Timeline) Apply(sourceID, from string, raw json.RawMessage) {
	src := t.sources[sourceID]
	if src == nil {
		return
	}
	var m message
	if json.Unmarshal(raw, &m) != nil {
		return
	}
	switch {
	case m.Method != "" && from == "agent":
		t.fromAgent(src, &m)
	case m.Method != "" && (from == "client" || m.Method != "session/update"):
		t.fromClient(src, from, &m)
	case m.Method == "" && present(m.ID) && from == "agent":
		t.agentReply(src, &m)
	case m.Method == "" && present(m.ID):
		// Zed, the hub or a relay answered one of the agent's questions.
		t.answered(src, &m)
	}
}

// Target is where a message for a session has to go.
type Target struct {
	SourceID string
	Online   bool
	Running  bool
}

// Title is what the chat list calls a session.
func (t *Timeline) Title(sessionID string) string {
	if s := t.sessions[sessionID]; s != nil && t.sources[s.sourceID] != nil {
		return deref(t.summary(s).Title)
	}
	return ""
}

// Origin is what moving a chat to another agent needs to know of it.
type Origin struct {
	// Agent is the Zed agent entry the chat runs on.
	Agent   string
	Label   string
	Cwd     string
	Title   string
	Running bool
	Entries []protocol.Entry
}

func (t *Timeline) Origin(sessionID string) (Origin, bool) {
	s := t.sessions[sessionID]
	if s == nil || t.sources[s.sourceID] == nil || s.replaying {
		return Origin{}, false
	}
	src := t.sources[s.sourceID]
	return Origin{src.name, src.label, deref(s.cwd), deref(t.summary(s).Title), len(s.prompts) > 0, slices.Clone(s.entries)}, true
}

// Cwd is the directory a chat works in, or "" when the chat is unknown or never said.
func (t *Timeline) Cwd(sessionID string) string {
	if s := t.sessions[sessionID]; s != nil {
		return deref(s.cwd)
	}
	return ""
}

// resetTime is when a rate limit ends, as RFC 3339; Claude gives it in seconds or milliseconds since 1970.
func resetTime(at *float64) *string {
	if at == nil || *at <= 0 {
		return nil
	}
	when := time.Unix(int64(*at), 0)
	if *at > 1e12 {
		when = time.UnixMilli(int64(*at))
	}
	value := when.UTC().Format(time.RFC3339)
	return &value
}

func (t *Timeline) Find(sessionID string) *Target {
	s := t.sessions[sessionID]
	if s == nil || t.sources[s.sourceID] == nil {
		return nil
	}
	return &Target{SourceID: s.sourceID, Online: t.sources[s.sourceID].online && !s.closed, Running: len(s.prompts) > 0}
}

func (t *Timeline) Summaries() []protocol.SessionSummary {
	shown := make([]*session, 0, len(t.order))
	for _, id := range t.order {
		if !t.hidden[id] {
			shown = append(shown, t.sessions[id])
		}
	}
	sort.SliceStable(shown, func(i, j int) bool { return shown[i].turnAt > shown[j].turnAt })
	summaries := make([]protocol.SessionSummary, 0, len(shown))
	for _, s := range shown {
		summaries = append(summaries, t.summary(s))
	}
	return summaries
}

// Hide keeps a session out of the list until Show; it may be called before the session's first line arrives.
func (t *Timeline) Hide(sessionID string) {
	t.hidden[sessionID] = true
}

// Archive archives or restores a known session, and reports whether it knew it.
func (t *Timeline) Archive(sessionID string, archived bool) bool {
	if t.sessions[sessionID] == nil {
		return false
	}
	if archived {
		t.archived[sessionID] = true
	} else {
		delete(t.archived, sessionID)
		delete(t.zedArchived, sessionID)
	}
	t.changes.Sessions = true
	return true
}

func (t *Timeline) IsArchived(sessionID string) bool {
	return t.archived[sessionID] || t.zedArchived[sessionID]
}

// ArchivedHere lists the sessions archived in the web app, to keep across restarts.
func (t *Timeline) ArchivedHere() []string {
	return slices.Sorted(maps.Keys(t.archived))
}

func (t *Timeline) RestoreArchive(ids []string) {
	for _, id := range ids {
		t.archived[id] = true
	}
}

// SetZedArchived takes the sessions Zed lists as archived.
func (t *Timeline) SetZedArchived(archived map[string]bool) {
	if !maps.Equal(archived, t.zedArchived) {
		t.zedArchived = archived
		t.changes.Sessions = true
	}
}

func (t *Timeline) Show(sessionID string) {
	delete(t.hidden, sessionID)
	t.changes.Sessions = true
}

// page is how many entries a browser gets at a time: a long chat holds thousands, megabytes in all.
const page = 100

// Tail is where a browser opening the chat starts: the last page, or earlier to keep the entries it already holds
// from index from, and never after an unanswered question, which must stay answerable. Nil while the session is
// unknown or its history is still being replayed.
func (t *Timeline) Tail(sessionID string, from int) (int, []protocol.Entry) {
	s := t.sessions[sessionID]
	if s == nil || s.replaying {
		return 0, nil
	}
	start := max(len(s.entries)-page, 0)
	start = min(start, max(from, 0))
	for index := range s.pending {
		start = min(start, index)
	}
	return start, s.entries[start:]
}

// Older is the page that ends where a browser's entries begin.
func (t *Timeline) Older(sessionID string, before int) (int, []protocol.Entry) {
	s := t.sessions[sessionID]
	if s == nil || s.replaying {
		return 0, nil
	}
	before = min(max(before, 0), len(s.entries))
	start := max(before-page, 0)
	return start, s.entries[start:before]
}

func (t *Timeline) Replaying(sessionID string) bool {
	s := t.sessions[sessionID]
	return s != nil && s.replaying
}

// Entry is the entry at index, or nil.
func (t *Timeline) Entry(sessionID string, index int) protocol.Entry {
	if s := t.sessions[sessionID]; s != nil && index < len(s.entries) {
		return s.entries[index]
	}
	return nil
}

func (t *Timeline) Flush() Changes {
	changes := t.changes
	t.changes = newChanges()
	return changes
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(text, "\n")
	if runes := []rune(line); len(runes) > 120 {
		return string(runes[:120])
	}
	return line
}

func (t *Timeline) summary(s *session) protocol.SessionSummary {
	src := t.sources[s.sourceID]
	title := s.title
	if title == nil {
		for _, e := range s.entries {
			if user, ok := e.(protocol.UserEntry); ok {
				line := firstLine(user.Text)
				title = &line
				break
			}
		}
	}
	status := "idle"
	if len(s.prompts) > 0 {
		status = "running"
	}
	model := s.model
	if model == nil {
		model = optionLabel(s.options, "model", nil)
	}
	activity, preview := latestStep(s.entries, status == "running")
	if len(s.pending) > 0 {
		waiting := "waiting"
		activity = &waiting
	}
	return protocol.SessionSummary{
		ID: s.id, Agent: src.agent, Label: src.label, Account: src.account, Cwd: s.cwd, Title: title, Status: status,
		Activity: activity, Preview: preview, Online: src.online && !s.closed, UpdatedAt: s.updatedAt, Model: model,
		Mode: optionLabel(s.options, "mode", s.modeID), Context: s.context, Plan: s.plan,
		Archived: t.IsArchived(s.id),
	}
}

var markdownMarks = strings.NewReplacer("**", "", "__", "", "`", "")

// previewLine is the last line of text with its markdown marks removed, short enough for a list row.
func previewLine(text string, last bool) *string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	line := lines[0]
	if last {
		line = lines[len(lines)-1]
	}
	line = strings.TrimLeft(markdownMarks.Replace(strings.TrimSpace(line)), "#-*> ")
	if runes := []rune(line); len(runes) > 140 {
		line = string(runes[:140])
	}
	if line == "" {
		return nil
	}
	return &line
}

// latestStep says what a session is doing for the list: the newest thought, command or reply.
func latestStep(entries []protocol.Entry, running bool) (activity, preview *string) {
	of := func(kind string) *string { return &kind }
	for i := len(entries) - 1; i >= 0; i-- {
		switch entry := entries[i].(type) {
		case protocol.TextEntry:
			if entry.Kind == "thought" {
				if running {
					return of("thinking"), previewLine(entry.Text, true)
				}
				continue
			}
			if running {
				return of("writing"), previewLine(entry.Text, true)
			}
			return nil, previewLine(entry.Text, false)
		case protocol.ToolEntry:
			if !running {
				continue
			}
			label := entry.Title
			if entry.Command != nil {
				label = *entry.Command
			}
			return of("tool"), previewLine(label, false)
		case protocol.UserEntry:
			if running {
				return of("thinking"), nil
			}
			return nil, previewLine(entry.Text, false)
		}
	}
	if running {
		return of("thinking"), nil
	}
	return nil, nil
}

func (t *Timeline) ensure(sessionID string, src *source, cwd *string) *session {
	s := t.sessions[sessionID]
	if s == nil || s.sourceID != src.id {
		if s == nil {
			t.order = append(t.order, sessionID)
		}
		s = &session{
			id: sessionID, sourceID: src.id, cwd: cwd, updatedAt: t.now(), turnAt: t.now(),
			entries: []protocol.Entry{}, tools: map[string]int{}, prompts: map[string]struct{}{}, plan: []protocol.PlanItem{}, pending: map[int]bool{},
		}
		t.sessions[sessionID] = s
		// A session rebuilt after a re-subscribe reuses its indexes, so an open browser gets it whole, not as patches.
		t.changes.Resets[sessionID] = true
		if t.pendingCut[src.id] {
			delete(t.pendingCut, src.id)
			t.notice(s, "history-cut", nil)
		}
	} else if cwd != nil {
		s.cwd = cwd
	}
	t.changes.Sessions = true
	return s
}

func (t *Timeline) touch(s *session) {
	s.updatedAt = t.now()
	t.changes.Sessions = true
}

func (t *Timeline) nextID(s *session) string {
	id := fmt.Sprintf("%s:%d", s.id, s.sequence)
	s.sequence++
	return id
}

func (t *Timeline) push(s *session, entry protocol.Entry) int {
	s.entries = append(s.entries, entry)
	s.streaming = nil
	index := len(s.entries) - 1
	t.mark(s, index)
	return index
}

func (t *Timeline) replace(s *session, index int, entry protocol.Entry) {
	s.entries[index] = entry
	t.mark(s, index)
}

func (t *Timeline) mark(s *session, index int) {
	changed := t.changes.Patches[s.id]
	if changed == nil {
		changed = map[int]bool{}
		t.changes.Patches[s.id] = changed
	}
	changed[index] = true
	t.touch(s)
}

func (t *Timeline) notice(s *session, code string, detail *string) {
	t.push(s, protocol.NoticeEntry{Kind: "notice", ID: t.nextID(s), Code: code, Detail: detail})
}

func (t *Timeline) stopTools(s *session) {
	for _, index := range s.tools {
		if tool, ok := s.entries[index].(protocol.ToolEntry); ok && (tool.Status == "pending" || tool.Status == "in_progress") {
			tool.Status = "failed"
			t.replace(s, index, tool)
		}
	}
}

func (t *Timeline) fromClient(src *source, from string, m *message) {
	params := object(m.Params)
	sessionID := deref(params.str("sessionId"))
	id := string(m.ID)
	if sessionID != "" && t.handed[sessionID] == src.id {
		return
	}
	switch m.Method {
	case "session/new":
		src.creating[id] = params.str("cwd")
	case "session/load", "session/resume":
		if sessionID == "" {
			return
		}
		if held := t.sessions[sessionID]; held != nil && held.sourceID != src.id && t.owned[held.sourceID] && !t.owned[src.id] {
			t.handed[sessionID] = held.sourceID
			t.changes.Handovers = append(t.changes.Handovers, sessionID)
		}
		s := t.ensure(sessionID, src, params.str("cwd"))
		s.closed = false
		if m.Method == "session/load" {
			// The agent replays the whole conversation next.
			s.entries = []protocol.Entry{}
			clear(s.tools)
			s.streaming = nil
			s.reuse = nil
			t.forgetQuestions(src, s)
			s.replaying = true
		}
		src.configs[id] = sessionID
	case "session/set_config_option", "session/set_mode":
		// Claude answers with the new options instead of sending an update.
		if sessionID != "" {
			src.configs[id] = sessionID
		}
	case "session/close":
		if s := t.sessions[sessionID]; s != nil {
			s.closed = true
			clear(s.prompts)
			t.touch(s)
		}
	case "session/prompt":
		if sessionID == "" {
			return
		}
		s := t.sessions[sessionID]
		if s == nil {
			s = t.ensure(sessionID, src, nil)
		}
		s.turnAt = t.now()
		text := promptText(params["prompt"])
		if s.reuse != nil && s.reuse.text == text && s.reuse.index < len(s.entries) {
			// A steer that found no running turn comes back as this prompt; keep its message.
			if user, ok := s.entries[s.reuse.index].(protocol.UserEntry); ok {
				user.Steer = false
				t.replace(s, s.reuse.index, user)
			}
		} else {
			origin := "hub"
			if from == "client" && !src.owned {
				origin = "zed"
			}
			t.push(s, protocol.UserEntry{Kind: "user", ID: t.nextID(s), Text: text, Origin: origin, Images: promptImages(params["prompt"])})
		}
		s.reuse = nil
		s.echo = &text
		s.echoImages = len(promptImages(params["prompt"]))
		s.prompts[id] = struct{}{}
		src.prompts[id] = sessionID
		t.touch(s)
	case "_session/steering":
		s := t.sessions[sessionID]
		if s == nil {
			return
		}
		index := t.push(s, protocol.UserEntry{Kind: "user", ID: t.nextID(s), Text: promptText(params["prompt"]), Origin: "hub", Steer: true, Images: promptImages(params["prompt"])})
		src.steers[id] = steer{s.id, index}
	}
}

func (t *Timeline) agentReply(src *source, m *message) {
	id := string(m.ID)
	result := object(m.Result)
	if cwd, ok := src.creating[id]; ok {
		delete(src.creating, id)
		if sessionID := result.str("sessionId"); sessionID != nil && *sessionID != "" {
			t.configure(t.ensure(*sessionID, src, cwd), result)
		}
		return
	}
	if name := result.object("agentInfo").str("name"); name != nil && *name != "" {
		src.agent = agentOf(*name)
		t.changes.Sessions = true
		return
	}
	if sessionID, ok := src.configs[id]; ok {
		delete(src.configs, id)
		if s := t.sessions[sessionID]; s != nil && t.handed[sessionID] != src.id {
			t.configure(s, result)
			if s.replaying {
				s.replaying = false
				t.changes.Resets[sessionID] = true
			}
		}
		return
	}
	if sessionID, ok := src.prompts[id]; ok {
		delete(src.prompts, id)
		s := t.sessions[sessionID]
		if s == nil || t.handed[sessionID] == src.id {
			return
		}
		delete(s.prompts, id)
		s.echo, s.echoImages = nil, 0
		stopReason := deref(result.str("stopReason"))
		failed := present(m.Error)
		// Codex leaves a stopped tool in progress; after an end_turn a Claude background task can still be running.
		if failed || stopReason == "cancelled" {
			t.stopTools(s)
		}
		t.closeQuestions(s)
		// An account out of its limits says when it runs again; a client can offer another agent meanwhile.
		limit := object(m.Error).object("data")
		switch {
		case failed && deref(limit.str("errorKind")) == "rate_limit":
			t.notice(s, "rate-limited", resetTime(limit.object("rateLimit").number("resetsAt")))
		case failed:
			t.notice(s, "turn-failed", object(m.Error).str("message"))
		case stopReason == "cancelled":
			t.notice(s, "cancelled", nil)
		case stopReason != "" && stopReason != "end_turn":
			t.notice(s, "turn-failed", &stopReason)
		}
		switch {
		case failed || (stopReason != "" && stopReason != "end_turn" && stopReason != "cancelled"):
			t.alert(src, s, "failed", "")
		case stopReason == "end_turn":
			t.alert(src, s, "done", "")
		}
		t.touch(s)
		return
	}
	if steered, ok := src.steers[id]; ok {
		delete(src.steers, id)
		// A reload in between replaces the entries the steer pointed at.
		s := t.sessions[steered.sessionID]
		if s == nil || t.handed[steered.sessionID] == src.id || steered.index >= len(s.entries) {
			return
		}
		user, ok := s.entries[steered.index].(protocol.UserEntry)
		if !ok {
			return
		}
		switch outcome := deref(result.str("outcome")); outcome {
		case "promptRequired":
			s.reuse = &reuse{steered.index, user.Text}
		case "injected", "startedNewTurn":
		default:
			text := user.Text
			t.replace(s, steered.index, protocol.NoticeEntry{Kind: "notice", ID: user.ID, Code: "steer-failed", Detail: &text})
		}
	}
}

// configure takes options from a reply or an update. Agents report the mode through config options, legacy modes, or
// a mode update; whichever came last is current.
func (t *Timeline) configure(s *session, result fields) {
	if values, ok := result.array("configOptions"); ok {
		s.options = parseOptions(values)
		t.changes.Options[s.id] = true
	}
	if found := findOption(s.options, "mode"); found != nil && found.current != nil {
		s.modeID = found.current
	} else if current := result.object("modes").str("currentModeId"); current != nil {
		s.modeID = current
	}
	t.touch(s)
}

func (t *Timeline) fromAgent(src *source, m *message) {
	params := object(m.Params)
	if m.Method == "$/cancel_request" {
		t.withdrawn(src, params["requestId"])
		return
	}
	sessionID := deref(params.str("sessionId"))
	if sessionID == "" || t.handed[sessionID] == src.id {
		return
	}
	s := t.sessions[sessionID]
	if s == nil {
		s = t.ensure(sessionID, src, nil)
	}
	switch m.Method {
	case "session/update":
		t.reduce(s, params.object("update"))
	case "session/request_permission":
		t.askPermission(src, s, m.ID, params)
	case "elicitation/create":
		t.askForm(src, s, m.ID, params)
	case "elicitation/complete":
		t.completeElicitation(src, deref(params.str("elicitationId")))
	}
}

func (t *Timeline) reduce(s *session, update fields) {
	switch deref(update.str("sessionUpdate")) {
	case "user_message_chunk":
		if image := imageOf(update["content"]); image != nil {
			t.userImage(s, *image)
		} else {
			t.userChunk(s, textOf(update["content"]))
		}
	case "agent_message_chunk":
		t.chunk(s, "agent", textOf(update["content"]), update.str("messageId"))
	case "agent_thought_chunk":
		t.chunk(s, "thought", textOf(update["content"]), update.str("messageId"))
	case "tool_call", "tool_call_update":
		t.tool(s, update)
	case "plan":
		entries, _ := update.array("entries")
		plan := []protocol.PlanItem{}
		for _, raw := range entries {
			entry := object(raw)
			status := deref(entry.str("status"))
			if entry != nil && (status == "pending" || status == "in_progress" || status == "completed") {
				plan = append(plan, protocol.PlanItem{Content: deref(entry.str("content")), Status: status})
			}
		}
		s.plan = plan
		t.touch(s)
	case "session_info_update":
		if title := update.str("title"); title != nil {
			s.title = title
		}
		t.touch(s)
	case "current_mode_update":
		s.modeID = update.str("currentModeId")
		t.touch(s)
	case "config_option_update":
		t.configure(s, fields{"configOptions": update["configOptions"]})
	case "usage_update":
		used, size := update.number("used"), update.number("size")
		if used != nil && size != nil && *size != 0 {
			s.context = &protocol.Context{Used: *used, Size: *size}
		}
		if model := update.object("_meta").str("_claude/model"); model != nil && *model != "" && optionLabel(s.options, "model", nil) == nil {
			s.model = model
		}
		t.touch(s)
	case "available_commands_update":
		t.setCommands(s, update)
	}
}

func (t *Timeline) userChunk(s *session, text *string) {
	if text == nil || *text == "" {
		return
	}
	if s.echo != nil {
		// Agents may echo the prompt they were sent; it is already on the timeline.
		if strings.HasPrefix(*s.echo, *text) {
			if rest := (*s.echo)[len(*text):]; rest != "" {
				s.echo = &rest
			} else {
				s.echo = nil
			}
			return
		}
		s.echo = nil
	}
	if s.streaming != nil && s.streaming.kind == "user" {
		if user, ok := s.entries[s.streaming.index].(protocol.UserEntry); ok {
			user.Text += *text
			t.replace(s, s.streaming.index, user)
			return
		}
	}
	index := t.push(s, protocol.UserEntry{Kind: "user", ID: t.nextID(s), Text: *text, Origin: "history"})
	s.streaming = &streaming{kind: "user", index: index}
}

// userImage adds a picture to the user's message being replayed; one echoing the prompt just sent is already there.
func (t *Timeline) userImage(s *session, image protocol.Image) {
	if s.echoImages > 0 {
		s.echoImages--
		return
	}
	if s.streaming != nil && s.streaming.kind == "user" {
		if user, ok := s.entries[s.streaming.index].(protocol.UserEntry); ok {
			user.Images = append(user.Images, image)
			t.replace(s, s.streaming.index, user)
			return
		}
	}
	index := t.push(s, protocol.UserEntry{Kind: "user", ID: t.nextID(s), Origin: "history", Images: []protocol.Image{image}})
	s.streaming = &streaming{kind: "user", index: index}
}

func sameID(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (t *Timeline) chunk(s *session, kind string, text, messageID *string) {
	if text == nil || *text == "" {
		return
	}
	if s.streaming != nil && s.streaming.kind == kind && sameID(s.streaming.messageID, messageID) {
		if entry, ok := s.entries[s.streaming.index].(protocol.TextEntry); ok && entry.Kind == kind {
			entry.Text += *text
			t.replace(s, s.streaming.index, entry)
			return
		}
	}
	index := t.push(s, protocol.TextEntry{Kind: kind, ID: t.nextID(s), Text: *text})
	s.streaming = &streaming{kind: kind, index: index, messageID: messageID}
}

func (t *Timeline) tool(s *session, update fields) {
	toolCallID := deref(update.str("toolCallId"))
	if toolCallID == "" {
		return
	}
	index, known := s.tools[toolCallID]
	if !known {
		index = t.push(s, protocol.ToolEntry{Kind: "tool", ID: t.nextID(s), ToolKind: "other", Status: "pending", Content: []protocol.ToolContent{}})
		s.tools[toolCallID] = index
	}
	tool, ok := s.entries[index].(protocol.ToolEntry)
	if !ok {
		return
	}
	if title := deref(update.str("title")); title != "" {
		tool.Title = title
	}
	if kind := deref(update.str("kind")); kind != "" {
		tool.ToolKind = kind
	}
	if status := deref(update.str("status")); status == "pending" || status == "in_progress" || status == "completed" || status == "failed" {
		tool.Status = status
	}
	if values, ok := update.array("content"); ok {
		tool.Content = toolContent(values)
	}
	if command := update.object("rawInput").str("command"); command != nil && *command != "" {
		tool.Command = command
	}
	meta := update.object("_meta")
	// Zed appends `terminal_output` data to the terminal it displays; so does the timeline.
	if data := meta.object("terminal_output").str("data"); data != nil {
		output := deref(tool.Output) + *data
		if len(output) > outputLimit {
			output = output[len(output)-outputLimit:]
			for len(output) > 0 && !utf8.RuneStart(output[0]) {
				output = output[1:]
			}
		}
		tool.Output = &output
	}
	if exit := meta.object("terminal_exit"); exit != nil {
		tool.ExitCode = nil
		if code := exit.number("exit_code"); code != nil {
			value := int(*code)
			tool.ExitCode = &value
		}
	}
	t.replace(s, index, tool)
}
