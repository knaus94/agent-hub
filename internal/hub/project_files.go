package hub

import (
	"cmp"
	"io/fs"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// Files of a chat's project to link to from a message, offered as Zed's @ offers them: those git keeps or would keep,
// or outside git those found under the directory, past hidden, dependency and build directories.
const (
	projectFilesShown = 30
	projectFilesMax   = 50000
	// Every key typed after @ asks again; a list this fresh is used instead of reading the project again.
	projectFilesFresh = 30 * time.Second
)

var skippedDirs = map[string]bool{"node_modules": true, "vendor": true, "dist": true, "build": true, "target": true, "__pycache__": true}

type projectFilesMessage struct {
	Type      string   `json:"type"`
	SessionID string   `json:"sessionId"`
	Query     string   `json:"query"`
	Paths     []string `json:"paths"`
}

type projectList struct {
	files []string
	read  time.Time
}

type projectLists struct {
	mu    sync.Mutex
	lists map[string]projectList
}

// sendProjectFiles answers a browser with the files of a chat's project that match what follows the @. The caller
// holds s.mu.
func (s *Server) sendProjectFiles(c *client, sessionID, query string) {
	cwd := s.timeline.Cwd(sessionID)
	go func() {
		paths := []string{}
		if cwd != "" {
			paths = matchFiles(s.projectFiles.of(cwd), query)
		}
		c.enqueue(encode(projectFilesMessage{"project-files", sessionID, query, paths}))
	}()
}

func (p *projectLists) of(cwd string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if list, found := p.lists[cwd]; found && time.Since(list.read) < projectFilesFresh {
		return list.files
	}
	files := listProject(cwd)
	p.lists[cwd] = projectList{files, time.Now()}
	return files
}

func listProject(cwd string) []string {
	if out, err := exec.Command("git", "-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard").Output(); err == nil {
		files := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
		return slices.DeleteFunc(files[:min(len(files), projectFilesMax)], func(file string) bool { return file == "" })
	}
	var files []string
	_ = filepath.WalkDir(cwd, func(path string, entry fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return nil
		case entry.IsDir() && path != cwd && (strings.HasPrefix(entry.Name(), ".") || skippedDirs[entry.Name()]):
			return filepath.SkipDir
		case entry.Type().IsRegular():
			relative, _ := filepath.Rel(cwd, path)
			files = append(files, relative)
			if len(files) >= projectFilesMax {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return files
}

// matchFiles puts first the files whose name starts with the query, then those whose name or path holds it, then
// those whose path holds its letters in order; shorter paths first within each.
func matchFiles(files []string, query string) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	type scored struct {
		path  string
		score int
	}
	var found []scored
	for _, file := range files {
		lower := strings.ToLower(file)
		name := filepath.Base(lower)
		score := -1
		switch {
		case strings.HasPrefix(name, query):
			score = 0
		case strings.Contains(name, query):
			score = 1
		case strings.Contains(lower, query):
			score = 2
		case inOrder(lower, query):
			score = 3
		}
		if score >= 0 {
			found = append(found, scored{file, score})
		}
	}
	slices.SortStableFunc(found, func(a, b scored) int {
		return cmp.Or(a.score-b.score, len(a.path)-len(b.path), strings.Compare(a.path, b.path))
	})
	paths := make([]string, 0, min(len(found), projectFilesShown))
	for _, match := range found[:min(len(found), projectFilesShown)] {
		paths = append(paths, match.path)
	}
	return paths
}

func inOrder(text, letters string) bool {
	for _, letter := range letters {
		index := strings.IndexRune(text, letter)
		if index < 0 {
			return false
		}
		text = text[index+len(string(letter)):]
	}
	return true
}
