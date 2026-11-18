// Package ctl sends one command to a relay's control socket and prints the reply.
package ctl

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/knaus94/agent-hub/internal/relay"
)

const Usage = `usage: agent-hub ctl list
       agent-hub ctl <relay> sessions
       agent-hub ctl <relay> prompt <sessionId|last> <text> [--echo]
       agent-hub ctl <relay> steer <sessionId|last> <text> [--echo] [--prompt-required]
       agent-hub ctl <relay> cancel <sessionId|last>

<relay> is a socket path, a socket file name, or an agent name prefix such as codex-acp-hub
(the newest matching socket wins). "last" is the session the relay saw created or opened most recently.`

func Run(args []string, out io.Writer) error {
	dir, err := relay.SocketDir()
	if err != nil {
		return err
	}
	flags := map[string]bool{}
	var words []string
	for _, arg := range args {
		if strings.HasPrefix(arg, "--") {
			flags[arg] = true
		} else {
			words = append(words, arg)
		}
	}
	if len(words) == 1 && words[0] == "list" {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".sock") {
				fmt.Fprintln(out, entry.Name())
			}
		}
		return nil
	}
	if len(words) < 2 {
		return errors.New(Usage)
	}
	socket, err := resolve(dir, words[0])
	if err != nil {
		return err
	}
	op := words[1]
	sessionID, text := "", ""
	if len(words) > 2 {
		sessionID = words[2]
	}
	if len(words) > 3 {
		text = words[3]
	}
	if op != "sessions" && sessionID == "last" {
		if sessionID, err = lastSession(socket, words[0]); err != nil {
			return err
		}
	}
	reply, err := send(socket, map[string]any{
		"op": op, "sessionId": sessionID, "text": text, "echo": flags["--echo"], "promptRequired": flags["--prompt-required"],
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(out, string(reply))
	return err
}

func resolve(dir, target string) (string, error) {
	if strings.Contains(target, "/") {
		return target, nil
	}
	if strings.HasSuffix(target, ".sock") {
		return filepath.Join(dir, target), nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	type candidate struct {
		path  string
		mtime int64
	}
	var matches []candidate
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, target+"-") || !strings.HasSuffix(name, ".sock") {
			continue
		}
		if info, err := entry.Info(); err == nil {
			matches = append(matches, candidate{filepath.Join(dir, name), info.ModTime().UnixNano()})
		}
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no relay socket for %s: open a chat with this agent in Zed first", target)
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].mtime > matches[j].mtime })
	return matches[0].path, nil
}

func lastSession(socket, target string) (string, error) {
	reply, err := send(socket, map[string]string{"op": "sessions"})
	if err != nil {
		return "", err
	}
	var listed struct {
		Result []struct {
			SessionID string `json:"sessionId"`
		} `json:"result"`
	}
	if err := json.Unmarshal(reply, &listed); err != nil {
		return "", err
	}
	if len(listed.Result) == 0 {
		return "", fmt.Errorf("relay %s has no sessions yet", target)
	}
	return listed.Result[len(listed.Result)-1].SessionID, nil
}

func send(socket string, command any) ([]byte, error) {
	conn, err := net.Dial("unix", socket)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	line, _ := json.Marshal(command)
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return nil, err
	}
	reply, err := bufio.NewReader(conn).ReadBytes('\n')
	return []byte(strings.TrimSpace(string(reply))), err
}
