# Install prompt

Give the text below to an AI coding agent (Claude Code, Codex or similar) running on the computer where Zed runs. It installs agent-hub, sets it up with you, and checks each step.

---

Install and set up agent-hub from https://github.com/knaus94/agent-hub on this computer, so I can watch and steer my Zed agent chats from my phone. Work step by step, check each step's result before the next, and tell me plainly what worked, what failed and what is left.

Rules:

- Run everything as my user, never with sudo. If a system package is missing, tell me the command and let me run it.
- Never print, log or store the authenticator secret, the token in `~/.config/agent-hub/config.json`, or anything from `~/.cloudflared`. I scan the QR code myself.
- Steps that need me (scanning a QR code, logging in to Cloudflare in a browser, restarting Zed, trying things on the phone) are mine: stop, tell me exactly what to do, and wait.
- Do not change Cloudflare DNS or tunnels beyond what `agent-hub domain` does, and do not touch other services.

Steps:

1. **Check the machine.** Linux with a systemd user session (`systemctl --user show-environment`), Go 1.25 or newer, Node.js 22 or newer with corepack, GNU make, git. Check that Zed's settings (`~/.config/zed/settings.json`) have agents under `agent_servers`, each with a `command`; list them for me. If some are missing, explain what agent-hub needs.
2. **Install.** Clone the repository into a directory of my choice (ask; default `~/src/agent-hub`) and run `./scripts/install.sh`. Read its output: it reports the services it installed, whether it restarted the hub, and which Zed agents now run through agent-hub. Confirm with `systemctl --user is-active agent-hub` and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8790/` (expect 200).
3. **Login code.** Ask me to run `agent-hub otp` in my own terminal and scan the QR code with an authenticator app. Wait until I confirm.
4. **Remote access.** Ask whether I have a domain on Cloudflare.
   - If not: run `agent-hub up` and give me the temporary address it prints. It changes on every start, and iPhone notifications will not work with it.
   - If yes: ask me to run `cloudflared tunnel login` and pick the domain in the browser. Then run `agent-hub domain --random <that domain>`, then `agent-hub up`, and give me the address. Check it from here with `curl -s -o /dev/null -w '%{http_code}' https://<address>/` (expect 200).
5. **Zed.** Ask me to restart Zed (command palette, `workspace: reload`), so its agents start through agent-hub. Then open a chat in Zed and check that its agent now runs through agent-hub: `agent-hub ctl list` lists one relay per running agent, and `agent-hub ctl <relay> sessions` the chats it holds.
6. **Phone.** Tell me to open the address on the phone and log in with a code from the authenticator. On an iPhone: Share → Add to Home Screen, open it from the icon, log in again and turn notifications on with the bell in the chat list.
7. **Voice, optional.** Ask whether I want voice input. If I run VoiceKey (`systemctl --user is-active voicekey`), run `agent-hub voice voicekey`. If I have a Whisper-compatible server, run `agent-hub voice http <its /v1/audio/transcriptions URL> [model]`, with its key in `AGENT_HUB_VOICE_KEY` if it needs one. Otherwise leave it off.
8. **Report.** Summarise: the address, which Zed agents are wrapped, what is set up, what you could not check (anything on the phone), and where the settings live (`~/.config/agent-hub`). Remind me that whoever logs in can make the agents run commands on this computer, so the authenticator must stay mine.
