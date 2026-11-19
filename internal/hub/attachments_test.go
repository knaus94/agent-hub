package hub

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/knaus94/agent-hub/internal/protocol"
)

func TestAttachmentsFollowWhatTheChatTakes(t *testing.T) {
	// A relay too old to pass attachments on says nothing of them in its hello; a new one says what the agent takes.
	timeline := NewTimeline()
	timeline.Attach("old", "Claude (old)", 0, nil)
	timeline.Attach("new", "Claude (new)", 0, json.RawMessage(`{"image":true}`))
	for _, source := range []string{"old", "new"} {
		timeline.Apply(source, "client", json.RawMessage(`{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"`+source+`","prompt":[{"type":"text","text":"hi"}]}}`))
	}
	if got := timeline.Find("old").Attach; got != (protocol.Attach{}) {
		t.Errorf("old relay = %+v, want nothing besides text", got)
	}
	if got := timeline.Find("new").Attach; got != (protocol.Attach{Links: true, Images: true}) {
		t.Errorf("new relay = %+v, want links and pictures", got)
	}
	// The agent's answer to initialize says it takes files too.
	timeline.Apply("new", "agent", json.RawMessage(`{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":true,"embeddedContext":true}}}}`))
	if got := timeline.Find("new").Attach; !got.Files {
		t.Errorf("after initialize = %+v, want files", got)
	}

	// The kind of a file is told by its bytes, and only what the chat takes goes.
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
	pictures := protocol.Attach{Links: true, Images: true}
	everything := protocol.Attach{Links: true, Images: true, Files: true}
	for _, test := range []struct {
		name   string
		data   []byte
		accept protocol.Attach
		kind   string
		code   string
	}{
		{"shot.txt", png, pictures, "image", ""},
		{"shot.png", png, protocol.Attach{Links: true, Files: true}, "", "unsupported"},
		{"notes.txt", []byte("заметка"), everything, "resource", ""},
		{"notes.txt", []byte("заметка"), pictures, "", "unsupported"},
		{"archive.zip", []byte("PK\x03\x04\x00\x00binary"), everything, "", "unsupported"},
	} {
		block, code := attachment(test.name, test.data, test.accept)
		if code != test.code || deref(object(block).str("type")) != test.kind {
			t.Errorf("%s with %+v = %s %q, want %q %q", test.name, test.accept, block, code, test.kind, test.code)
		}
	}

	// A link goes only to a file inside the project.
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "README.md"), []byte("# hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	if block, code := projectLink(project, "README.md", pictures); code != "" || deref(object(block).str("uri")) != "file://"+filepath.Join(project, "README.md") {
		t.Errorf("README.md = %s %q", block, code)
	}
	for _, outside := range []string{"../README.md", "/etc/passwd", "missing.md"} {
		if _, code := projectLink(project, outside, pictures); code != "missing" {
			t.Errorf("%s = %q, want missing", outside, code)
		}
	}
}
