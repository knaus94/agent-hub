package hub

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// zedThreads is the list of agent threads Zed's sidebar shows, in Zed's own database. The hub adds the chats begun in
// the web app to it and shares the archive with it. Zed reads the list only when it starts, and writes a thread's
// row from memory whenever the thread changes, so what the hub writes reaches Zed at its next start.
type zedThreads struct {
	path string
}

func newZedThreads() zedThreads {
	data := os.Getenv("XDG_DATA_HOME")
	if data == "" {
		home, _ := os.UserHomeDir()
		data = filepath.Join(home, ".local", "share")
	}
	return zedThreads{filepath.Join(data, "zed", "db", "0-stable", "db.sqlite")}
}

var errNoZed = errors.New("no Zed database")

func (z zedThreads) open() (*sql.DB, error) {
	if _, err := os.Stat(z.path); errors.Is(err, fs.ErrNotExist) {
		return nil, errNoZed
	}
	// mode=rw: the file is Zed's to create. Zed writes it at the same time, so a busy database is waited for.
	return sql.Open("sqlite", "file:"+z.path+"?mode=rw&_pragma=busy_timeout(5000)")
}

// archived lists the sessions Zed has archived.
func (z zedThreads) archived() (map[string]bool, error) {
	db, err := z.open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query("SELECT session_id FROM sidebar_threads WHERE session_id IS NOT NULL AND archived = 1")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	archived := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		archived[id] = true
	}
	return archived, rows.Err()
}

func (z zedThreads) setArchived(sessionID string, archived bool) error {
	db, err := z.open()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec("UPDATE sidebar_threads SET archived = ? WHERE session_id = ?", archived, sessionID)
	return err
}

// zedTime is how Zed writes a time: RFC 3339 with nanoseconds and an explicit offset.
func zedTime(at time.Time) string {
	return at.UTC().Format("2006-01-02T15:04:05.000000000-07:00")
}

// add lists a chat in Zed's sidebar unless it is there already, as Zed lists a thread it starts.
func (z zedThreads) add(sessionID, agent, title, cwd string, at time.Time) error {
	db, err := z.open()
	if err != nil {
		return err
	}
	defer db.Close()
	// A thread is a version 4 UUID in Zed.
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	id[6] = id[6]&0x0f | 0x40
	id[8] = id[8]&0x3f | 0x80
	now := zedTime(at)
	_, err = db.Exec(`INSERT INTO sidebar_threads(thread_id, session_id, agent_id, title, updated_at, created_at, interacted_at,
			folder_paths, folder_paths_order, archived, main_worktree_paths, main_worktree_paths_order)
		SELECT ?, ?, ?, ?, ?, ?, ?, ?, '0', 0, ?, '0'
		WHERE NOT EXISTS (SELECT 1 FROM sidebar_threads WHERE session_id = ?)`,
		id, sessionID, agent, title, now, now, now, cwd, cwd, sessionID)
	return err
}
