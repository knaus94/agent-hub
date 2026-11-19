package hub

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// Usage limits of the subscription accounts the agents run on. The hub finds each account in its agent's config
// directory and asks Anthropic or OpenAI how much of it is spent, with the CLI's own login. It only reads that login:
// renewing a token here would sign the CLI out, so an expired one waits for the CLI to renew it.
const (
	// The web app asks every five minutes while it is on screen; the services are asked at most this often, whatever
	// they answer. It is shorter than five minutes since it counts from when the last answers came.
	limitsFresh   = 4 * time.Minute
	limitsTimeout = 15 * time.Second
	limitsWeek    = 7 * 24 * time.Hour
)

var errLogin = errors.New("the login has expired")

type limitsMessage struct {
	Type     string                  `json:"type"`
	Accounts []protocol.LimitAccount `json:"accounts"`
}

// limitSource is the config directory of an agent that may run on a subscription.
type limitSource struct{ agent, dir string }

// limitSources are the agents' config directories; an agent given an API key pays by usage and has no limits to show.
func limitSources(agents []agentEntry) []limitSource {
	home, _ := os.UserHomeDir()
	var sources []limitSource
	for _, entry := range agents {
		var source limitSource
		switch agentOf(entry.name) {
		case "claude":
			if entry.env["ANTHROPIC_API_KEY"] != "" {
				continue
			}
			source = limitSource{"claude", cmp.Or(entry.env["CLAUDE_CONFIG_DIR"], filepath.Join(home, ".claude"))}
		case "codex":
			if entry.env["CODEX_API_KEY"] != "" || entry.env["OPENAI_API_KEY"] != "" {
				continue
			}
			source = limitSource{"codex", cmp.Or(entry.env["CODEX_HOME"], filepath.Join(home, ".codex"))}
		default:
			continue
		}
		if !slices.Contains(sources, source) {
			sources = append(sources, source)
		}
	}
	slices.SortStableFunc(sources, func(a, b limitSource) int { return strings.Compare(a.agent, b.agent) })
	return sources
}

// subscriptionLogin is a CLI's login: whose it is and the token to ask with.
type subscriptionLogin struct {
	email, subject, token, account string
	// expires is when the token stops working; zero when the login does not say.
	expires time.Time
}

// readLogin reads the subscription login in a source's directory; false when it holds none.
func readLogin(source limitSource) (subscriptionLogin, bool) {
	if source.agent == "claude" {
		return claudeLogin(source.dir)
	}
	return codexLogin(source.dir)
}

func claudeLogin(dir string) (subscriptionLogin, bool) {
	var state struct {
		Account *struct {
			Email        string `json:"emailAddress"`
			ID           string `json:"accountUuid"`
			Organization string `json:"organizationUuid"`
		} `json:"oauthAccount"`
	}
	var credentials struct {
		OAuth *struct {
			Token   string `json:"accessToken"`
			Expires int64  `json:"expiresAt"`
		} `json:"claudeAiOauth"`
	}
	path := filepath.Join(dir, ".claude.json")
	// Claude Code keeps its state beside its default directory unless CLAUDE_CONFIG_DIR names one.
	if home, _ := os.UserHomeDir(); dir == filepath.Join(home, ".claude") {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			path = filepath.Join(home, ".claude.json")
		}
	}
	if readJSON(path, &state) != nil || state.Account == nil ||
		readJSON(filepath.Join(dir, ".credentials.json"), &credentials) != nil || credentials.OAuth == nil {
		return subscriptionLogin{}, false
	}
	login := subscriptionLogin{email: state.Account.Email, subject: state.Account.ID + ":" + state.Account.Organization, token: credentials.OAuth.Token}
	if credentials.OAuth.Expires != 0 {
		login.expires = time.UnixMilli(credentials.OAuth.Expires)
	}
	return login, true
}

func codexLogin(dir string) (subscriptionLogin, bool) {
	var auth struct {
		Mode   string `json:"auth_mode"`
		Tokens *struct {
			ID      string `json:"id_token"`
			Access  string `json:"access_token"`
			Account string `json:"account_id"`
		} `json:"tokens"`
	}
	if readJSON(filepath.Join(dir, "auth.json"), &auth) != nil || auth.Tokens == nil || (auth.Mode != "" && auth.Mode != "chatgpt") {
		return subscriptionLogin{}, false
	}
	var claims struct {
		Email   string `json:"email"`
		Subject string `json:"sub"`
	}
	parts := strings.Split(auth.Tokens.ID, ".")
	if len(parts) != 3 {
		return subscriptionLogin{}, false
	}
	if payload, err := b64.DecodeString(parts[1]); err != nil || json.Unmarshal(payload, &claims) != nil {
		return subscriptionLogin{}, false
	}
	return subscriptionLogin{
		email:   claims.Email,
		subject: auth.Tokens.Account + ":" + claims.Subject,
		token:   auth.Tokens.Access,
		account: auth.Tokens.Account,
	}, true
}

