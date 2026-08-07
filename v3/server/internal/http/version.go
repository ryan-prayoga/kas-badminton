package httpapi

import (
	"net/http"
	"strconv"
)

// requireIfMatch membaca header "If-Match: <version>" (API.md §0 —
// dipilih If-Match, bukan field body, dipakai konsisten di semua endpoint
// tulis atas entitas ber-versi, invarian §3.4).
func requireIfMatch(r *http.Request) (version int64, ok bool) {
	v := r.Header.Get("If-Match")
	if v == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
