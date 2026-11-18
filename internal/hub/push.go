package hub

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// Web Push: phones and browsers that subscribed are told, through their push services, when a turn ends or an agent
// waits for an answer. Each message is encrypted for its subscription (RFC 8291) and signed with the hub's own key
// (RFC 8292), both with the standard library.
const (
	pushFile = "push.json"
	// A notification nobody could receive within an hour is old news.
	pushTTL = "3600"
	// One record holds a whole message; texts are cut well below it.
	pushRecord = 4096
	pushText   = 200
)

// The push services of Safari, Chrome, Firefox and Edge. A subscription elsewhere is refused, so a browser cannot
// make the hub post to any address it likes.
var pushServices = []string{".push.apple.com", ".googleapis.com", ".push.services.mozilla.com", ".notify.windows.com"}

var b64 = base64.RawURLEncoding

type pushState struct {
	// Key is the hub's VAPID private key. It is made once: every subscription is bound to it.
	Key           string             `json:"key"`
	Subscriptions []pushSubscription `json:"subscriptions"`
}

type pushSubscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
	// Device is the hash of the device token the browser logged in with, or "config" for this computer's own token;
	// logging the device out ends its subscriptions.
	Device string `json:"device"`
}

type pushes struct {
	mu    sync.Mutex
	path  string
	key   *ecdsa.PrivateKey
	state pushState
}

func loadPushes(dir string) (*pushes, error) {
	p := &pushes{path: filepath.Join(dir, pushFile)}
	if err := readJSON(p.path, &p.state); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if p.state.Key == "" {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, err
		}
		raw, err := key.Bytes()
		if err != nil {
			return nil, err
		}
		p.state.Key = b64.EncodeToString(raw)
		if err := writeJSON(p.path, p.state); err != nil {
			return nil, err
		}
	}
	raw, err := b64.DecodeString(p.state.Key)
	if err != nil {
		return nil, err
	}
	if p.key, err = ecdsa.ParseRawPrivateKey(elliptic.P256(), raw); err != nil {
		return nil, err
	}
	return p, nil
}

// PublicKey is what a browser subscribes with: the hub's key as an uncompressed point.
func (p *pushes) PublicKey() string {
	public, _ := p.key.PublicKey.Bytes()
	return b64.EncodeToString(public)
}

