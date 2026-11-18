// Package install puts agent-hub in place for the current user: the binary, cloudflared, the systemd units, the
// launcher, the GNOME top bar indicator, and a relay around each of Zed's agents. Running it again updates them.
package install

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/knaus94/agent-hub/deploy"
	"github.com/knaus94/agent-hub/internal/hub"
)

const (
	extension    = "agent-hub@knaus94"
	hubUnit      = "agent-hub.service"
	tunnelUnit   = "agent-hub-tunnel.service"
	cloudflareDL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-"
)

type paths struct {
	bin, units, apps, icons, extensions string
}

func userPaths() (paths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return paths{}, err
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return paths{}, err
	}
	data := os.Getenv("XDG_DATA_HOME")
	if data == "" {
		data = filepath.Join(home, ".local", "share")
	}
	return paths{
		bin:        filepath.Join(home, ".local", "bin"),
		units:      filepath.Join(config, "systemd", "user"),
		apps:       filepath.Join(data, "applications"),
		icons:      filepath.Join(data, "icons", "hicolor", "scalable", "apps"),
		extensions: filepath.Join(data, "gnome-shell", "extensions"),
	}, nil
}

// write replaces a file through a rename, so a running program never reads it half-written, and reports whether it changed.
func write(name string, data []byte, mode fs.FileMode) (bool, error) {
	if old, err := os.ReadFile(name); err == nil && bytes.Equal(old, data) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		return false, err
	}
	temporary := name + ".new"
	if err := os.WriteFile(temporary, data, mode); err != nil {
		return false, err
	}
	return true, os.Rename(temporary, name)
}

func systemctl(args ...string) error {
	output, err := exec.Command("systemctl", append([]string{"--user"}, args...)...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func unitState(verb, unit string) bool {
	return exec.Command("systemctl", "--user", verb, "--quiet", unit).Run() == nil
}

// Run installs everything; icon is the app's icon, the same as the web app's.
func Run(out io.Writer, icon []byte) error {
	p, err := userPaths()
	if err != nil {
		return err
	}
	agentHub := filepath.Join(p.bin, "agent-hub")
	if err := installSelf(out, agentHub); err != nil {
		return err
	}
	if err := ensureCloudflared(out, p.bin); err != nil {
		return err
	}
	current, err := installUnits(out, p, agentHub)
	if err != nil {
		return err
	}
	if err := installLauncher(out, p, agentHub, icon); err != nil {
		return err
	}
	if err := installIndicator(out, p); err != nil {
		return err
	}
	// An older hub leaves wrapped entries out of the agents a new chat offers, so Zed is wrapped only for this build.
	if !current {
		fmt.Fprintln(out, "Zed agents not wrapped yet: run agent-hub install again after the hub restarts")
		reportZed(out)
		return nil
	}
	wrapped, backup, err := hub.WrapZedAgents(agentHub)
	switch {
	case err != nil:
		fmt.Fprintf(out, "Zed settings left as they were: %v\n", err)
	case len(wrapped) > 0:
		fmt.Fprintf(out, "Zed agents now run through agent-hub: %s; the old settings are in %s\n", list(wrapped), backup)
	}
	reportZed(out)
	return nil
}

func installSelf(out io.Writer, target string) error {
	self, err := os.Executable()
	if err == nil {
		self, err = filepath.EvalSymlinks(self)
	}
	if err != nil {
		return err
	}
	if self == target {
		return nil
	}
	data, err := os.ReadFile(self)
	if err != nil {
		return err
	}
	// Zed starts relays from this path; running relays keep the binary they started with.
	if changed, err := write(target, data, 0o755); err != nil || !changed {
		return err
	}
	fmt.Fprintf(out, "installed %s\n", target)
	return nil
}

func ensureCloudflared(out io.Writer, bin string) error {
	if _, err := exec.LookPath("cloudflared"); err == nil {
		return nil
	}
	target := filepath.Join(bin, "cloudflared")
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return fmt.Errorf("install cloudflared for %s yourself", runtime.GOARCH)
	}
	fmt.Fprintf(out, "downloading cloudflared from github.com/cloudflare/cloudflared\n")
	client := http.Client{Timeout: 5 * time.Minute}
	response, err := client.Get(cloudflareDL + runtime.GOARCH)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cloudflared download: %s", response.Status)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if _, err := write(target, data, 0o755); err != nil {
		return err
	}
	fmt.Fprintf(out, "installed %s\n", target)
	return nil
}

// installUnits reports whether the hub now runs the installed build.
func installUnits(out io.Writer, p paths, agentHub string) (bool, error) {
	for _, unit := range []string{hubUnit, tunnelUnit} {
		template, err := deploy.Files.ReadFile(path.Join("systemd", unit))
		if err != nil {
			return false, err
		}
		changed, err := write(filepath.Join(p.units, unit), bytes.ReplaceAll(template, []byte("@AGENT_HUB@"), []byte(agentHub)), 0o644)
		if err != nil {
			return false, err
		}
		if changed {
			fmt.Fprintf(out, "installed %s\n", filepath.Join(p.units, unit))
		}
	}
	if err := systemctl("daemon-reload"); err != nil {
		return false, err
	}
	// The hub starts at login and listens on this computer only. The tunnel is left as it was: on a first install it
	// starts only from the launcher or `agent-hub up`, and a running one is not restarted, which would change its address.
	if err := systemctl("enable", hubUnit); err != nil {
		return false, err
	}
	return RestartHub(out)
}

