// Package metrics — observability minimal (PLAN.md §12 "metrik
// Prometheus"). Counter atomik tangan-sendiri, BUKAN client_golang resmi
// Prometheus — paket itu tidak ada di dependensi terkunci (§4.4) dan
// kebutuhan di sini cuma "berapa request, berapa yang gagal, berapa
// lama" buat skala ~10 klub (§4.2), bukan histogram/label bertingkat.
// Format keluaran /metrics tetap teks Prometheus standar supaya tetap
// bisa di-scrape alat yang sama, cuma cara menghitungnya yang sederhana.
package metrics

import (
	"fmt"
	"io"
	"strconv"
	"sync/atomic"
	"time"
)

var (
	requestsTotal atomic.Int64
	inFlight      atomic.Int64
	startedAt     = time.Now()
	// statusCounts index 0 dipakai buat status <100/tak dikenal (harusnya
	// nol selamanya di praktik, tapi lebih baik ada tempatnya daripada
	// panic index-out-of-range kalau suatu saat ada middleware yang
	// menulis status aneh).
	statusCounts [6]atomic.Int64 // [0]=?, [1]=1xx, [2]=2xx, [3]=3xx, [4]=4xx, [5]=5xx
)

// Observe dipanggil SEKALI per request selesai (main.go
// slogRequestLogger, F9/3) — status HTTP akhirnya menentukan bucket.
func Observe(status int) {
	requestsTotal.Add(1)
	idx := status / 100
	if idx < 0 || idx > 5 {
		idx = 0
	}
	statusCounts[idx].Add(1)
}

// InFlightStart/InFlightEnd — dipasang di awal/akhir tiap request (defer)
// buat gauge "sedang diproses sekarang", sinyal paling murah buat lihat
// server kebanjiran sebelum status/durasi sempat kelihatan.
func InFlightStart() { inFlight.Add(1) }
func InFlightEnd()   { inFlight.Add(-1) }

// WriteText menulis format exposition Prometheus teks biasa (bukan
// protobuf) — cukup buat scraper mana pun yang sudah ada.
func WriteText(w io.Writer) {
	line := func(name, help, typ, value string) {
		_, _ = io.WriteString(w, "# HELP "+name+" "+help+"\n# TYPE "+name+" "+typ+"\n"+name+" "+value+"\n")
	}
	line("kok_http_requests_total", "Total permintaan HTTP selesai diproses.", "counter", strconv.FormatInt(requestsTotal.Load(), 10))
	line("kok_http_in_flight", "Permintaan yang sedang diproses saat ini.", "gauge", strconv.FormatInt(inFlight.Load(), 10))
	line("kok_uptime_seconds", "Lama proses ini jalan.", "counter", fmt.Sprintf("%.0f", time.Since(startedAt).Seconds()))

	_, _ = io.WriteString(w, "# HELP kok_http_status_class_total Total respons per kelas kode status.\n# TYPE kok_http_status_class_total counter\n")
	for i, label := range []string{"unknown", "1xx", "2xx", "3xx", "4xx", "5xx"} {
		_, _ = io.WriteString(w, "kok_http_status_class_total{class=\""+label+"\"} "+strconv.FormatInt(statusCounts[i].Load(), 10)+"\n")
	}
}
