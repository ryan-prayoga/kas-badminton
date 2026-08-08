package ratelimit

import (
	"testing"
	"time"
)

func TestLimiter_AllowsUpToLimitThenBlocks(t *testing.T) {
	l := New(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !l.Allow("a") {
			t.Fatalf("permintaan ke-%d harusnya masih diizinkan", i+1)
		}
	}
	if l.Allow("a") {
		t.Fatal("permintaan ke-4 harusnya sudah kena limit")
	}
}

func TestLimiter_KeysAreIndependent(t *testing.T) {
	l := New(1, time.Minute)
	if !l.Allow("a") {
		t.Fatal("key a pertama harusnya diizinkan")
	}
	if !l.Allow("b") {
		t.Fatal("key b tidak boleh kena limit key a — key beda, jatah beda")
	}
	if l.Allow("a") {
		t.Fatal("key a kedua harusnya sudah kena limit")
	}
}

func TestLimiter_ResetsAfterWindow(t *testing.T) {
	l := New(1, 10*time.Millisecond)
	if !l.Allow("a") {
		t.Fatal("permintaan pertama harusnya diizinkan")
	}
	if l.Allow("a") {
		t.Fatal("permintaan kedua dalam window yang sama harusnya kena limit")
	}
	time.Sleep(15 * time.Millisecond)
	if !l.Allow("a") {
		t.Fatal("setelah window lewat, jatah harusnya reset")
	}
}

func TestLimiter_SweepRemovesStaleEntries(t *testing.T) {
	l := New(1, time.Millisecond)
	l.Allow("a")
	l.Sweep(time.Now().Add(time.Hour)) // jauh lewat 2x window
	l.mu.Lock()
	_, stillThere := l.seen["a"]
	l.mu.Unlock()
	if stillThere {
		t.Fatal("entri lama harusnya sudah dibuang Sweep")
	}
}
