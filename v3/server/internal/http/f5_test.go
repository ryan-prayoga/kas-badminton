// Test F4 bagian 2 (PLAN.md §14 F4, §7.2 passkey). Beda dari f2/f4_test.go:
// di sini ada authenticator VIRTUAL (kunci ECDSA P-256 asli, tanda tangan
// asli, CBOR asli lewat paket resmi
// go-webauthn/webauthn/protocol/webauthncbor) yang MENIRU browser+
// authenticator sungguhan supaya ceremony register→login bisa diverifikasi
// ujung-ujung tanpa perangkat fisik — bukan cuma test wiring endpoint.
// Origin-nya dipatok (testWebauthnOrigin, f2_test.go), TIDAK perlu cocok
// dengan alamat httptest.Server yang sesungguhnya, karena validasi WebAuthn
// membaca origin dari clientDataJSON yang ditandatangani "authenticator" ini,
// bukan dari *http.Request.Host.
package httpapi_test

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/google/uuid"
)

type virtualAuthenticator struct {
	priv   *ecdsa.PrivateKey
	credID []byte
}

func newVirtualAuthenticator(t *testing.T) *virtualAuthenticator {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate kunci authenticator virtual: %v", err)
	}
	credID := make([]byte, 16)
	if _, err := rand.Read(credID); err != nil {
		t.Fatalf("generate credential id: %v", err)
	}
	return &virtualAuthenticator{priv: priv, credID: credID}
}

// coseEC2PublicKey — COSE_Key EC2/ES256, format persis yang dibaca
// go-webauthn dari attestedCredentialData (§6.5.1.1 WebAuthn spec).
func (v *virtualAuthenticator) coseEC2PublicKey(t *testing.T) []byte {
	t.Helper()
	x := v.priv.PublicKey.X.FillBytes(make([]byte, 32))
	y := v.priv.PublicKey.Y.FillBytes(make([]byte, 32))
	key := struct {
		KeyType   int64  `cbor:"1,keyasint"`
		Algorithm int64  `cbor:"3,keyasint"`
		Curve     int64  `cbor:"-1,keyasint"`
		XCoord    []byte `cbor:"-2,keyasint"`
		YCoord    []byte `cbor:"-3,keyasint"`
	}{KeyType: 2, Algorithm: -7, Curve: 1, XCoord: x, YCoord: y} // EC2, ES256, P-256
	b, err := webauthncbor.Marshal(key)
	if err != nil {
		t.Fatalf("cbor marshal COSE key: %v", err)
	}
	return b
}

func rpIDHash(rpID string) []byte {
	sum := sha256.Sum256([]byte(rpID))
	return sum[:]
}

