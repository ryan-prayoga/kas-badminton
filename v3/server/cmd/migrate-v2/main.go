// cmd/migrate-v2 membaca database v2 (read-only — lihat komentar package
// internal/migratev2) dan menulisnya ke v3 sebagai klub pertama (PLAN.md
// §14 F10). Dua langkah WAJIB berurutan:
//
//  1. `migrate-v2 dedupe` — cetak nama-nama v2 yang MUNGKIN orang yang
//     sama, tulis berkas pemetaan awal (identity mapping) buat diedit
//     manual. Manusia yang memutuskan mana yang digabung — bukan
//     tebakan otomatis (§14 F10).
//  2. `migrate-v2 run` — migrasi sungguhan, MENOLAK jalan kalau ada nama
//     yang belum ada di berkas pemetaan atau ada game yang bukan ganda 4
//     orang. Idempoten — aman dipanggil ulang dengan data v2 yang sama.
//
// CAKUPAN PASS INI: pemain, jenis kok, main harian, pengeluaran, carry→
// dompet. TURNAMEN BELUM TERMASUK (internal/migratev2 komentar package)
// — jalankan lagi setelah dukungan turnamen menyusul, sebelum cutover
// sungguhan.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/migratev2"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "dedupe":
		err = runDedupe(os.Args[2:])
	case "run":
		err = runMigrate(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		slog.Error("migrate-v2 gagal", "err", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `migrate-v2 — migrasi v2 -> v3 (PLAN.md §14 F10). v2 TIDAK PERNAH ditulis.

Perintah:
  migrate-v2 dedupe --v2-dsn=... [--write-template berkas.json]
  migrate-v2 run    --v2-dsn=... --v3-dsn=... --slug=pb-contoh --name="PB Contoh" --mapping=berkas.json [--admin="Nama Admin"] [--timezone=Asia/Jakarta]`)
}

func v2DSNFlag(fs *flag.FlagSet) *string {
	return fs.String("v2-dsn", os.Getenv("V2_DATABASE_URL"), "DSN Postgres v2 (baca-saja), atau env V2_DATABASE_URL")
}

func runDedupe(args []string) error {
	fs := flag.NewFlagSet("dedupe", flag.ExitOnError)
	dsn := v2DSNFlag(fs)
	writeTemplate := fs.String("write-template", "", "tulis berkas pemetaan awal (identity mapping) ke path ini")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dsn == "" {
		return errors.New("--v2-dsn atau env V2_DATABASE_URL wajib diisi")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	r := migratev2.NewPgReader(pool)

	players, err := r.Players(ctx)
	if err != nil {
		return err
	}
	carry, err := r.Carry(ctx)
	if err != nil {
		return err
	}
	games, err := r.Games(ctx)
	if err != nil {
		return err
	}

	allNames := migratev2.CollectNamesRequiringMapping(players, carry, games)
	clusters := migratev2.ClusterNames(allNames)

	if len(clusters) == 0 {
		fmt.Println("Tidak ada nama yang mirip terdeteksi. Tetap baca daftar penuh sebelum lanjut — kemiripan yang jauh (dua nama panggilan beda buat satu orang) tidak akan ketahuan otomatis.")
	} else {
		fmt.Printf("%d kelompok nama MUNGKIN sama orang — KEPUTUSAN INI MANUSIA, bukan skrip:\n\n", len(clusters))
		for _, c := range clusters {
			fmt.Printf("  ? %v\n", c.Names)
		}
		fmt.Println("\nKalau memang orang yang sama: edit berkas pemetaan, samakan value-nya. Kalau memang beda orang (kebetulan mirip): biarkan apa adanya (identity mapping sudah benar).")
	}

	if *writeTemplate != "" {
		tpl := migratev2.TemplateMapping(allNames)
		if err := migratev2.SaveMapping(*writeTemplate, tpl); err != nil {
			return err
		}
		fmt.Printf("\nBerkas pemetaan awal (%d nama, identity mapping) ditulis ke %s — edit manual sebelum `migrate-v2 run`.\n", len(tpl), *writeTemplate)
	} else {
		fmt.Println("\nJalankan lagi dengan --write-template berkas.json buat menulis berkas pemetaan awal.")
	}
	return nil
}

func runMigrate(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	v2dsn := v2DSNFlag(fs)
	v3dsn := fs.String("v3-dsn", os.Getenv("DATABASE_URL"), "DSN Postgres v3 (role kok_app), atau env DATABASE_URL")
	slug := fs.String("slug", "", "slug klub baru (huruf kecil, angka, tanda hubung)")
	name := fs.String("name", "", "nama klub")
	timezone := fs.String("timezone", "Asia/Jakarta", "zona waktu klub")
	mappingPath := fs.String("mapping", "", "path berkas pemetaan nama (hasil `migrate-v2 dedupe --write-template`, sudah diedit manual)")
	admin := fs.String("admin", "", "nama (kanonik, setelah dipetakan) yang dijadikan admin klub — SANGAT disarankan diisi, lihat migratev2.Options.AdminName")
	if err := fs.Parse(args); err != nil {
		return err
	}
	for flagName, v := range map[string]string{"v2-dsn": *v2dsn, "v3-dsn": *v3dsn, "slug": *slug, "name": *name, "mapping": *mappingPath} {
		if v == "" {
			return fmt.Errorf("--%s wajib diisi", flagName)
		}
	}
	if *admin == "" {
		fmt.Fprintln(os.Stderr, "PERINGATAN: --admin tidak diisi. Klub baru TIDAK PUNYA ADMIN — tidak ada yang bisa menyetujui claim-request siapa pun sampai peran dinaikkan manual lewat database. Lanjutkan? [y/N]")
		var ans string
		fmt.Scanln(&ans)
		if ans != "y" && ans != "Y" {
			return errors.New("dibatalkan")
		}
	}

	mapping, err := migratev2.LoadMapping(*mappingPath)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	v2pool, err := pgxpool.New(ctx, *v2dsn)
	if err != nil {
		return fmt.Errorf("konek v2: %w", err)
	}
	defer v2pool.Close()

	v3pool, err := pgxpool.New(ctx, *v3dsn)
	if err != nil {
		return fmt.Errorf("konek v3: %w", err)
	}
	defer v3pool.Close()

	s := store.New(v3pool)
	r := migratev2.NewPgReader(v2pool)

	result, err := migratev2.Migrate(ctx, r, s, mapping, migratev2.Options{
		ClubSlug: *slug, ClubName: *name, Timezone: *timezone, AdminName: *admin,
	})
	if err != nil {
		return err
	}

	fmt.Printf(`Migrasi selesai & terverifikasi — klub %q (id %s):
  pengguna       : %d
  jenis kok      : %d
  main harian    : %d
  pengeluaran    : %d
  dompet awal    : %d orang
  kas net (v2=v3): Rp %d

TURNAMEN BELUM DIMIGRASI (di luar cakupan pass ini) — jangan cutover
sungguhan sebelum itu menyusul dan diuji seketat bagian ini.
`, *name, result.ClubID, result.UsersCreated, result.KokTypesCreated,
		result.GamesCreated, result.ExpensesCreated, result.WalletTopups, result.KasNet)
	return nil
}
