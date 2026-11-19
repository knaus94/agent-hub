package hub

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Voice input: the web app records speech and the hub has it recognised, by VoiceKey's model on this computer or by a
// server with OpenAI's transcription API. It stays off until `agent-hub voice` turns it on, since neither is there on
// every computer.
type VoiceConfig struct {
	// Backend is "voicekey" or "http".
	Backend string `json:"backend"`
	// URL, Model, Key and Language are for "http": an endpoint shaped like OpenAI's /v1/audio/transcriptions.
	URL      string `json:"url,omitempty"`
	Model    string `json:"model,omitempty"`
	Key      string `json:"key,omitempty"`
	Language string `json:"language,omitempty"`
}

const (
	// The web app sends 16-bit mono samples at 16 kHz.
	voiceRate = 16000
	// VoiceKey takes at most 25 seconds at a time; a longer recording goes in pieces.
	voiceChunk = 25 * voiceRate * 2
	// A piece ends at the quietest 100 ms of its last five seconds, so a word is not cut in two.
	voiceSearch = 5 * voiceRate * 2
	voiceWindow = voiceRate / 10 * 2
	// Five minutes of speech.
	voiceMaxBytes = 5 * 60 * voiceRate * 2
	voiceTimeout  = 160 * time.Second
)

// The browser uploads the recording with a ticket and gets the text back on its socket a piece at a time: a reply to
// the upload itself could outlast what Cloudflare waits for.

type voiceTextMessage struct {
	Type   string `json:"type"`
	Ticket string `json:"ticket"`
	Text   string `json:"text"`
}

type voiceEndMessage struct {
	Type   string `json:"type"`
	Ticket string `json:"ticket"`
	Error  string `json:"error,omitempty"`
}

// serveVoice takes a recording uploaded with a ticket and recognises it in the background.
func (s *Server) serveVoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ticket := r.URL.Query().Get("ticket")
	c := s.spendTicket(ticket)
	if c == nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if s.config.Voice == nil {
		http.Error(w, "voice input is off", http.StatusNotFound)
		return
	}
	pcm, err := io.ReadAll(http.MaxBytesReader(w, r.Body, voiceMaxBytes))
	if err != nil {
		http.Error(w, "recording too long", http.StatusRequestEntityTooLarge)
		c.enqueue(encode(voiceEndMessage{"voice-end", ticket, "recording too long"}))
		return
	}
	w.WriteHeader(http.StatusAccepted)
	go s.recogniseFor(c, ticket, pcm)
}

// recogniseFor recognises one recording piece by piece, one recording at a time, and sends each piece's text as it
// comes. Pieces without speech give no text.
func (s *Server) recogniseFor(c *client, ticket string, pcm []byte) {
	s.voiceMu.Lock()
	defer s.voiceMu.Unlock()
	for _, piece := range voicePieces(pcm) {
		text, err := s.recognise(piece)
		if err != nil {
			fmt.Fprintf(os.Stderr, "agent-hub: voice: %v\n", err)
			c.enqueue(encode(voiceEndMessage{"voice-end", ticket, err.Error()}))
			return
		}
		if text = strings.TrimSpace(text); text != "" {
			c.enqueue(encode(voiceTextMessage{"voice-text", ticket, text}))
		}
	}
	c.enqueue(encode(voiceEndMessage{"voice-end", ticket, ""}))
}

func (s *Server) recognise(pcm []byte) (string, error) {
	if s.config.Voice.Backend == "voicekey" {
		return voiceKey(s.config.RelayDir, pcm)
	}
	return voiceHTTP(*s.config.Voice, pcm)
}

// voicePieces splits a recording into pieces VoiceKey takes, each ending at a quiet moment.
func voicePieces(pcm []byte) [][]byte {
	pcm = pcm[:len(pcm)&^1]
	var pieces [][]byte
	for len(pcm) > voiceChunk {
		cut := voiceChunk - voiceSearch + quietest(pcm[voiceChunk-voiceSearch:voiceChunk])
		pieces = append(pieces, pcm[:cut])
		pcm = pcm[cut:]
	}
	return append(pieces, pcm)
}

// quietest is the middle of the quietest 100 ms of pcm, on a sample boundary.
func quietest(pcm []byte) int {
	best, least := len(pcm)/2, -1.0
	for start := 0; start+voiceWindow <= len(pcm); start += voiceWindow / 2 {
		energy := 0.0
		for i := start; i < start+voiceWindow; i += 2 {
			sample := float64(int16(binary.LittleEndian.Uint16(pcm[i:])))
			energy += sample * sample
		}
		if least < 0 || energy < least {
			best, least = start+voiceWindow/2, energy
		}
	}
	return best &^ 1
}

// voiceKey has VoiceKey recognise a piece with the model it has loaded: the piece goes in a file only this user
// can read, in dir, since VoiceKey's socket takes a path, not the sound.
func voiceKey(dir string, pcm []byte) (string, error) {
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		return "", errors.New("XDG_RUNTIME_DIR is not set")
	}
	file, err := os.CreateTemp(dir, "voice-*.pcm")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(pcm)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	conn, err := net.DialTimeout("unix", filepath.Join(runtime, "voicekey", "control.sock"), time.Second)
	if err != nil {
		return "", fmt.Errorf("VoiceKey is not running: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(voiceTimeout))
	if err := json.NewEncoder(conn).Encode(map[string]string{"action": "transcribe", "path": file.Name()}); err != nil {
		return "", err
	}
	var reply struct {
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(conn).Decode(&reply); err != nil {
		return "", fmt.Errorf("VoiceKey: %w", err)
	}
	if reply.Error != "" {
		return "", fmt.Errorf("VoiceKey: %s", reply.Error)
	}
	return reply.Text, nil
}

// voiceHTTP sends a piece to a server shaped like OpenAI's transcription API, as a WAV file.
func voiceHTTP(config VoiceConfig, pcm []byte) (string, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "speech.wav")
	if err != nil {
		return "", err
	}
	_, _ = part.Write(wav(pcm))
	for name, value := range map[string]string{"model": config.Model, "language": config.Language, "response_format": "json"} {
		if value != "" {
			_ = form.WriteField(name, value)
		}
	}
	_ = form.Close()
	request, err := http.NewRequest(http.MethodPost, config.URL, &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", form.FormDataContentType())
	if config.Key != "" {
		request.Header.Set("Authorization", "Bearer "+config.Key)
	}
	response, err := (&http.Client{Timeout: voiceTimeout}).Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s: %s", response.Status, strings.TrimSpace(string(data[:min(len(data), 300)])))
	}
	var reply struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(data, &reply); err != nil {
		return "", fmt.Errorf("the transcription server's reply: %w", err)
	}
	return reply.Text, nil
}

func wav(pcm []byte) []byte {
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(36+len(pcm)))
	out.WriteString("WAVEfmt ")
	for _, value := range []any{uint32(16), uint16(1), uint16(1), uint32(voiceRate), uint32(voiceRate * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&out, binary.LittleEndian, value)
	}
	out.WriteString("data")
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(pcm)))
	out.Write(pcm)
	return out.Bytes()
}