// authenticatorData — layout biner §6.1 WebAuthn spec: rpIdHash(32) +
// flags(1) + signCount(4) + [attestedCredentialData kalau attested=true].
func authenticatorData(rpID string, signCount uint32, attested bool, credID, pubKeyCBOR []byte) []byte {
	var buf bytes.Buffer
	buf.Write(rpIDHash(rpID))

	flags := byte(0x01) // UP (user present)
	flags |= 0x04       // UV (user verified) — authenticatorSelection minta preferred
	if attested {
		flags |= 0x40 // AT (attested credential data ikut)
	}
	buf.WriteByte(flags)

	var sc [4]byte
	sc[0] = byte(signCount >> 24)
	sc[1] = byte(signCount >> 16)
	sc[2] = byte(signCount >> 8)
	sc[3] = byte(signCount)
	buf.Write(sc[:])

	if attested {
		buf.Write(make([]byte, 16)) // AAGUID — nol, authenticator virtual tanpa identitas model
		var l [2]byte
		l[0] = byte(len(credID) >> 8)
		l[1] = byte(len(credID))
		buf.Write(l[:])
		buf.Write(credID)
		buf.Write(pubKeyCBOR)
	}
	return buf.Bytes()
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// registerPasskey — options → tanda tangan authenticator virtual → verify.
// Gagal test langsung (t.Fatal) kalau salah satu langkah tidak 200.
func registerPasskey(t *testing.T, base, token string, v *virtualAuthenticator) {
	t.Helper()

	optResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/passkey/register/options", token, nil)
	defer optResp.Body.Close()
	if optResp.StatusCode != http.StatusOK {
		dumpAndFail(t, optResp, "passkey/register/options")
	}
	var opts struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
			RP        struct {
				ID string `json:"id"`
			} `json:"rp"`
		} `json:"publicKey"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(optResp.Body).Decode(&opts); err != nil {
		t.Fatalf("decode register/options: %v", err)
	}
	if opts.SessionID == "" {
		t.Fatal("register/options tidak mengembalikan session_id")
	}

	clientData, _ := json.Marshal(map[string]any{
		"type":        "webauthn.create",
		"challenge":   opts.PublicKey.Challenge,
		"origin":      testWebauthnOrigin,
		"crossOrigin": false,
	})

	pubKeyCBOR := v.coseEC2PublicKey(t)
	authData := authenticatorData(opts.PublicKey.RP.ID, 0, true, v.credID, pubKeyCBOR)

	attObj, err := webauthncbor.Marshal(map[string]any{
		"fmt":      "none",
		"attStmt":  map[string]any{},
		"authData": authData,
	})
	if err != nil {
		t.Fatalf("cbor marshal attestationObject: %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"id":    b64url(v.credID),
		"rawId": b64url(v.credID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64url(clientData),
			"attestationObject": b64url(attObj),
		},
	})

	req, _ := http.NewRequest(http.MethodPost,
		base+"/api/v1/auth/passkey/register/verify?session_id="+opts.SessionID,
		bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("passkey/register/verify: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "passkey/register/verify")
	}
}

// loginWithPasskey — options (discoverable) → tanda tangan → verify → sesi
// baru. userID WAJIB persis punya v (credential yang didaftarkan
// registerPasskey buat user itu) — assertion sengaja menaruh userHandle
// supaya FinishDiscoverableLogin (server) tahu harus memuat siapa.
func loginWithPasskey(t *testing.T, base, userID string, v *virtualAuthenticator, signCount uint32) loggedInUser {
	t.Helper()

	optResp, err := http.Post(base+"/api/v1/auth/passkey/login/options", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("passkey/login/options: %v", err)
	}
	defer optResp.Body.Close()
	if optResp.StatusCode != http.StatusOK {
		dumpAndFail(t, optResp, "passkey/login/options")
	}
	var opts struct {
		PublicKey struct {
			Challenge      string `json:"challenge"`
			RelyingPartyID string `json:"rpId"`
		} `json:"publicKey"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(optResp.Body).Decode(&opts); err != nil {
		t.Fatalf("decode login/options: %v", err)
	}

	clientData, _ := json.Marshal(map[string]any{
		"type":        "webauthn.get",
		"challenge":   opts.PublicKey.Challenge,
		"origin":      testWebauthnOrigin,
		"crossOrigin": false,
	})
	clientDataHash := sha256.Sum256(clientData)

	authData := authenticatorData(opts.PublicKey.RelyingPartyID, signCount, false, nil, nil)

	toSign := append(append([]byte{}, authData...), clientDataHash[:]...)
	digest := sha256.Sum256(toSign)
	sig, err := ecdsa.SignASN1(rand.Reader, v.priv, digest[:])
	if err != nil {
		t.Fatalf("tanda tangan assertion: %v", err)
	}

	uid, err := uuid.Parse(userID)
	if err != nil {
		t.Fatalf("parse userID: %v", err)
	}
	userHandle := uid[:] // webauthnUser.WebAuthnID() = user.ID mentah 16 byte, lihat internal/auth/webauthn.go

	body, _ := json.Marshal(map[string]any{
		"id":    b64url(v.credID),
		"rawId": b64url(v.credID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64url(clientData),
			"authenticatorData": b64url(authData),
			"signature":         b64url(sig),
			"userHandle":        b64url(userHandle),
		},
	})

	verifyResp, err := http.Post(
		base+"/api/v1/auth/passkey/login/verify?session_id="+opts.SessionID,
		"application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("passkey/login/verify: %v", err)
	}
	defer verifyResp.Body.Close()
	if verifyResp.StatusCode != http.StatusOK {
		dumpAndFail(t, verifyResp, "passkey/login/verify")
	}

	var out struct {
		SessionToken string `json:"session_token"`
		User         struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.NewDecoder(verifyResp.Body).Decode(&out); err != nil {
		t.Fatalf("decode passkey/login/verify: %v", err)
	}
	return loggedInUser{token: out.SessionToken, userID: out.User.ID}
}

func TestPasskey_RegisterThenLogin_FullRoundTrip(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	user := otpLogin(t, base, notifier, randPhone())
	v := newVirtualAuthenticator(t)

	registerPasskey(t, base, user.token, v)

	loggedIn := loginWithPasskey(t, base, user.userID, v, 1)
	if loggedIn.userID != user.userID {
		t.Fatalf("login passkey mengembalikan user berbeda: %s, mau %s", loggedIn.userID, user.userID)
	}
	if loggedIn.token == "" {
		t.Fatal("login passkey harus mengembalikan session_token baru")
	}

	// Sesi baru itu SUNGGUHAN — bisa dipakai memanggil endpoint authed lain.
	sessResp := authedRequest(t, http.MethodGet, base+"/api/v1/auth/sessions", loggedIn.token, nil)
	defer sessResp.Body.Close()
	if sessResp.StatusCode != http.StatusOK {
		dumpAndFail(t, sessResp, "GET /auth/sessions pakai sesi hasil login passkey")
	}
}

func TestPasskey_LoginWithWrongSignature_Rejected(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	user := otpLogin(t, base, notifier, randPhone())
	registered := newVirtualAuthenticator(t)
	registerPasskey(t, base, user.token, registered)

	impostor := newVirtualAuthenticator(t)
	impostor.credID = registered.credID // credential ID sama, KUNCI beda — tanda tangan harus gagal diverifikasi

	optResp, err := http.Post(base+"/api/v1/auth/passkey/login/options", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("passkey/login/options: %v", err)
	}
	defer optResp.Body.Close()
	var opts struct {
		PublicKey struct {
			Challenge      string `json:"challenge"`
			RelyingPartyID string `json:"rpId"`
		} `json:"publicKey"`
		SessionID string `json:"session_id"`
	}
	_ = json.NewDecoder(optResp.Body).Decode(&opts)

	clientData, _ := json.Marshal(map[string]any{
		"type": "webauthn.get", "challenge": opts.PublicKey.Challenge,
		"origin": testWebauthnOrigin, "crossOrigin": false,
	})
	clientDataHash := sha256.Sum256(clientData)
	authData := authenticatorData(opts.PublicKey.RelyingPartyID, 1, false, nil, nil)
	digest := sha256.Sum256(append(append([]byte{}, authData...), clientDataHash[:]...))
	sig, _ := ecdsa.SignASN1(rand.Reader, impostor.priv, digest[:]) // ditandatangani kunci YANG SALAH

	uid, _ := uuid.Parse(user.userID)
	body, _ := json.Marshal(map[string]any{
		"id": b64url(impostor.credID), "rawId": b64url(impostor.credID), "type": "public-key",
		"response": map[string]any{
			"clientDataJSON": b64url(clientData), "authenticatorData": b64url(authData),
			"signature": b64url(sig), "userHandle": b64url(uid[:]),
		},
	})

	resp, err := http.Post(base+"/api/v1/auth/passkey/login/verify?session_id="+opts.SessionID, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("passkey/login/verify: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, resp, "login pakai tanda tangan kunci salah HARUS ditolak")
	}
}

// TestPasskey_RevokeSession_RemovesCredential — §7.2.2: "mengeluarkan
// perangkat juga mencabut passkey yang terdaftar di situ".
func TestPasskey_RevokeSession_RemovesCredential(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	user := otpLogin(t, base, notifier, randPhone())
	v := newVirtualAuthenticator(t)
	registerPasskey(t, base, user.token, v)

	// Sesi yang dipakai mendaftar TADI (user.token) dikeluarkan sendiri.
	logoutResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/logout", user.token, nil)
	defer logoutResp.Body.Close()
	if logoutResp.StatusCode != http.StatusOK {
		dumpAndFail(t, logoutResp, "logout")
	}

	// Passkey yang tadi ditempel ke sesi itu ikut tercabut — login pakainya
	// sekarang harus ditolak (kredensial sudah tidak ada di user manapun).
	optResp, err := http.Post(base+"/api/v1/auth/passkey/login/options", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("passkey/login/options: %v", err)
	}
	defer optResp.Body.Close()
	var opts struct {
		PublicKey struct {
			Challenge      string `json:"challenge"`
			RelyingPartyID string `json:"rpId"`
		} `json:"publicKey"`
		SessionID string `json:"session_id"`
	}
	_ = json.NewDecoder(optResp.Body).Decode(&opts)

	clientData, _ := json.Marshal(map[string]any{
		"type": "webauthn.get", "challenge": opts.PublicKey.Challenge,
		"origin": testWebauthnOrigin, "crossOrigin": false,
	})
	clientDataHash := sha256.Sum256(clientData)
	authData := authenticatorData(opts.PublicKey.RelyingPartyID, 1, false, nil, nil)
	digest := sha256.Sum256(append(append([]byte{}, authData...), clientDataHash[:]...))
	sig, _ := ecdsa.SignASN1(rand.Reader, v.priv, digest[:])

	uid, _ := uuid.Parse(user.userID)
	body, _ := json.Marshal(map[string]any{
		"id": b64url(v.credID), "rawId": b64url(v.credID), "type": "public-key",
		"response": map[string]any{
			"clientDataJSON": b64url(clientData), "authenticatorData": b64url(authData),
			"signature": b64url(sig), "userHandle": b64url(uid[:]),
		},
	})

	verifyResp, err := http.Post(base+"/api/v1/auth/passkey/login/verify?session_id="+opts.SessionID, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("passkey/login/verify: %v", err)
	}
	defer verifyResp.Body.Close()
	if verifyResp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, verifyResp, "login passkey sesudah sesinya dikeluarkan HARUS ditolak (kredensial ikut tercabut)")
	}
}
