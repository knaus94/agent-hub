// Package protocol is what the hub sends to the browser. It mirrors web/src/shared/protocol.ts field for field; the
// browser only ever sees these built values, never raw ACP messages, which carry MCP server configs and credentials.
package protocol

import "encoding/json"

type ToolContent interface{ toolContent() }

type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type DiffContent struct {
	Type    string  `json:"type"`
	Path    string  `json:"path"`
	OldText *string `json:"oldText"`
	NewText string  `json:"newText"`
}

type TerminalContent struct {
	Type string `json:"type"`
}

func (TextContent) toolContent()     {}
func (DiffContent) toolContent()     {}
func (TerminalContent) toolContent() {}

type Entry interface{ entry() }

type UserEntry struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Text   string `json:"text"`
	Origin string `json:"origin"`
	Steer  bool   `json:"steer"`
}

// TextEntry is an agent message ("agent") or its reasoning ("thought").
type TextEntry struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Text string `json:"text"`
}

type ToolEntry struct {
	Kind     string        `json:"kind"`
	ID       string        `json:"id"`
	Title    string        `json:"title"`
	ToolKind string        `json:"toolKind"`
	Status   string        `json:"status"`
	Command  *string       `json:"command"`
	Output   *string       `json:"output"`
	ExitCode *int          `json:"exitCode"`
	Content  []ToolContent `json:"content"`
}

type NoticeEntry struct {
	Kind   string  `json:"kind"`
	ID     string  `json:"id"`
	Code   string  `json:"code"`
	Detail *string `json:"detail"`
}

func (UserEntry) entry()   {}
func (TextEntry) entry()   {}
func (ToolEntry) entry()   {}
func (NoticeEntry) entry() {}

type PlanItem struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

type Context struct {
	Used float64 `json:"used"`
	Size float64 `json:"size"`
}

type SessionSummary struct {
	ID      string  `json:"id"`
	Agent   string  `json:"agent"`
	Label   string  `json:"label"`
	Account *string `json:"account"`
	Cwd     *string `json:"cwd"`
	Title   *string `json:"title"`
	Status  string  `json:"status"`
	// Activity is what a running turn is doing now: "thinking", "tool" or "writing"; nil while idle.
	Activity *string `json:"activity"`
	// Preview is one line about the latest step: the thought, the command, or the reply.
	Preview   *string    `json:"preview"`
	Online    bool       `json:"online"`
	UpdatedAt int64      `json:"updatedAt"`
	Model     *string    `json:"model"`
	Mode      *string    `json:"mode"`
	Context   *Context   `json:"context"`
	Plan      []PlanItem `json:"plan"`
	Archived  bool       `json:"archived"`
}

// QuickAction is a button the user made: it sends its text to the chat, or puts it in the composer to finish. Agents
// lists the kinds of agent it is offered for; empty means every agent.
type QuickAction struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	Text   string   `json:"text"`
	Agents []string `json:"agents"`
	Send   bool     `json:"send"`
}

// LimitAccount is a subscription account the agents use, with how much of its limits is spent.
type LimitAccount struct {
	ID    string `json:"id"`
	Agent string `json:"agent"`
	Email string `json:"email"`
	// Error is "login" when the CLI has to sign in again and "unavailable" when the service did not answer; Limits
	// are then the last ones read, at Checked (Unix milliseconds).
	Error   string  `json:"error,omitempty"`
	Checked int64   `json:"checked"`
	Limits  []Limit `json:"limits"`
}

// Limit is one limit of an account: the whole subscription's week, or a model's own share of it.
type Limit struct {
	// Kind is "week" or "model", the model named by Model.
	Kind    string  `json:"kind"`
	Model   string  `json:"model,omitempty"`
	Percent float64 `json:"percent"`
	// ResetsAt is when the limit starts again, in Unix milliseconds; Window is how long it runs, in milliseconds.
	ResetsAt int64 `json:"resetsAt"`
	Window   int64 `json:"window"`
	// Active is false for a limit the service marks as not in force now.
	Active bool `json:"active"`
}

type Change struct {
	Index int   `json:"index"`
	Entry Entry `json:"entry"`
}

// AgentOption is an agent entry from Zed's settings that a new chat can start with.
type AgentOption struct {
	ID      string  `json:"id"`
	Agent   string  `json:"agent"`
	Label   string  `json:"label"`
	Account *string `json:"account"`
}

// ProjectOption is a directory a new chat can work in.
type ProjectOption struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// Command is a slash command the agent advertises for a session.
// ConfigOption is a session setting as the agent offers it, the way Zed shows it: a choice ("select") such as the model
// or the reasoning effort (category "thought_level"), or a switch ("boolean") such as fast mode.
type ConfigOption struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Category *string         `json:"category"`
	Type     string          `json:"type"`
	Current  json.RawMessage `json:"current"`
	Choices  []ConfigChoice  `json:"choices"`
}

type ConfigChoice struct {
	Value       string  `json:"value"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

type Command struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Hint        *string `json:"hint"`
}

type QuestionOption struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Kind        *string `json:"kind"`
	Description *string `json:"description"`
}

// QuestionField is one field of a form the agent asks to fill: a choice among options or free input of a JSON type.
type QuestionField struct {
	Key         string           `json:"key"`
	Kind        string           `json:"kind"`
	Type        string           `json:"type"`
	Title       *string          `json:"title"`
	Description *string          `json:"description"`
	Multiple    bool             `json:"multiple"`
	Options     []QuestionOption `json:"options"`
}

// QuestionEntry is an agent waiting for the user: a permission to grant, a form to fill, or a page to open.
type QuestionEntry struct {
	Kind    string           `json:"kind"`
	ID      string           `json:"id"`
	Mode    string           `json:"mode"`
	Message string           `json:"message"`
	Options []QuestionOption `json:"options"`
	Fields  []QuestionField  `json:"fields"`
	URL     *string          `json:"url"`
	Status  string           `json:"status"`
	Answer  *string          `json:"answer"`
}

func (QuestionEntry) entry() {}