// askLimits asks the agent's service for the account's weekly limits, the way its CLI does.
func askLimits(agent string, login subscriptionLogin) ([]protocol.Limit, error) {
	address := "https://chatgpt.com/backend-api/wham/usage"
	if agent == "claude" {
		address = "https://api.anthropic.com/api/oauth/usage"
	}
	request, err := http.NewRequest(http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+login.token)
	if agent == "claude" {
		request.Header.Set("Anthropic-Beta", "oauth-2025-04-20")
		request.Header.Set("User-Agent", "claude-code/2.0")
	} else {
		request.Header.Set("ChatGPT-Account-Id", login.account)
		request.Header.Set("User-Agent", "codex_cli_rs")
	}
	response, err := (&http.Client{Timeout: limitsTimeout}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return nil, errLogin
	case response.StatusCode != http.StatusOK:
		return nil, errors.New(response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var limits []protocol.Limit
	if agent == "claude" {
		limits, err = claudeLimits(data)
	} else {
		limits, err = codexLimits(data)
	}
	if err == nil && len(limits) == 0 {
		err = errors.New("no weekly limits in the reply")
	}
	return limits, err
}

func claudeLimits(data []byte) ([]protocol.Limit, error) {
	var usage struct {
		Limits []struct {
			Kind     string    `json:"kind"`
			Group    string    `json:"group"`
			Percent  float64   `json:"percent"`
			ResetsAt time.Time `json:"resets_at"`
			Active   *bool     `json:"is_active"`
			Scope    *struct {
				Model *struct {
					Name string `json:"display_name"`
				} `json:"model"`
			} `json:"scope"`
		} `json:"limits"`
	}
	if err := json.Unmarshal(data, &usage); err != nil {
		return nil, err
	}
	var limits []protocol.Limit
	for _, item := range usage.Limits {
		limit := protocol.Limit{Kind: "week", Percent: item.Percent, Window: limitsWeek.Milliseconds(), Active: item.Active == nil || *item.Active}
		switch {
		case item.Group != "weekly":
			continue
		case item.Kind == "weekly_scoped" && item.Scope != nil && item.Scope.Model != nil && item.Scope.Model.Name != "":
			limit.Kind, limit.Model = "model", item.Scope.Model.Name
		case item.Kind != "weekly_all":
			continue
		}
		if !item.ResetsAt.IsZero() {
			limit.ResetsAt = item.ResetsAt.UnixMilli()
		}
		limits = append(limits, limit)
	}
	return limits, nil
}

func codexLimits(data []byte) ([]protocol.Limit, error) {
	type window struct {
		Percent float64 `json:"used_percent"`
		Seconds int64   `json:"limit_window_seconds"`
		ResetAt int64   `json:"reset_at"`
	}
	var usage struct {
		RateLimit *struct {
			Primary   *window `json:"primary_window"`
			Secondary *window `json:"secondary_window"`
		} `json:"rate_limit"`
	}
	if err := json.Unmarshal(data, &usage); err != nil || usage.RateLimit == nil {
		return nil, err
	}
	var limits []protocol.Limit
	for _, item := range []*window{usage.RateLimit.Primary, usage.RateLimit.Secondary} {
		if item != nil && time.Duration(item.Seconds)*time.Second == limitsWeek {
			limits = append(limits, protocol.Limit{Kind: "week", Percent: item.Percent, ResetsAt: item.ResetAt * 1000, Window: limitsWeek.Milliseconds(), Active: true})
		}
	}
	return limits, nil
}

// requestLimits answers a browser with the limits known and has them read again once they are old. The caller holds
// s.mu.
func (s *Server) requestLimits(c *client) {
	if s.limits != nil {
		c.enqueue(encode(limitsMessage{"limits", s.limits}))
	}
	if s.limitsReading || time.Since(s.limitsRead) < limitsFresh {
		return
	}
	s.limitsReading = true
	go s.readLimits(s.limits)
}

// readLimits reads every account's limits and sends them to every browser. An account its service gave no limits
// for keeps the last ones, with the reason.
func (s *Server) readLimits(previous []protocol.LimitAccount) {
	agents, err := loadAgents()
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-hub: limits: %v\n", err)
	}
	now := time.Now()
	accounts := []protocol.LimitAccount{}
	for _, source := range limitSources(agents) {
		login, found := readLogin(source)
		sum := sha256.Sum256([]byte(login.subject))
		id := source.agent + ":" + hex.EncodeToString(sum[:8])
		// Two agents on one account show it once.
		if !found || slices.ContainsFunc(accounts, func(a protocol.LimitAccount) bool { return a.ID == id }) {
			continue
		}
		account := protocol.LimitAccount{ID: id, Agent: source.agent, Email: login.email, Checked: now.UnixMilli()}
		err := errLogin
		if login.expires.IsZero() || now.Before(login.expires) {
			account.Limits, err = askLimits(source.agent, login)
		}
		if err != nil {
			account.Error, account.Checked, account.Limits = "login", 0, []protocol.Limit{}
			if !errors.Is(err, errLogin) {
				account.Error = "unavailable"
				fmt.Fprintf(os.Stderr, "agent-hub: limits of %s: %v\n", source.dir, err)
			}
			if i := slices.IndexFunc(previous, func(p protocol.LimitAccount) bool { return p.ID == id }); i >= 0 {
				account.Checked, account.Limits = previous[i].Checked, previous[i].Limits
			}
		}
		accounts = append(accounts, account)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.limits, s.limitsRead, s.limitsReading = accounts, time.Now(), false
	message := encode(limitsMessage{"limits", accounts})
	for c := range s.clients {
		if c.authed {
			c.enqueue(message)
		}
	}
}
