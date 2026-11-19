package hub

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Markdown files of a chat's project, for reading the plans and briefs its agent writes. Only Markdown inside the
// directory the chat works in is served; os.Root keeps symbolic links and ".." from leading out of it.

const fileLimit = 1 << 20

type fileMessage struct {
	Type      string  `json:"type"`
	SessionID string  `json:"sessionId"`
	Path      string  `json:"path"`
	Text      *string `json:"text"`
	// Error is "missing", "denied" (not Markdown, or outside the project) or "large".
	Error *string `json:"error"`
}

// sendFile answers a browser with a Markdown file of a chat's project. The caller holds s.mu.
func (s *Server) sendFile(c *client, sessionID, path string) {
	cwd := s.timeline.Cwd(sessionID)
	go func() {
		message := fileMessage{Type: "file", SessionID: sessionID, Path: path}
		if text, code := readMarkdown(cwd, path); code != "" {
			message.Error = &code
		} else {
			message.Text = &text
		}
		c.enqueue(encode(message))
	}()
}

// readMarkdown reads a Markdown file by its path in the project, its absolute path or one from the home directory; the
// error is the code to show.
func readMarkdown(cwd, path string) (string, string) {
	extension := strings.ToLower(filepath.Ext(path))
	if cwd == "" || (extension != ".md" && extension != ".markdown") {
		return "", "denied"
	}
	if rest, found := strings.CutPrefix(path, "~/"); found {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, rest)
	}
	if filepath.IsAbs(path) {
		relative, err := filepath.Rel(cwd, path)
		if err != nil {
			return "", "denied"
		}
		path = relative
	}
	root, err := os.OpenRoot(cwd)
	if err != nil {
		return "", "missing"
	}
	defer root.Close()
	// A named pipe would hold the read forever; only a regular file is opened.
	info, err := root.Stat(path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "", "missing"
	case err != nil:
		return "", "denied"
	case !info.Mode().IsRegular():
		return "", "missing"
	case info.Size() > fileLimit:
		return "", "large"
	}
	file, err := root.Open(path)
	if err != nil {
		return "", "missing"
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, fileLimit+1))
	switch {
	case err != nil:
		return "", "missing"
	case len(data) > fileLimit:
		return "", "large"
	}
	return string(data), ""
}
