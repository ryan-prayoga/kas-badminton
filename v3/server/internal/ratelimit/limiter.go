// Package ratelimit — rate limiting umum per IP dan per user, seluruh API
// (PLAN.md §12 "Rate limiting umum per user dan per IP di seluruh API,
// bukan cuma OTP"). OTP punya pengamannya sendiri yang lebih ketat
// (internal/auth, §7.2) — paket ini lapisan KEDUA yang lebih longgar,
// jaring buat seluruh permukaan API supaya satu klien nakal/bug klien
// tidak bisa membebani satu instance (target skala §4.2: ~10 klub, jadi
// in-memory per-proses SUDAH cukup — tidak butuh Redis).
//
// Fixed-window counter, bukan token bucket sungguhan — lebih sederhana dan
// cukup buat "lindungi dari kebanjiran", bukan penjatahan presisi. Peta
// dibersihkan berkala (Sweep) supaya IP/user yang sudah lama diam tidak
// menumpuk di memori selamanya.
package ratelimit

import (
	"sync"
	"time"
)

type window struct {
	count      int
	windowFrom time.Time
}

// Limiter — SATU instance dipakai bersama lintas goroutine request (chi
// middleware memanggilnya per request). Aman dipakai konkuren lewat mutex;
// pada skala target (§4.2) jumlah key aktif kecil, mutex tunggal tidak
// jadi bottleneck.
type Limiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	seen   map[string]*window
}

func New(limit int, per time.Duration) *Limiter {
	return &Limiter{limit: limit, window: per, seen: map[string]*window{}}
}

// Allow — true kalau key ini masih di bawah limit pada jendela waktu
// berjalan; false kalau sudah kena batas (pemanggil balas 429).
func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	w, ok := l.seen[key]
	if !ok || now.Sub(w.windowFrom) >= l.window {
		l.seen[key] = &window{count: 1, windowFrom: now}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	return true
}

// Sweep membuang key yang jendelanya sudah lewat DUA kali lipat durasi
// window — dipanggil berkala (goroutine di cmd/api) supaya peta tidak
// tumbuh tanpa batas kalau IP/user yang pernah lewat sini tidak pernah
// balik lagi.
func (l *Limiter) Sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, w := range l.seen {
		if now.Sub(w.windowFrom) >= 2*l.window {
			delete(l.seen, k)
		}
	}
}
