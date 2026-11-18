// Package deploy holds the files agent-hub install puts around the binary: systemd units, the launcher and the GNOME
// top bar indicator.
package deploy

import "embed"

//go:embed agent-hub.desktop systemd gnome-shell
var Files embed.FS
