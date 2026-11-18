// agent-hub relays Zed's agent chats to a web app: `relay` runs in each Zed agent entry, `serve` runs the hub.
package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/knaus94/agent-hub/internal/ctl"
	"github.com/knaus94/agent-hub/internal/hub"
	"github.com/knaus94/agent-hub/internal/install"
	"github.com/knaus94/agent-hub/internal/relay"
	"github.com/knaus94/agent-hub/internal/remote"
	"github.com/knaus94/agent-hub/web"
)

const usage = `usage: agent-hub install                     set up or update everything for this user
       agent-hub serve
       agent-hub relay <agent name> <command> [args...]
       agent-hub ctl ...   (agent-hub ctl help)
       agent-hub up | down | status          the hub's public address, and every open port
       agent-hub share <port> | share stop <port>   an open public address for a local port, with no login
       agent-hub domain <hostname> | --random <your domain>   a permanent address for the hub on your Cloudflare
                                             domain, after ` + "`" + `cloudflared tunnel login` + "`" + `; --random makes up a name
                                             that is hard to guess; open ports keep changing addresses
       agent-hub open                        the web app in this computer's browser, logged in
       agent-hub voice [off | voicekey | http <url> [model]]   voice input in the web app, off until set: VoiceKey's
                                             model on this computer, or a server shaped like OpenAI's transcription
                                             API (its key, if any, from AGENT_HUB_VOICE_KEY)
       agent-hub otp [reset]                 the authenticator app's QR code for logging in from a phone`

func main() {
	if len(os.Args) < 2 {
		fail(usage)
	}
	switch os.Args[1] {
	case "install":
		icon, err := fs.ReadFile(web.Dist(), "favicon.svg")
		if err == nil {
			err = install.Run(os.Stdout, icon)
		}
		if err != nil {
			fail(err.Error())
		}
	case "serve":
		config, err := hub.LoadConfig()
		if err == nil {
			err = hub.NewServer(config, web.Dist()).Run()
		}
		fail(err.Error())
	case "relay":
		if len(os.Args) < 4 {
			fail(usage)
		}
		os.Exit(relay.Run(os.Args[2], os.Args[3:]))
	case "ctl":
		if len(os.Args) == 3 && os.Args[2] == "help" {
			fmt.Println(ctl.Usage)
			return
		}
		if err := ctl.Run(os.Args[2:], os.Stdout); err != nil {
			fail(err.Error())
		}
	case "up":
		address, err := remote.Up()
		if err != nil {
			fail(err.Error())
		}
		fmt.Println(address)
		// Started from the launcher there is no terminal to print to; the address shows as a notification instead.
		if info, err := os.Stdout.Stat(); err == nil && info.Mode()&os.ModeCharDevice == 0 {
			_ = exec.Command("notify-send", "--app-name=Agent Hub", "--icon=agent-hub", "Agent Hub", address).Run()
		}
	case "down":
		if err := remote.Down(); err != nil {
			fail(err.Error())
		}
	case "status":
		status, err := remote.GetStatus()
		if err != nil {
			fail(err.Error())
		}
		data, _ := json.Marshal(status)
		fmt.Println(string(data))
	case "share":
		share(os.Args[2:])
	case "voice":
		voice(os.Args[2:])
	case "tunnel":
		fail(remote.RunTunnel().Error())
	case "domain":
		host := ""
		switch {
		case len(os.Args) == 3:
			host = os.Args[2]
		case len(os.Args) == 4 && os.Args[2] == "--random":
			host = randomHost(os.Args[3])
		default:
			fail(usage)
		}
		err := remote.SetDomain(host)
		if err == nil {
			// The hub refuses a Host it does not know, and learns the new one when it starts.
			_, err = install.RestartHub(os.Stdout)
		}
		if err != nil {
			fail(err.Error())
		}
		fmt.Printf("the hub's address is https://%s\n", host)
	case "open":
		config, err := hub.LoadConfig()
		if err != nil {
			fail(err.Error())
		}
		// The token logs this computer's browser in; it is refused from anywhere else.
		link := fmt.Sprintf("http://127.0.0.1:%d/#token=%s", config.Port, url.QueryEscape(config.Token))
		if err := exec.Command("xdg-open", link).Start(); err != nil {
			fail(err.Error())
		}
	case "otp":
		reset := len(os.Args) == 3 && os.Args[2] == "reset"
		if len(os.Args) > 3 || (len(os.Args) == 3 && !reset) {
			fail(usage)
		}
		otp(reset)
	default:
		fail(usage)
	}
}

