package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"time"
)

// valueSpan finds the bytes of the value at path in JSON text.
func valueSpan(data []byte, path ...string) (start, end int, found bool) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	for depth, key := range path {
		if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
			return 0, 0, false
		}
		for {
			if !decoder.More() {
				return 0, 0, false
			}
			token, err := decoder.Token()
			if err != nil {
				return 0, 0, false
			}
			if token == key {
				break
			}
			var skipped json.RawMessage
			if decoder.Decode(&skipped) != nil {
				return 0, 0, false
			}
		}
		if depth == len(path)-1 {
			var value json.RawMessage
			if decoder.Decode(&value) != nil {
				return 0, 0, false
			}
			end = int(decoder.InputOffset())
			return end - len(value), end, true
		}
	}
	return 0, 0, false
}

func marshal(value any) []byte {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	return bytes.TrimRight(buffer.Bytes(), "\n")
}

func same(a, b zedServer) bool {
	if len(a.Args) == 0 && len(b.Args) == 0 {
		a.Args, b.Args = nil, nil
	}
	return reflect.DeepEqual(a, b)
}

// lineIndent is the whitespace that starts the line holding offset.
func lineIndent(data []byte, offset int) []byte {
	start := bytes.LastIndexByte(data[:offset], '\n') + 1
	end := start
	for end < len(data) && (data[end] == ' ' || data[end] == '\t') {
		end++
	}
	return data[start:end]
}

// indentedArray writes values one per line, as Zed writes its settings.
func indentedArray(values []string, indent []byte) []byte {
	var out bytes.Buffer
	out.WriteString("[\n")
	for i, value := range values {
		out.Write(indent)
		out.WriteString("  ")
		out.Write(marshal(value))
		if i < len(values)-1 {
			out.WriteByte(',')
		}
		out.WriteByte('\n')
	}
	out.Write(indent)
	out.WriteByte(']')
	return out.Bytes()
}

type edit struct {
	start, end int
	text       []byte
}

// wrapEntries puts every agent entry that is not yet relayed behind `agentHub relay <name>`, changing only the bytes of
// its command and args, so comments and formatting elsewhere stay as the user wrote them.
func wrapEntries(data []byte, agentHub string) ([]byte, []string, error) {
	servers, err := parseZedServers(data)
	if err != nil {
		return nil, nil, err
	}
	blanked := blankJSONC(data)
	var edits []edit
	var wrapped []string
	for name, server := range servers {
		if _, already := unwrap(server); already || server.Command == "" {
			continue
		}
		start, end, found := valueSpan(blanked, "agent_servers", name, "command")
		if !found {
			return nil, nil, fmt.Errorf("agent %q: command not found", name)
		}
		args := indentedArray(append([]string{"relay", name, server.Command}, server.Args...), lineIndent(data, start))
		edits = append(edits, edit{start, end, marshal(agentHub)})
		if argsStart, argsEnd, found := valueSpan(blanked, "agent_servers", name, "args"); found {
			edits = append(edits, edit{argsStart, argsEnd, args})
		} else {
			edits = append(edits, edit{end, end, append([]byte(`, "args": `), args...)})
		}
		wrapped = append(wrapped, name)
	}
	slices.SortFunc(edits, func(a, b edit) int { return b.start - a.start })
	result := bytes.Clone(data)
	for _, e := range edits {
		result = slices.Concat(result[:e.start], e.text, result[e.end:])
	}
	// The result must read back as the same agents, now relayed; anything else is a bug, and Zed's file stays untouched.
	after, err := parseZedServers(result)
	if err != nil {
		return nil, nil, fmt.Errorf("the edited settings do not parse: %w", err)
	}
	for name, server := range servers {
		inner, relayed := unwrap(after[name])
		if !same(after[name], server) && !(relayed && same(inner, server)) {
			return nil, nil, fmt.Errorf("agent %q did not survive the edit", name)
		}
	}
	slices.Sort(wrapped)
	return result, wrapped, nil
}

// WrapZedAgents makes every agent in Zed's settings run through an agent-hub relay, so the phone sees all of Zed's
// chats. It keeps a copy of the old file next to it and returns the agents it changed.
func WrapZedAgents(agentHub string) (wrapped []string, backup string, err error) {
	// A settings file linked from dotfiles is edited where it lives, so the link stays.
	path, err := filepath.EvalSymlinks(zedSettingsPath())
	if err != nil {
		return nil, "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	result, wrapped, err := wrapEntries(data, agentHub)
	if err != nil || len(wrapped) == 0 {
		return nil, "", err
	}
	backup = path + ".before-agent-hub-" + time.Now().Format("2006-01-02-150405")
	if err := os.WriteFile(backup, data, info.Mode().Perm()); err != nil {
		return nil, "", err
	}
	temporary := path + ".agent-hub.new"
	if err := os.WriteFile(temporary, result, info.Mode().Perm()); err != nil {
		return nil, "", err
	}
	return wrapped, backup, os.Rename(temporary, path)
}
