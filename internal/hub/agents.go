package hub

import (
	"bytes"
	"cmp"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// agentEntry is an agent from Zed's settings that the hub can start chats with, launched the way Zed launches it.
type agentEntry struct {
	name    string
	command string
	args    []string
	env     map[string]string
	// defaults is the entry's default_config_options object, kept raw for the order of its keys.
	defaults json.RawMessage
}

func zedSettingsPath() string {
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "zed", "settings.json")
}

type zedServer struct {
	Command              string            `json:"command"`
	Args                 []string          `json:"args"`
	Env                  map[string]string `json:"env"`
	DefaultConfigOptions json.RawMessage   `json:"default_config_options"`
}

func parseZedServers(data []byte) (map[string]zedServer, error) {
	var settings struct {
		AgentServers map[string]zedServer `json:"agent_servers"`
	}
	err := json.Unmarshal(blankJSONC(data), &settings)
	return settings.AgentServers, err
}

func zedServers() (map[string]zedServer, error) {
	data, err := os.ReadFile(zedSettingsPath())
	if err != nil {
		return nil, err
	}
	return parseZedServers(data)
}

// unwrap returns the agent an entry runs, looking through an agent-hub relay around it.
func unwrap(server zedServer) (zedServer, bool) {
	if filepath.Base(server.Command) != "agent-hub" || len(server.Args) < 3 || server.Args[0] != "relay" {
		return server, false
	}
	server.Command, server.Args = server.Args[2], server.Args[3:]
	return server, true
}

// ZedAgents names Zed's agent entries that run through an agent-hub relay, whose chats the phone sees live, and the rest.
func ZedAgents() (through, past []string, err error) {
	servers, err := zedServers()
	for name, server := range servers {
		if server.Command == "" {
			continue
		}
		if _, wrapped := unwrap(server); wrapped {
			through = append(through, name)
		} else {
			past = append(past, name)
		}
	}
	slices.Sort(through)
	slices.Sort(past)
	return through, past, err
}

// loadAgents reads Zed's agent entries as the agents inside their relays. An entry that copies another under a
// "· hub" name, from before entries were wrapped in place, is left out.
func loadAgents() ([]agentEntry, error) {
	servers, err := zedServers()
	if err != nil {
		return nil, err
	}
	var agents []agentEntry
	for name, server := range servers {
		if _, copied := servers[hubSuffix.ReplaceAllString(name, "")]; copied && hubSuffix.MatchString(name) {
			continue
		}
		if server, _ = unwrap(server); server.Command != "" {
			agents = append(agents, agentEntry{name, server.Command, server.Args, server.Env, server.DefaultConfigOptions})
		}
	}
	slices.SortFunc(agents, func(a, b agentEntry) int { return strings.Compare(a.name, b.name) })
	return agents, nil
}

func describeAgents(agents []agentEntry) []protocol.AgentOption {
	options := make([]protocol.AgentOption, 0, len(agents))
	for _, entry := range agents {
		label, account := describeSource(entry.name)
		options = append(options, protocol.AgentOption{ID: entry.name, Agent: agentOf(entry.name), Label: label, Account: account})
	}
	return options
}

// blankJSONC turns the comments and trailing commas that Zed's settings allow, and encoding/json does not, into spaces.
// Every byte keeps its offset, so a position found in the result is the same position in Zed's file.
func blankJSONC(data []byte) []byte {
	out := bytes.Clone(data)
	blank := func(from, to int) {
		for i := from; i < to; i++ {
			if out[i] != '\n' {
				out[i] = ' '
			}
		}
	}
	for i := 0; i < len(out); i++ {
		switch c := out[i]; {
		case c == '"':
			for i++; i < len(out) && out[i] != '"'; i++ {
				if out[i] == '\\' {
					i++
				}
			}
		case c == '/' && i+1 < len(out) && out[i+1] == '/':
			end := bytes.IndexByte(out[i:], '\n')
			if end < 0 {
				end = len(out) - i
			}
			blank(i, i+end)
			i += end
		case c == '/' && i+1 < len(out) && out[i+1] == '*':
			end := bytes.Index(out[i+2:], []byte("*/"))
			if end < 0 {
				blank(i, len(out))
				return out
			}
			blank(i, i+end+4)
			i += end + 3
		case c == ',':
			next := i + 1
			for next < len(out) && bytes.IndexByte([]byte(" \t\r\n"), out[next]) >= 0 {
				next++
			}
			if next < len(out) && (out[next] == '}' || out[next] == ']') {
				out[i] = ' '
			}
		}
	}
	return out
}

const projectLimit = 60

// projects lists git checkouts up to two levels below the roots, most recently touched first.
func projects(roots []string) []protocol.ProjectOption {
	type found struct {
		option protocol.ProjectOption
		mtime  int64
	}
	var all []found
	var visit func(dir string, depth int)
	visit = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			name := entry.Name()
			if !entry.IsDir() || strings.HasPrefix(name, ".") || name == "node_modules" {
				continue
			}
			path := filepath.Join(dir, name)
			if info, err := os.Stat(filepath.Join(path, ".git")); err == nil {
				all = append(all, found{protocol.ProjectOption{Path: path, Name: name}, info.ModTime().UnixNano()})
			} else if depth < 2 {
				visit(path, depth+1)
			}
		}
	}
	for _, root := range roots {
		visit(root, 1)
	}
	slices.SortFunc(all, func(a, b found) int { return cmp.Compare(b.mtime, a.mtime) })
	options := make([]protocol.ProjectOption, 0, min(len(all), projectLimit))
	for _, project := range all[:min(len(all), projectLimit)] {
		options = append(options, project.option)
	}
	return options
}
