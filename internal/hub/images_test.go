package hub

import (
	"encoding/json"
	"testing"

	"github.com/knaus94/agent-hub/internal/protocol"
)

func TestImagesReachTheTimeline(t *testing.T) {
	timeline := NewTimeline()
	timeline.Attach("src", "Claude (test)", 0)
	timeline.Live("src")
	apply := func(from, message string) { timeline.Apply("src", from, json.RawMessage(message)) }

	// A prompt with a picture, as Zed sends it; a kind the app does not draw is left out.
	apply("client", `{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"a","prompt":[
		{"type":"text","text":"смотри"},
		{"type":"image","mimeType":"image/png","data":"cG5n"},
		{"type":"image","mimeType":"image/svg+xml","data":"c3Zn"}]}}`)
	// The agent echoes the prompt back, picture and all.
	apply("agent", `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"a","update":{"sessionUpdate":"user_message_chunk","content":{"type":"image","mimeType":"image/png","data":"cG5n"}}}}`)
	// A tool reads an image file.
	apply("agent", `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"a","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Read shot.png","kind":"read","status":"completed",
		"content":[{"type":"content","content":{"type":"image","mimeType":"image/jpeg","data":"anBn"}}]}}}`)
	apply("agent", `{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}`)
	// A chat replayed from history carries the user's picture as a chunk of its own.
	apply("agent", `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"a","update":{"sessionUpdate":"user_message_chunk","content":{"type":"image","mimeType":"image/webp","data":"d2VicA=="}}}}`)

	_, entries := timeline.Tail("a", 1<<30)
	var users []protocol.UserEntry
	var tools []protocol.ToolEntry
	for _, entry := range entries {
		switch entry := entry.(type) {
		case protocol.UserEntry:
			users = append(users, entry)
		case protocol.ToolEntry:
			tools = append(tools, entry)
		}
	}
	if len(users) != 2 {
		t.Fatalf("user entries = %+v, want the prompt and the replayed picture", users)
	}
	if got := users[0].Images; len(got) != 1 || got[0] != (protocol.Image{MimeType: "image/png", Data: "cG5n"}) || users[0].Text != "смотри" {
		t.Errorf("prompt = %+v, want its text and its one PNG, not echoed again", users[0])
	}
	if got := users[1].Images; len(got) != 1 || got[0].MimeType != "image/webp" {
		t.Errorf("replayed = %+v", users[1])
	}
	if len(tools) != 1 || len(tools[0].Content) != 1 {
		t.Fatalf("tools = %+v", tools)
	}
	if image, ok := tools[0].Content[0].(protocol.ImageContent); !ok || image.Type != "image" || image.MimeType != "image/jpeg" {
		t.Errorf("tool content = %+v", tools[0].Content)
	}
}
