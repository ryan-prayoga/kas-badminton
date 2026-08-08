// Router notifikasi dua jalur (PLAN.md §10.1, §14 F8) — memutuskan Push
// atau WA per kejadian, menghormati preferensi orangnya dan jam tenang,
// lalu menaruh satu baris di `notifications` (antrean SEKALIGUS pusat
// notifikasi in-app — "§10.1: Push bisa terlewat... pusat notifikasi
// adalah kebenaran"). Pengiriman sungguhannya ada di Dispatcher
// (dispatcher.go); Enqueue di sini CUMA menulis baris, tidak pernah
// menyentuh jaringan — dipanggil di dalam transaksi yang sama dengan
// mutasi yang memicunya (games.go, payments.go, dst — sama pola
// realtime.Publish(ctx, q, event)).
package notify

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// NotifyInput — satu kejadian yang mau diberitahukan ke satu orang.
type NotifyInput struct {
	UserID uuid.UUID
	// ClubID nil buat kejadian lintas klub (jarang — hampir semua
	// kejadian F8 melekat ke satu klub).
	ClubID *uuid.UUID
	// ClubTimezone — IANA (mis. "Asia/Jakarta"), dipakai hitung jam
	// tenang (§10.2). Kosong = anggap UTC (aman, cuma menggeser jendela
	// tenang beberapa jam, bukan gagal).
	ClubTimezone string
	Kind         domain.NotifKind
	Title, Body  string
	// WaBody — teks kalau baris ini jadi WA (primer ATAU fallback).
	// Kosong = pakai Body apa adanya.
	WaBody string
	// URL — deep link opsional, ikut payload Push buat klik notifikasi.
	URL string
	Now time.Time
	// ForceChannel menimpa domain.DefaultChannelFor(Kind) — satu-satunya
	// pemakai saat ini: tunggakan lewat batas (§10.3) waktu klub mematikan
	// saklar pengingat_wa, jalur bawaannya (WA) dipaksa jadi Push, BUKAN
	// dimatikan total ("pengingat tetap muncul sebagai notifikasi in-app
	// dan Web Push"). nil = pakai bawaan kind seperti biasa.
	ForceChannel *domain.NotifChannel
}

type notifPayload struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	WaBody string `json:"wa_body"`
	URL    string `json:"url,omitempty"`
}

// Enqueue menulis satu baris `notifications`. TIDAK PERNAH gagal karena
// alasan "tidak ada yang mau dikirimi" — kejadian yang push+WA-nya
// sama-sama dimatikan user tetap tercatat channel=inapp/status=skipped,
// supaya pusat notifikasi in-app tetap lengkap (§10.1).
func Enqueue(ctx context.Context, q *gen.Queries, in NotifyInput) error {
	pushOn, waOn, err := resolvePrefs(ctx, q, in.UserID, in.ClubID, in.Kind)
	if err != nil {
		return err
	}

	channel := domain.DefaultChannelFor(in.Kind)
	if in.ForceChannel != nil {
		channel = *in.ForceChannel
	}
	sendAfter := in.Now

	if channel == domain.ChannelPush {
		if !pushOn {
			channel = domain.ChannelWA
		} else {
			subs, err := q.ListPushSubscriptionsByUser(ctx, in.UserID)
			if err != nil {
				return err
			}
			if len(subs) == 0 {
				channel = domain.ChannelWA
			} else if in.ClubTimezone != "" {
				if loc, lerr := time.LoadLocation(in.ClubTimezone); lerr == nil {
					local := in.Now.In(loc)
					if domain.IsQuietHour(local.Hour()) {
						sendAfter = nextQuietHourEnd(local).UTC()
					}
				}
			}
		}
	}

	genChannel := gen.NotifChannel(channel)
	status := gen.NotifStatusQueued
	if channel == domain.ChannelWA && !waOn {
		// Push dimatikan ATAU tidak ada langganan (jatuh ke WA di atas),
		// dan WA JUGA dimatikan — dua-duanya nol, tapi kejadiannya tetap
		// harus tercatat (§10.1 "pusat notifikasi adalah kebenaran").
		genChannel = gen.NotifChannelInapp
		status = gen.NotifStatusSkipped
		sendAfter = in.Now
	}

	payload, err := json.Marshal(notifPayload{
		Title: in.Title, Body: in.Body,
		WaBody: firstNonEmpty(in.WaBody, in.Body), URL: in.URL,
	})
	if err != nil {
		return err
	}

	_, err = q.CreateNotification(ctx, gen.CreateNotificationParams{
		UserID: in.UserID, ClubID: in.ClubID, Kind: string(in.Kind), Channel: genChannel,
		Payload: payload, Status: status,
		SendAfter: pgtype.Timestamptz{Time: sendAfter, Valid: true},
	})
	return err
}

// resolvePrefs — baris khusus klub dulu, jatuh ke bawaan lintas klub
// (club_id NULL), jatuh ke "nyala semua" kalau belum pernah diatur sama
// sekali (§10.2 "opt-in per jenis" — bawaan nyala, user yang MATIKAN
// kalau tidak mau, bukan sebaliknya; matikan semua notifikasi bawaan
// akan membuat fitur F8 ini terasa mati buat siapa pun yang belum pernah
// menyentuh halaman preferensi).
func resolvePrefs(ctx context.Context, q *gen.Queries, userID uuid.UUID, clubID *uuid.UUID, kind domain.NotifKind) (pushOn, waOn bool, err error) {
	if clubID != nil {
		pref, err := q.GetNotificationPref(ctx, gen.GetNotificationPrefParams{UserID: userID, Kind: string(kind), ClubID: clubID})
		if err == nil {
			return pref.PushOn, pref.WaOn, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return true, true, err
		}
	}
	pref, err := q.GetNotificationPref(ctx, gen.GetNotificationPrefParams{UserID: userID, Kind: string(kind), ClubID: nil})
	if err == nil {
		return pref.PushOn, pref.WaOn, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return true, true, nil
	}
	return true, true, err
}

// nextQuietHourEnd — jam 07.00 lokal berikutnya. Dipanggil cuma saat
// domain.IsQuietHour(local.Hour()) sudah true, jadi cabangnya cuma dua:
// masih sebelum jam 7 pagi ini (hour < 7), atau sudah lewat jam 9 malam
// (hour >= 21, loncat ke besok).
func nextQuietHourEnd(local time.Time) time.Time {
	day := local
	if local.Hour() >= 21 {
		day = local.AddDate(0, 0, 1)
	}
	return time.Date(day.Year(), day.Month(), day.Day(), 7, 0, 0, 0, day.Location())
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
