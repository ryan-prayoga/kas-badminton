package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

const idempotencyKeyTTL = 24 * time.Hour

// RequireIdempotency menegakkan invarian §3.3: setiap POST/PUT/PATCH/
// DELETE wajib Idempotency-Key, kunci yang sama + isi yang sama
// mengembalikan hasil tersimpan apa adanya, kunci sama + isi beda → 409
// (API.md §0). GET/HEAD lewat tanpa disentuh.
func RequireIdempotency(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				next.ServeHTTP(w, r)
				return
			}

			key := r.Header.Get("Idempotency-Key")
			if key == "" {
				writeError(w, CodeValidationFailed, "Header Idempotency-Key wajib diisi.", nil)
				return
			}
			if _, err := uuid.Parse(key); err != nil {
				writeError(w, CodeValidationFailed, "Idempotency-Key harus UUID v4.", nil)
				return
			}

			bodyBytes, err := io.ReadAll(r.Body)
			if err != nil {
				writeError(w, CodeValidationFailed, "Body permintaan tidak bisa dibaca.", nil)
				return
			}
			_ = r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

			sum := sha256.Sum256(append([]byte(r.Method+" "+r.URL.Path+"\n"), bodyBytes...))
			reqHash := sum[:]

			userID, _ := userIDFromContext(r.Context())
			var clubIDPtr *uuid.UUID
			if id, ok := clubIDFromContext(r.Context()); ok {
				clubIDPtr = &id
			}

			var reservation gen.IdempotencyKey
			claimed := false
			err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
				row, err := q.ReserveIdempotencyKey(ctx, gen.ReserveIdempotencyKeyParams{
					Key:         key,
					UserID:      userID,
					ClubID:      clubIDPtr,
					Endpoint:    r.Method + " " + r.URL.Path,
					RequestHash: reqHash,
					ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(idempotencyKeyTTL), Valid: true},
				})
				if err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return nil // sudah diklaim permintaan lain — bukan galat
					}
					return err
				}
				reservation = row
				claimed = true
				return nil
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal memproses kunci idempotensi.", nil)
				return
			}

			if !claimed {
				replayExistingIdempotency(w, r, s, key, reqHash)
				return
			}

			rec := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			// 5xx sengaja tidak disimpan: retry sungguhan (bukan replay)
			// harus bisa mencoba lagi setelah galat server transien.
			if rec.status < 500 {
				_ = s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
					return q.CompleteIdempotencyKey(ctx, gen.CompleteIdempotencyKeyParams{
						Key:        key,
						Response:   rec.body.Bytes(),
						StatusCode: pgtype.Int4{Int32: int32(rec.status), Valid: true},
					})
				})
			}
			_ = reservation
		})
	}
}

func replayExistingIdempotency(w http.ResponseWriter, r *http.Request, s *store.Store, key string, reqHash []byte) {
	var existing gen.IdempotencyKey
	err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
		row, err := q.GetIdempotencyKey(ctx, key)
		if err != nil {
			return err
		}
		existing = row
		return nil
	})
	if err != nil {
		writeError(w, CodeValidationFailed, "Kunci idempotensi tidak ditemukan.", nil)
		return
	}

	if !bytes.Equal(existing.RequestHash, reqHash) {
		writeError(w, CodeIdempotencyKeyReused, "Kunci idempotensi ini sudah dipakai untuk permintaan yang berbeda.", nil)
		return
	}
	if !existing.StatusCode.Valid {
		// Permintaan pertama dengan kunci ini masih diproses (belum commit).
		writeError(w, CodeIdempotencyKeyReused, "Permintaan dengan kunci ini masih diproses, coba lagi sebentar.", nil)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(int(existing.StatusCode.Int32))
	_, _ = w.Write(existing.Response)
}

// responseRecorder menampung body respons handler supaya bisa disimpan ke
// idempotency_keys.response setelah handler selesai (dan status-nya bukan
// 5xx).
type responseRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (rr *responseRecorder) WriteHeader(status int) {
	rr.status = status
	rr.ResponseWriter.WriteHeader(status)
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	rr.body.Write(b)
	return rr.ResponseWriter.Write(b)
}
