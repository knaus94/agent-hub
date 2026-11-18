package hub

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	archiveFile = "archive.json"
	// zedPoll is how often the hub looks at which chats Zed has archived.
	zedPoll = 5 * time.Second
	// turnWait is how often the hub looks whether a turn has ended before closing its chat.
	turnWait = time.Second
	// archiveGrace leaves time to take back an archive tapped by mistake before the chat's agent is closed.
	archiveGrace = 10 * time.Second
)

func (s *Server) loadArchive() {
	var ids []string
	if err := readJSON(filepath.Join(s.config.Home, archiveFile), &ids); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(os.Stderr, "agent-hub: %s: %v\n", archiveFile, err)
	}
	s.timeline.RestoreArchive(ids)
}

func (s *Server) followZedArchive() {
	for {
		archived, err := s.zed.archived()
		switch {
		case err == nil:
			s.withTimeline(func(t *Timeline) { t.SetZedArchived(archived) })
		case !errors.Is(err, errNoZed):
			fmt.Fprintf(os.Stderr, "agent-hub: Zed's thread list: %v\n", err)
		}
		time.Sleep(zedPoll)
	}
}

// archive archives or restores a chat here and in Zed. A chat the hub's own agent process holds is closed with it,
// and the process stops once it holds no chat, since each takes hundreds of megabytes.
func (s *Server) archive(sessionID string, archived bool) {
	if !s.timeline.Archive(sessionID, archived) {
		return
	}
	go func() {
		// The list is taken when it is written, so of two quick changes the later one is what stays on disk.
		s.archiveMu.Lock()
		var ids []string
		s.withTimeline(func(t *Timeline) { ids = t.ArchivedHere() })
		if err := writeJSON(filepath.Join(s.config.Home, archiveFile), ids); err != nil {
			fmt.Fprintf(os.Stderr, "agent-hub: %s: %v\n", archiveFile, err)
		}
		s.archiveMu.Unlock()
		if err := s.zed.setArchived(sessionID, archived); err != nil && !errors.Is(err, errNoZed) {
			fmt.Fprintf(os.Stderr, "agent-hub: archive in Zed: %v\n", err)
		}
		if archived {
			time.Sleep(archiveGrace)
			s.releaseArchived(sessionID)
		}
	}()
}

// releaseArchived closes the hub's copy of an archived chat once its turn, if one runs, has ended, unless the chat has
// been restored meanwhile.
func (s *Server) releaseArchived(sessionID string) {
	for {
		var target *Target
		archived := false
		s.withTimeline(func(t *Timeline) {
			target = t.Find(sessionID)
			archived = t.IsArchived(sessionID)
		})
		if !archived {
			return
		}
		if target == nil || !target.Running {
			s.release(sessionID)
			return
		}
		time.Sleep(turnWait)
	}
}

// handOver gives a chat begun in the web app to Zed, which has just loaded it: the hub's copy stops its turn at once,
// since nobody sees it any more, and closes.
func (s *Server) handOver(sessionID string) {
	s.ownedMu.Lock()
	process := s.ownedSessions[sessionID]
	s.ownedMu.Unlock()
	if process == nil {
		return
	}
	_ = process.send(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": sessionID}})
	s.release(sessionID)
}

// release closes a chat in the hub's agent process that holds it, and stops the process if that was its last chat.
func (s *Server) release(sessionID string) {
	s.ownedMu.Lock()
	process := s.ownedSessions[sessionID]
	if process == nil {
		s.ownedMu.Unlock()
		return
	}
	delete(s.ownedSessions, sessionID)
	process.sessions--
	idle := process.sessions == 0
	if idle {
		for key, running := range s.processes {
			if running == process {
				delete(s.processes, key)
			}
		}
	}
	s.ownedMu.Unlock()
	_, _ = process.request("session/close", map[string]any{"sessionId": sessionID})
	if idle {
		process.stop()
	}
}
