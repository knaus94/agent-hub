package hub

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"

	"github.com/knaus94/agent-hub/internal/relay"
)

// Config is where the hub listens, where relays put their sockets, and the login token kept in the user's config dir.
type Config struct {
	// Home holds config.json and the login state next to it.
	Home           string
	Token          string
	Host           string
	Port           int
	RelayDir       string
	AllowedHosts   []string
	AllowedOrigins []string
	// Address is the hub's own hostname on the user's Cloudflare domain; without one the tunnel's address is anonymous
	// and changes on every start.
	Address string
	// Voice is where speech from the web app is recognised; nil leaves voice input off.
	Voice *VoiceConfig
	// ProjectRoots hold the git checkouts a new chat can start in.
	ProjectRoots []string
}

type stored struct {
	Token          string       `json:"token,omitempty"`
	Address        string       `json:"address,omitempty"`
	Voice          *VoiceConfig `json:"voice,omitempty"`
	AllowedHosts   []string     `json:"allowedHosts,omitempty"`
	AllowedOrigins []string     `json:"allowedOrigins,omitempty"`
	ProjectRoots   []string     `json:"projectRoots,omitempty"`
}

// HomeDir is the hub's own directory in the user's config dir, or AGENT_HUB_HOME.
func HomeDir() (string, error) {
	home := os.Getenv("AGENT_HUB_HOME")
	if home == "" {
		configDir, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		home = filepath.Join(configDir, "agent-hub")
	}
	return home, os.MkdirAll(home, 0o700)
}

func readStored(path string) (stored, error) {
	var saved stored
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return saved, nil
	}
	if err != nil {
		return saved, err
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		return saved, fmt.Errorf("%s: %w", path, err)
	}
	return saved, nil
}

func writeStored(path string, saved stored) error {
	data, _ := json.MarshalIndent(saved, "", "   ")
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

// SaveVoice records where speech is recognised, or turns voice input off with nil; the hub takes it up when it next
// starts.
func SaveVoice(voice *VoiceConfig) error {
	home, err := HomeDir()
	if err != nil {
		return err
	}
	path := filepath.Join(home, "config.json")
	saved, err := readStored(path)
	if err != nil {
		return err
	}
	saved.Voice = voice
	return writeStored(path, saved)
}

// SaveAddress records the hub's own hostname; the hub and its tunnel take it up when they next start.
func SaveAddress(address string) error {
	home, err := HomeDir()
	if err != nil {
		return err
	}
	path := filepath.Join(home, "config.json")
	saved, err := readStored(path)
	if err != nil {
		return err
	}
	saved.Address = address
	return writeStored(path, saved)
}

func LoadConfig() (Config, error) {
	home, err := HomeDir()
	if err != nil {
		return Config{}, err
	}
	path := filepath.Join(home, "config.json")
	saved, err := readStored(path)
	if err != nil {
		return Config{}, err
	}
	if saved.Token == "" {
		secret := make([]byte, 24)
		if _, err := rand.Read(secret); err != nil {
			return Config{}, err
		}
		saved.Token = base64.RawURLEncoding.EncodeToString(secret)
		if err := writeStored(path, saved); err != nil {
			return Config{}, err
		}
	}

	relayDir := os.Getenv("AGENT_HUB_RELAY_DIR")
	if relayDir == "" {
		if relayDir, err = relay.SocketDir(); err != nil {
			return Config{}, fmt.Errorf("%w; set AGENT_HUB_RELAY_DIR", err)
		}
	}
	port := 8790
	if value := os.Getenv("AGENT_HUB_PORT"); value != "" {
		if port, err = strconv.Atoi(value); err != nil {
			return Config{}, fmt.Errorf("AGENT_HUB_PORT: %w", err)
		}
	}
	projectRoots := saved.ProjectRoots
	if len(projectRoots) == 0 {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return Config{}, err
		}
		projectRoots = []string{filepath.Join(homeDir, "github")}
	}
	host := os.Getenv("AGENT_HUB_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	// Without an address of its own the tunnel gets a new *.trycloudflare.com name on every start.
	allowedHosts := append([]string{fmt.Sprintf("127.0.0.1:%d", port), fmt.Sprintf("localhost:%d", port), "*.trycloudflare.com"}, saved.AllowedHosts...)
	if saved.Address != "" {
		allowedHosts = append(allowedHosts, saved.Address)
	}
	return Config{
		Home:           home,
		Token:          saved.Token,
		Host:           host,
		Port:           port,
		RelayDir:       relayDir,
		AllowedHosts:   allowedHosts,
		AllowedOrigins: saved.AllowedOrigins,
		Address:        saved.Address,
		Voice:          saved.Voice,
		ProjectRoots:   projectRoots,
	}, nil
}