// RestartHub makes the hub run the installed build and the saved config, unless that would end chats: it reports
// whether the hub now does.
func RestartHub(out io.Writer) (bool, error) {
	if !unitState("is-active", hubUnit) {
		fmt.Fprintln(out, "starting the hub")
		return true, systemctl("start", hubUnit)
	}
	if chats := webChats(); chats > 0 {
		fmt.Fprintf(out, "the hub runs %d chat(s) started from the web; restart it yourself when they are done: systemctl --user restart %s\n", chats, hubUnit)
		return false, nil
	}
	fmt.Fprintln(out, "restarting the hub")
	return true, systemctl("restart", hubUnit)
}

// webChats counts the agent processes the running hub started; restarting the hub ends them. They are found by their
// parent in /proc/*/stat: a Go program forks from any of its threads, so one thread's children list misses them.
func webChats() int {
	output, err := exec.Command("systemctl", "--user", "show", "-p", "MainPID", "--value", hubUnit).Output()
	if err != nil {
		return 0
	}
	hub := strings.TrimSpace(string(output))
	stats, _ := filepath.Glob("/proc/[0-9]*/stat")
	count := 0
	for _, name := range stats {
		data, err := os.ReadFile(name)
		// The process name sits in parentheses and may contain spaces; the parent's pid is the second field after it.
		if index := bytes.LastIndexByte(data, ')'); err == nil && index >= 0 {
			if fields := strings.Fields(string(data[index+1:])); len(fields) > 1 && fields[1] == hub {
				count++
			}
		}
	}
	return count
}

func installLauncher(out io.Writer, p paths, agentHub string, icon []byte) error {
	template, err := deploy.Files.ReadFile("agent-hub.desktop")
	if err != nil {
		return err
	}
	entry := filepath.Join(p.apps, "agent-hub.desktop")
	changed, err := write(entry, bytes.ReplaceAll(template, []byte("@AGENT_HUB@"), []byte(agentHub)), 0o644)
	if err != nil {
		return err
	}
	iconChanged, err := write(filepath.Join(p.icons, "agent-hub.svg"), icon, 0o644)
	if err != nil {
		return err
	}
	if changed || iconChanged {
		fmt.Fprintf(out, "installed the launcher %s\n", entry)
	}
	return nil
}

func installIndicator(out io.Writer, p paths) error {
	if _, err := exec.LookPath("gnome-shell"); err != nil {
		return nil
	}
	target := filepath.Join(p.extensions, extension)
	// An earlier setup linked the extension from a checkout; it becomes a copy owned by this install.
	if info, err := os.Lstat(target); err == nil && info.Mode()&fs.ModeSymlink != 0 {
		if err := os.Remove(target); err != nil {
			return err
		}
	}
	root := path.Join("gnome-shell", extension)
	changed := false
	err := fs.WalkDir(deploy.Files, root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := deploy.Files.ReadFile(name)
		if err != nil {
			return err
		}
		wrote, err := write(filepath.Join(target, strings.TrimPrefix(name, root+"/")), data, 0o644)
		changed = changed || wrote
		return err
	})
	if err != nil {
		return err
	}
	enabled, err := enableExtension()
	if err != nil {
		return err
	}
	if changed || enabled {
		fmt.Fprintf(out, "installed the top bar indicator %s; GNOME loads it at the next login\n", target)
	}
	return nil
}

// enableExtension adds the indicator to GNOME's enabled extensions, which a running Wayland session cannot do for an
// extension it has not loaded yet.
func enableExtension() (bool, error) {
	output, err := exec.Command("gsettings", "get", "org.gnome.shell", "enabled-extensions").Output()
	if err != nil {
		return false, err
	}
	list := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(output)), "@as"))
	if strings.Contains(list, "'"+extension+"'") {
		return false, nil
	}
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(list, "["), "]"))
	if inner != "" {
		inner += ", "
	}
	value := "[" + inner + "'" + extension + "']"
	if output, err := exec.Command("gsettings", "set", "org.gnome.shell", "enabled-extensions", value).CombinedOutput(); err != nil {
		return false, errors.New(strings.TrimSpace(string(output)))
	}
	return true, nil
}

func reportZed(out io.Writer) {
	through, past, err := hub.ZedAgents()
	if err != nil {
		fmt.Fprintf(out, "Zed settings: %v\n", err)
		return
	}
	fmt.Fprintf(out, "Zed agents seen live from the phone: %s\n", list(through))
	if len(past) > 0 {
		fmt.Fprintf(out, "Zed agents not going through agent-hub: %s\n", list(past))
	}
}

func list(names []string) string {
	if len(names) == 0 {
		return "none"
	}
	return strings.Join(names, ", ")
}
