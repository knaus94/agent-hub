// Package web embeds the built web app; `make web` builds it into dist first.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

func Dist() fs.FS {
	assets, _ := fs.Sub(dist, "dist")
	return assets
}
