// Package remote turns the public addresses on and off: the hub's own tunnel, and open tunnels to local ports such as
// a dev server. Each runs as a user systemd unit, so it outlives the command that started it.
package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/knaus94/agent-hub/internal/hub"
)

const (
	hubUnit     = "agent-hub.service"
	tunnelUnit  = "agent-hub-tunnel.service"
	sharePrefix = "agent-hub-share-"
	// The hub's tunnel runs cloudflared with --metrics on this address.
	metrics     = "127.0.0.1:20241"
	tunnelName  = "agent-hub"
	addressWait = 30 * time.Second
	publishWait = 3 * time.Minute
	pollEvery   = 500 * time.Millisecond
	publicDNS   = "1.1.1.1:53"
)

var quickAddress = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

type Share struct {
	Port int    `json:"port"`
	URL  string `json:"url"`
}

type Status struct {
	// Hub is on while the hub's tunnel runs; URL is its public address once Cloudflare has given one.
	Hub    bool    `json:"hub"`
	URL    string  `json:"url"`
	Shares []Share `json:"shares"`
}

func systemctl(args ...string) (string, error) {
	output, err := exec.Command("systemctl", append([]string{"--user"}, args...)...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func active(unit string) bool {
	return exec.Command("systemctl", "--user", "is-active", "--quiet", unit).Run() == nil
}

// hubAddress is the hub's public address once its tunnel serves it: the user's own hostname when the tunnel has
// connected, or the anonymous one Cloudflare gave this run.
func hubAddress() string {
	config, err := hub.LoadConfig()
	if err != nil {
		return ""
	}
	client := http.Client{Timeout: time.Second}
	if config.Address != "" {
		response, err := client.Get("http://" + metrics + "/ready")
		if err != nil {
			return ""
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return ""
		}
		return "https://" + config.Address
	}
	response, err := client.Get("http://" + metrics + "/quicktunnel")
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	var answer struct {
		Hostname string `json:"hostname"`
	}
	if json.NewDecoder(response.Body).Decode(&answer) != nil || answer.Hostname == "" {
		return ""
	}
	return "https://" + answer.Hostname
}

// RunTunnel becomes the cloudflared that makes the hub public; the tunnel unit runs it.
func RunTunnel() error {
	config, err := hub.LoadConfig()
	if err != nil {
		return err
	}
	binary, err := cloudflared()
	if err != nil {
		return err
	}
	local := fmt.Sprintf("http://127.0.0.1:%d", config.Port)
	args := []string{binary, "tunnel", "--no-autoupdate", "--metrics", metrics}
	if config.Address == "" {
		args = append(args, "--url", local)
	} else {
		args = append(args, "run", "--url", local, tunnelName)
	}
	return syscall.Exec(binary, args, os.Environ())
}

var hostname = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$`)

// SetDomain gives the hub a permanent address on a domain of the Cloudflare account `cloudflared tunnel login` opened:
// a named tunnel and a DNS record for host. Open ports keep their anonymous addresses.
func SetDomain(host string) error {
	if !hostname.MatchString(host) {
		return fmt.Errorf("%q is not a hostname", host)
	}
	binary, err := cloudflared()
	if err != nil {
		return err
	}
	if err := ensureTunnel(binary); err != nil {
		return err
	}
	routed, err := exec.Command(binary, "tunnel", "route", "dns", tunnelName, host).CombinedOutput()
	if err != nil {
		return fmt.Errorf("cloudflared tunnel route dns: %w: %s", err, strings.TrimSpace(string(routed)))
	}
	// The login covers one domain, and a name outside it is created under that domain instead of failing.
	for deadline := time.Now().Add(publishWait); !published(host); time.Sleep(pollEvery) {
		if time.Now().After(deadline) {
			return fmt.Errorf("%s does not resolve; cloudflared said: %s", host, strings.TrimSpace(string(routed)))
		}
	}
	if err := hub.SaveAddress(host); err != nil {
		return err
	}
	_, err = systemctl("try-restart", tunnelUnit)
	return err
}

// ensureTunnel creates the named tunnel unless this computer already holds its credentials.
func ensureTunnel(binary string) error {
	listed, err := exec.Command(binary, "tunnel", "list", "--name", tunnelName, "--output", "json").Output()
	if err != nil {
		return fmt.Errorf("cloudflared tunnel list: %w; run `cloudflared tunnel login` first", err)
	}
	var tunnels []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(listed, &tunnels); err != nil {
		return fmt.Errorf("cloudflared tunnel list: %w", err)
	}
	if len(tunnels) == 0 {
		created, err := exec.Command(binary, "tunnel", "create", tunnelName).CombinedOutput()
		if err != nil {
			return fmt.Errorf("cloudflared tunnel create: %w: %s", err, strings.TrimSpace(string(created)))
		}
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(home, ".cloudflared", tunnels[0].ID+".json")); err != nil {
		return fmt.Errorf("the Cloudflare account already has a tunnel named %s, made on another computer; delete it there first", tunnelName)
	}
	return nil
}

// shareAddress reads the address cloudflared printed in this run of the unit, not in an earlier one.
func shareAddress(unit string) string {
	invocation, err := systemctl("show", "-p", "InvocationID", "--value", unit)
	if err != nil || invocation == "" {
		return ""
	}
	output, err := exec.Command("journalctl", "--user", "-u", unit, "_SYSTEMD_INVOCATION_ID="+invocation, "-o", "cat", "--no-pager").Output()
	if err != nil {
		return ""
	}
	return quickAddress.FindString(string(output))
}

// waitFor returns the address once public DNS knows it: Cloudflare publishes a new quick tunnel's name a minute or two
// after it starts, and a phone that asks earlier can remember the miss for a long while.
func waitFor(address func() string) (string, error) {
	found := ""
	for deadline := time.Now().Add(addressWait); found == "" && time.Now().Before(deadline); time.Sleep(pollEvery) {
		found = address()
	}
	if found == "" {
		return "", errors.New("Cloudflare gave no address in time; see journalctl --user -e")
	}
	for deadline := time.Now().Add(publishWait); !published(found) && time.Now().Before(deadline); time.Sleep(pollEvery) {
	}
	return found, nil
}

func published(address string) bool {
	resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, publicDNS)
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	hosts, err := resolver.LookupHost(ctx, strings.TrimPrefix(address, "https://"))
	return err == nil && len(hosts) > 0
}

// Up starts the hub and its tunnel and returns the public address.
func Up() (string, error) {
	if _, err := systemctl("start", hubUnit, tunnelUnit); err != nil {
		return "", err
	}
	return waitFor(hubAddress)
}

// Down closes every public address; the hub keeps running for this computer.
func Down() error {
	shares, err := shareUnits()
	if err != nil {
		return err
	}
	_, err = systemctl(append([]string{"stop", tunnelUnit}, shares...)...)
	return err
}

func ParsePort(text string) (int, error) {
	port, err := strconv.Atoi(text)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("not a port: %q", text)
	}
	return port, nil
}

func shareUnit(port int) string {
	return fmt.Sprintf("%s%d.service", sharePrefix, port)
}

func cloudflared() (string, error) {
	if path, err := exec.LookPath("cloudflared"); err == nil {
		return path, nil
	}
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	path := filepath.Join(filepath.Dir(self), "cloudflared")
	if _, err := os.Stat(path); err != nil {
		return "", errors.New("cloudflared is not installed")
	}
	return path, nil
}

// Open gives a local port an open public address: anyone with the link reaches it, with no login.
func Open(port int) (string, error) {
	unit := shareUnit(port)
	if !active(unit) {
		binary, err := cloudflared()
		if err != nil {
			return "", err
		}
		local := fmt.Sprintf("localhost:%d", port)
		// Dev servers such as Vite refuse an unknown Host, so the request arrives addressed to localhost.
		output, err := exec.Command("systemd-run", "--user", "--quiet", "--collect", "--unit="+unit,
			fmt.Sprintf("--description=agent-hub: open public address for port %d", port),
			binary, "tunnel", "--no-autoupdate", "--url", "http://"+local, "--http-host-header", local).CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("systemd-run: %w: %s", err, strings.TrimSpace(string(output)))
		}
	}
	return waitFor(func() string { return shareAddress(unit) })
}

func Close(port int) error {
	_, err := systemctl("stop", shareUnit(port))
	return err
}

func shareUnits() ([]string, error) {
	output, err := systemctl("list-units", "--plain", "--no-legend", "--state=active", sharePrefix+"*")
	if err != nil {
		return nil, err
	}
	var units []string
	for line := range strings.Lines(output) {
		if fields := strings.Fields(line); len(fields) > 0 {
			units = append(units, fields[0])
		}
	}
	return units, nil
}

func GetStatus() (Status, error) {
	status := Status{Hub: active(tunnelUnit), Shares: []Share{}}
	if status.Hub {
		status.URL = hubAddress()
	}
	units, err := shareUnits()
	if err != nil {
		return status, err
	}
	for _, unit := range units {
		port, err := ParsePort(strings.TrimSuffix(strings.TrimPrefix(unit, sharePrefix), ".service"))
		if err == nil {
			status.Shares = append(status.Shares, Share{port, shareAddress(unit)})
		}
	}
	slices.SortFunc(status.Shares, func(a, b Share) int { return a.Port - b.Port })
	return status, nil
}