// subscribe keeps a browser's subscription, replacing an earlier one for the same address.
func (p *pushes) subscribe(subscription pushSubscription) error {
	endpoint, err := url.Parse(subscription.Endpoint)
	if err != nil || endpoint.Scheme != "https" || !slices.ContainsFunc(pushServices, func(service string) bool {
		return strings.HasSuffix("."+endpoint.Hostname(), service)
	}) {
		return errors.New("not a known push service")
	}
	public, err := b64.DecodeString(subscription.P256dh)
	if err == nil {
		_, err = ecdh.P256().NewPublicKey(public)
	}
	if auth, authErr := b64.DecodeString(subscription.Auth); err != nil || authErr != nil || len(auth) != 16 {
		return errors.New("not a push subscription's keys")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.state.Subscriptions = append(slices.DeleteFunc(p.state.Subscriptions, func(s pushSubscription) bool {
		return s.Endpoint == subscription.Endpoint
	}), subscription)
	return writeJSON(p.path, p.state)
}

// forget drops the subscriptions that match.
func (p *pushes) forget(match func(pushSubscription) bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	before := len(p.state.Subscriptions)
	p.state.Subscriptions = slices.DeleteFunc(p.state.Subscriptions, match)
	if len(p.state.Subscriptions) != before {
		if err := writeJSON(p.path, p.state); err != nil {
			fmt.Fprintf(os.Stderr, "agent-hub: %s: %v\n", pushFile, err)
		}
	}
}

// pushMessage is what the service worker turns into a notification; the words are the web app's.
type pushMessage struct {
	Kind      string `json:"kind"`
	SessionID string `json:"sessionId"`
	Title     string `json:"title"`
	Text      string `json:"text,omitempty"`
}

// send delivers a message to every subscription whose device passes allowed. Subscriptions their push service no
// longer knows are dropped.
func (p *pushes) send(message pushMessage, subject string, allowed func(device string) bool) {
	payload, _ := json.Marshal(message)
	p.mu.Lock()
	subscriptions := slices.Clone(p.state.Subscriptions)
	p.mu.Unlock()
	urgency := "normal"
	if message.Kind == "ask" {
		urgency = "high"
	}
	for _, subscription := range subscriptions {
		if !allowed(subscription.Device) {
			continue
		}
		status, err := p.deliver(subscription, payload, subject, urgency)
		switch {
		case status == http.StatusNotFound || status == http.StatusGone:
			p.forget(func(s pushSubscription) bool { return s.Endpoint == subscription.Endpoint })
		case err != nil:
			fmt.Fprintf(os.Stderr, "agent-hub: push: %v\n", err)
		}
	}
}

func (p *pushes) deliver(subscription pushSubscription, payload []byte, subject, urgency string) (int, error) {
	public, _ := b64.DecodeString(subscription.P256dh)
	auth, _ := b64.DecodeString(subscription.Auth)
	sender, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return 0, err
	}
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	body, err := encryptPush(payload, public, auth, sender, salt)
	if err != nil {
		return 0, err
	}
	endpoint, _ := url.Parse(subscription.Endpoint)
	token, err := vapidToken(p.key, endpoint.Scheme+"://"+endpoint.Host, subject, time.Now())
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequest(http.MethodPost, subscription.Endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header.Set("TTL", pushTTL)
	request.Header.Set("Urgency", urgency)
	request.Header.Set("Content-Encoding", "aes128gcm")
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("Authorization", "vapid t="+token+", k="+p.PublicKey())
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 == 2 {
		return response.StatusCode, nil
	}
	reply, _ := io.ReadAll(io.LimitReader(response.Body, 300))
	return response.StatusCode, fmt.Errorf("%s: %s: %s", endpoint.Host, response.Status, strings.TrimSpace(string(reply)))
}

// encryptPush encrypts a message for one subscription as RFC 8291 describes, in a single aes128gcm record.
func encryptPush(plaintext, uaPublic, auth []byte, sender *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(plaintext)+1+16 > pushRecord {
		return nil, errors.New("push message too long")
	}
	receiver, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, err
	}
	shared, err := sender.ECDH(receiver)
	if err != nil {
		return nil, err
	}
	asPublic := sender.PublicKey().Bytes()
	keyPRK, err := hkdf.Extract(sha256.New, shared, auth)
	if err != nil {
		return nil, err
	}
	ikm, err := hkdf.Expand(sha256.New, keyPRK, "WebPush: info\x00"+string(uaPublic)+string(asPublic), 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	header := slices.Concat(salt, binary.BigEndian.AppendUint32(nil, pushRecord), []byte{byte(len(asPublic))}, asPublic)
	// The single record is the last one, which 0x02 marks.
	return gcm.Seal(header, nonce, append(slices.Clone(plaintext), 2), nil), nil
}

// vapidToken signs the claim RFC 8292 asks for: which push service it is for, until when, and who sends.
func vapidToken(key *ecdsa.PrivateKey, audience, subject string, now time.Time) (string, error) {
	claims, _ := json.Marshal(map[string]any{"aud": audience, "exp": now.Add(12 * time.Hour).Unix(), "sub": subject})
	unsigned := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`)) + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	// JWS wants the two numbers side by side, 32 bytes each, not the DER form Go's signing helpers give.
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	return unsigned + "." + b64.EncodeToString(signature), nil
}

// pushKey is the key browsers subscribe with, or "" while notifications cannot work.
func (s *Server) pushKey() string {
	if s.push == nil || s.config.Address == "" {
		return ""
	}
	return s.push.PublicKey()
}

// notify sends each alert to every subscribed device still logged in, except one showing that chat right now. The
// caller holds s.mu; the sending happens outside it.
func (s *Server) notify(alerts []Alert) {
	if len(alerts) == 0 || s.pushKey() == "" {
		return
	}
	devices, err := s.logins.devices(time.Now())
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-hub: push: %v\n", err)
		return
	}
	loggedIn := map[string]bool{"config": true}
	for _, device := range devices {
		loggedIn[device.Hash] = true
	}
	subject := "https://" + s.config.Address
	for _, alert := range alerts {
		watching := map[string]bool{}
		for c := range s.clients {
			if c.authed && c.visible && c.open == alert.SessionID {
				watching[c.pushDevice()] = true
			}
		}
		message := pushMessage{alert.Kind, alert.SessionID, clip(s.timeline.Title(alert.SessionID)), clip(alert.Text)}
		go s.push.send(message, subject, func(device string) bool { return loggedIn[device] && !watching[device] })
	}
}

func clip(text string) string {
	if runes := []rune(text); len(runes) > pushText {
		return string(runes[:pushText]) + "…"
	}
	return text
}
