#!/usr/bin/env bash
# Builds agent-hub from this checkout and installs it for the current user: the binary in ~/.local/bin, the user
# services, the launcher, the GNOME top bar indicator, and Zed's agents wrapped so the phone sees their chats.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

fail() { echo "agent-hub: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is needed: $2"; }

[ "$(id -u)" -ne 0 ] || fail "run this as your own user, not as root"
need go "Go 1.25 or newer, https://go.dev/doc/install"
need node "Node.js 22 or newer"
need corepack "it comes with Node.js and provides the Yarn version the web app pins"
need make "GNU make"
need systemctl "a Linux with a systemd user session"
systemctl --user show-environment >/dev/null 2>&1 || fail "there is no systemd user session to install the services in"

make install YARN="corepack yarn"

cat <<'NEXT'

agent-hub is installed. Next:

  1. Set up the login code (shows a QR code; scan it with an authenticator app):
       agent-hub otp

  2. Make the hub reachable from the phone, either
       agent-hub up                                     a temporary address that changes on every start, or
       cloudflared tunnel login                         a permanent one on your own Cloudflare domain
       agent-hub domain --random <your-domain.com>
       agent-hub up

  3. Restart Zed, so its agents run through agent-hub and their chats show on the phone.

  4. On the phone, open the address, log in with a code from the app. On an iPhone, add it to the Home Screen
     and turn notifications on with the bell in the chat list.

Optional: voice input with `agent-hub voice voicekey` or `agent-hub voice http <url> [model]`.
NEXT
