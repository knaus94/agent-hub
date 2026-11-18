package hub

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// A code from an authenticator app only enrols a device: the device then logs in with its own random token, so the
// six digits are typed once per phone, not on every visit.
const (
	otpStep    = 30
	otpDigits  = 6
	deviceIdle = 30 * 24 * time.Hour
	// Three wrong codes lock out the address they came from; anyone else can still log in.
	codeFailures = 3
	codeLockout  = 5 * time.Minute
	// The brake stops guessing spread over many addresses: past it nobody enrols a device for a while, though
	// devices already enrolled still log in with their tokens.
	brakeFailures = 30
	brakeWindow   = 10 * time.Minute
	otpFile       = "otp.json"
	devicesFile   = "devices.json"
	otpIssuer     = "Agent Hub"
	deviceLabelAt = 120
)

var (
	errNoOTP      = errors.New("no authenticator is set up")
	errWrongCode  = errors.New("wrong code")
	errCodeLocked = errors.New("too many wrong codes")
)

type otpState struct {
	Secret string `json:"secret"`
	// LastStep is the time step of the last accepted code; that code and older ones are refused.
	LastStep int64 `json:"lastStep"`
}

type device struct {
	Hash     string `json:"hash"`
	Label    string `json:"label"`
	Created  int64  `json:"created"`
	LastUsed int64  `json:"lastUsed"`
}

// logins checks codes and device tokens against files in the hub's directory, read on every attempt so that setting
// up the authenticator needs no restart. The caller serialises calls (Server.mu).
type logins struct {
	dir        string
	misses     map[string]*misses
	brake      []time.Time
	brakeUntil time.Time
}

// misses are the wrong codes from one address since the first of them.
type misses struct {
	count       int
	since       time.Time
	lockedUntil time.Time
}

// addressKey is what a lockout holds to: an IPv4 address, or an IPv6 /64, which one user holds whole.
func addressKey(address string) string {
	ip := net.ParseIP(address)
	if ip == nil || ip.To4() != nil {
		return address
	}
	return ip.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

func (l *logins) locked(address string, now time.Time) bool {
	if now.Before(l.brakeUntil) {
		return true
	}
	m := l.misses[addressKey(address)]
	return m != nil && now.Before(m.lockedUntil)
}

func (l *logins) miss(address string, now time.Time) {
	for key, m := range l.misses {
		if now.Sub(m.since) > codeLockout && !now.Before(m.lockedUntil) {
			delete(l.misses, key)
		}
	}
	if l.misses == nil {
		l.misses = map[string]*misses{}
	}
	key := addressKey(address)
	m := l.misses[key]
	if m == nil {
		m = &misses{since: now}
		l.misses[key] = m
	}
	m.count++
	if m.count >= codeFailures {
		m.count, m.since, m.lockedUntil = 0, now, now.Add(codeLockout)
	}
	l.brake = append(slices.DeleteFunc(l.brake, func(at time.Time) bool { return now.Sub(at) > brakeWindow }), now)
	if len(l.brake) >= brakeFailures {
		l.brake, l.brakeUntil = nil, now.Add(codeLockout)
	}
}

func readJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "   ")
	if err != nil {
		return err
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func (l *logins) state() (otpState, error) {
	var state otpState
	err := readJSON(filepath.Join(l.dir, otpFile), &state)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && state.Secret == "") {
		return state, errNoOTP
	}
	return state, err
}

func code(secret []byte, step int64) string {
	mac := hmac.New(sha1.New, secret)
	_ = binary.Write(mac, binary.BigEndian, step)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", otpDigits, value%1_000_000)
}

// enrol checks a code and, when it is right, records the device and returns its token.
func (l *logins) enrol(given, label, address string, now time.Time) (string, error) {
	if l.locked(address, now) {
		return "", errCodeLocked
	}
	state, err := l.state()
	if err != nil {
		return "", err
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(state.Secret)
	if err != nil {
		return "", err
	}
	current := now.Unix() / otpStep
	accepted := int64(-1)
	// One step either side covers a phone clock that is a little off.
	for step := current - 1; step <= current+1; step++ {
		if step > state.LastStep && subtle.ConstantTimeCompare([]byte(code(secret, step)), []byte(given)) == 1 {
			accepted = step
		}
	}
	if accepted < 0 {
		l.miss(address, now)
		return "", errWrongCode
	}
	delete(l.misses, addressKey(address))
	state.LastStep = accepted
	if err := writeJSON(filepath.Join(l.dir, otpFile), state); err != nil {
		return "", err
	}
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	devices, err := l.devices(now)
	if err != nil {
		return "", err
	}
	if len(label) > deviceLabelAt {
		label = label[:deviceLabelAt]
	}
	devices = append(devices, device{Hash: hashToken(token), Label: label, Created: now.Unix(), LastUsed: now.Unix()})
	return token, writeJSON(filepath.Join(l.dir, devicesFile), devices)
}

// devices are the enrolled devices that are still in use.
func (l *logins) devices(now time.Time) ([]device, error) {
	var devices []device
	if err := readJSON(filepath.Join(l.dir, devicesFile), &devices); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return slices.DeleteFunc(devices, func(d device) bool { return now.Sub(time.Unix(d.LastUsed, 0)) > deviceIdle }), nil
}

// device reports whether a token belongs to an enrolled device, and marks it used.
func (l *logins) device(token string, now time.Time) bool {
	devices, err := l.devices(now)
	if err != nil {
		return false
	}
	hash := hashToken(token)
	index := slices.IndexFunc(devices, func(d device) bool { return subtle.ConstantTimeCompare([]byte(d.Hash), []byte(hash)) == 1 })
	if index < 0 {
		return false
	}
	devices[index].LastUsed = now.Unix()
	return writeJSON(filepath.Join(l.dir, devicesFile), devices) == nil
}

func (l *logins) revoke(token string, now time.Time) error {
	devices, err := l.devices(now)
	if err != nil {
		return err
	}
	hash := hashToken(token)
	return writeJSON(filepath.Join(l.dir, devicesFile), slices.DeleteFunc(devices, func(d device) bool { return d.Hash == hash }))
}

func randomToken() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(secret), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// SetupOTP returns the authenticator link, creating the secret first; reset replaces it and forgets every device.
// A reset is what follows a lost phone.
func SetupOTP(home string, reset bool) (string, error) {
	l := logins{dir: home}
	state, err := l.state()
	if reset || errors.Is(err, errNoOTP) {
		secret := make([]byte, 20)
		if _, err := rand.Read(secret); err != nil {
			return "", err
		}
		state = otpState{Secret: base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret)}
		if err := writeJSON(filepath.Join(home, otpFile), state); err != nil {
			return "", err
		}
		if err := os.Remove(filepath.Join(home, devicesFile)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	query := url.Values{"secret": {state.Secret}, "issuer": {otpIssuer}, "digits": {fmt.Sprint(otpDigits)}, "period": {fmt.Sprint(otpStep)}}
	return (&url.URL{Scheme: "otpauth", Host: "totp", Path: "/" + otpIssuer, RawQuery: query.Encode()}).String(), nil
}
