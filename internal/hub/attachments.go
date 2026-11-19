package hub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"unicode/utf8"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// A message with attachments comes as one upload: its text, files from the device and the paths of files of the chat's
// project. Pictures go to the agent as pictures, other files inside the prompt as Zed sends a file it mentions, and
// project files as links the agent opens itself.
const (
	// Every attachment stays in the relay's history, which keeps 16 MiB of a chat; the web app makes pictures much
	// smaller than this before sending them.
	attachmentLimit = 3 << 20
	uploadLimit     = 5 << 20
	attachmentsMax  = 10
)

type sendError struct {
	// Error is "offline", "unsupported", "large", "missing" or "invalid"; File is the attachment it is about.
	Error string `json:"error"`
	File  string `json:"file,omitempty"`
}

// serveSend takes a message with attachments uploaded with a ticket and sends it as one from the socket is sent.
func (s *Server) serveSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	c := s.spendTicket(r.URL.Query().Get("ticket"))
	if c == nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	refuse := func(status int, code, file string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(sendError{code, file})
	}
	r.Body = http.MaxBytesReader(w, r.Body, uploadLimit)
	if err := r.ParseMultipartForm(uploadLimit); err != nil {
		if _, large := errors.AsType[*http.MaxBytesError](err); large {
			refuse(http.StatusRequestEntityTooLarge, "large", "")
		} else {
			refuse(http.StatusBadRequest, "invalid", "")
		}
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	sessionID, text := r.FormValue("sessionId"), r.FormValue("text")
	uploads, links := r.MultipartForm.File["file"], r.MultipartForm.Value["link"]
	if count := len(uploads) + len(links); sessionID == "" || count == 0 || count > attachmentsMax {
		refuse(http.StatusBadRequest, "invalid", "")
		return
	}
	var target *Target
	var cwd string
	s.withTimeline(func(t *Timeline) {
		target, cwd = t.Find(sessionID), t.Cwd(sessionID)
	})
	if target == nil || !target.Online {
		refuse(http.StatusConflict, "offline", "")
		return
	}
	content := make([]json.RawMessage, 0, len(uploads)+len(links))
	for _, upload := range uploads {
		if upload.Size > attachmentLimit {
			refuse(http.StatusRequestEntityTooLarge, "large", upload.Filename)
			return
		}
		data, err := readUpload(upload)
		if err != nil {
			refuse(http.StatusBadRequest, "invalid", upload.Filename)
			return
		}
		block, code := attachment(path.Base(upload.Filename), data, target.Attach)
		if code != "" {
			refuse(http.StatusUnprocessableEntity, code, upload.Filename)
			return
		}
		content = append(content, block)
	}
	for _, link := range links {
		block, code := projectLink(cwd, link, target.Attach)
		if code != "" {
			refuse(http.StatusUnprocessableEntity, code, link)
			return
		}
		content = append(content, block)
	}
	w.WriteHeader(http.StatusAccepted)
	title := text
	if title == "" {
		title = attachedName(uploads, links)
	}
	go s.useDraft(sessionID, title)
	go s.deliver(c, *target, sessionID, text, content)
}

func attachedName(uploads []*multipart.FileHeader, links []string) string {
	if len(uploads) > 0 {
		return path.Base(uploads[0].Filename)
	}
	return filepath.Base(links[0])
}

func readUpload(upload *multipart.FileHeader) ([]byte, error) {
	file, err := upload.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

// attachment is the prompt block of a file from the device; its kind is told by its bytes, not by what the browser
// says it is. The code says why it cannot be sent.
func attachment(name string, data []byte, accept protocol.Attach) (json.RawMessage, string) {
	// Not a file:// address: the file is nowhere on this computer, and the agent must not look for it there. The name
	// stays as it is, since it is all the agent learns of the file.
	uri := "attachment:///" + name
	kind := http.DetectContentType(data)
	switch {
	case shownImages[kind]:
		if !accept.Images {
			return nil, "unsupported"
		}
		return encode(map[string]any{"type": "image", "mimeType": kind, "data": base64.StdEncoding.EncodeToString(data)}), ""
	case kind == "application/pdf":
		if !accept.Files {
			return nil, "unsupported"
		}
		resource := map[string]any{"uri": uri, "mimeType": kind, "blob": base64.StdEncoding.EncodeToString(data)}
		return encode(map[string]any{"type": "resource", "resource": resource}), ""
	case utf8.Valid(data) && !bytes.ContainsRune(data, 0):
		if !accept.Files {
			return nil, "unsupported"
		}
		resource := map[string]any{"uri": uri, "mimeType": "text/plain", "text": string(data)}
		return encode(map[string]any{"type": "resource", "resource": resource}), ""
	}
	return nil, "unsupported"
}

// projectLink is the prompt block of a link to a regular file inside the chat's project.
func projectLink(cwd, relative string, accept protocol.Attach) (json.RawMessage, string) {
	if !accept.Links {
		return nil, "unsupported"
	}
	if cwd == "" || !filepath.IsLocal(relative) {
		return nil, "missing"
	}
	root, err := os.OpenRoot(cwd)
	if err != nil {
		return nil, "missing"
	}
	defer root.Close()
	if info, err := root.Stat(relative); err != nil || !info.Mode().IsRegular() {
		return nil, "missing"
	}
	address := url.URL{Scheme: "file", Path: filepath.Join(cwd, relative)}
	return encode(map[string]any{"type": "resource_link", "uri": address.String(), "name": filepath.Base(relative)}), ""
}