func share(args []string) {
	stop := len(args) == 2 && args[0] == "stop"
	if len(args) != 1 && !stop {
		fail(usage)
	}
	port, err := remote.ParsePort(args[len(args)-1])
	if err != nil {
		fail(err.Error())
	}
	if stop {
		err = remote.Close(port)
	} else {
		var address string
		if address, err = remote.Open(port); err == nil {
			fmt.Println(address)
		}
	}
	if err != nil {
		fail(err.Error())
	}
}

// randomHost is a name under domain nobody guesses: "hub" and eleven random letters and digits.
func randomHost(domain string) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	random := make([]byte, 11)
	_, _ = rand.Read(random)
	name := []byte("hub")
	for _, b := range random {
		name = append(name, alphabet[int(b)%len(alphabet)])
	}
	return string(name) + "." + strings.TrimPrefix(domain, ".")
}

func voice(args []string) {
	var config *hub.VoiceConfig
	switch {
	case len(args) == 0:
		current, err := hub.LoadConfig()
		if err != nil {
			fail(err.Error())
		}
		describeVoice(current.Voice)
		return
	case len(args) == 1 && args[0] == "off":
	case len(args) == 1 && args[0] == "voicekey":
		config = &hub.VoiceConfig{Backend: "voicekey"}
		if _, err := os.Stat(filepath.Join(os.Getenv("XDG_RUNTIME_DIR"), "voicekey", "control.sock")); err != nil {
			fmt.Println("VoiceKey is not running now; voice input will fail until it is")
		}
	case (len(args) == 2 || len(args) == 3) && args[0] == "http":
		address, err := url.Parse(args[1])
		if err != nil || (address.Scheme != "http" && address.Scheme != "https") || address.Host == "" {
			fail("the transcription URL must be http or https")
		}
		config = &hub.VoiceConfig{Backend: "http", URL: args[1], Key: os.Getenv("AGENT_HUB_VOICE_KEY")}
		if len(args) == 3 {
			config.Model = args[2]
		}
	default:
		fail(usage)
	}
	err := hub.SaveVoice(config)
	if err == nil {
		_, err = install.RestartHub(os.Stdout)
	}
	if err != nil {
		fail(err.Error())
	}
	describeVoice(config)
}

func describeVoice(config *hub.VoiceConfig) {
	switch {
	case config == nil:
		fmt.Println("voice input is off")
	case config.Backend == "voicekey":
		fmt.Println("voice input goes to VoiceKey on this computer")
	default:
		fmt.Printf("voice input goes to %s\n", config.URL)
	}
}

func otp(reset bool) {
	home, err := hub.HomeDir()
	if err != nil {
		fail(err.Error())
	}
	link, err := hub.SetupOTP(home, reset)
	if err != nil {
		fail(err.Error())
	}
	if qr, err := exec.LookPath("qrencode"); err == nil {
		command := exec.Command(qr, "-t", "ansiutf8", link)
		command.Stdout = os.Stdout
		_ = command.Run()
	}
	fmt.Printf("%s\n\nAdd it to an authenticator app, then log in on the phone with a code from the app.\n"+
		"This is the only way in from another device; on this computer, agent-hub open logs in by itself.\n", link)
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "agent-hub: "+message)
	os.Exit(1)
}
