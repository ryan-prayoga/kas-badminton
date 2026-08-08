<script lang="ts">
	// Kebijakan privasi minimal (PLAN.md §12: "apa yang disimpan, siapa
	// yang bisa melihat, berapa lama"). Halaman statis, publik, tanpa
	// panggilan API — isinya ringkasan aturan yang sudah ditegakkan di
	// server (F9/1 halaman publik, F9/3 kuota, F9/4 ekspor/hapus), bukan
	// janji terpisah dari kode.
	import { page } from '$app/state';
	const cameFromAccount = page.url.searchParams.get('dari') === 'akun';
</script>

<svelte:head>
	<title>Kebijakan Privasi — Kok Badminton</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="page">
	<div class="wrap">
		<a href={cameFromAccount ? '/account' : '/'} class="back">← Kembali</a>
		<h1 class="display">Kebijakan privasi</h1>
		<p class="lead">Ringkas, bahasa biasa — bukan dokumen hukum panjang.</p>

		<section>
			<h2>Apa yang disimpan</h2>
			<ul>
				<li><strong>Nomor WhatsApp</strong> — buat verifikasi identitas & login. Wajib.</li>
				<li><strong>Nama tampilan & username</strong> — bebas diubah, boleh sama dengan orang lain.</li>
				<li>
					<strong>Riwayat main, tagihan, dan pembayaran</strong> — bagian pembukuan klub, disimpan
					selama klubnya aktif.
				</li>
				<li>
					<strong>Saldo deposit</strong> — kalau kamu memakai fitur dompet di suatu klub.
				</li>
				<li>
					<strong>Foto profil</strong> (kalau diunggah) & <strong>langganan notifikasi push</strong> di
					perangkat yang kamu pasangi.
				</li>
			</ul>
		</section>

		<section>
			<h2>Siapa yang bisa melihat</h2>
			<ul>
				<li>
					<strong>Kamu sendiri</strong> — selalu lihat semua data milikmu di klub yang kamu ikuti.
				</li>
				<li>
					<strong>Bendahara & admin klub</strong> — bisa lihat tagihan dan saldo depositmu, buat
					urusan uang klub. Tidak bisa lihat nomormu kalau bukan lewat daftar anggota resmi klub.
				</li>
				<li>
					<strong>Anggota klub lain</strong> — bisa lihat nama & statistik mainmu di dalam klub yang
					sama. Saldo depositmu <strong>selalu privat</strong>, tidak pernah ditampilkan ke sesama anggota.
				</li>
				<li>
					<strong>Pengunjung halaman publik klub</strong> (kalau pengurus menyalakannya) — bisa lihat
					nama & rekap tagihan, <strong>tidak pernah</strong> nomor telepon atau saldo deposit siapa
					pun. Halaman itu ditutup dari mesin pencari (noindex).
				</li>
				<li>
					<strong>Admin platform (superadmin)</strong> — mengelola klub secara teknis (kuota,
					kesehatan sistem), <strong>tidak bisa</strong> membuka tagihan, riwayat, atau pembayaran
					klub mana pun lewat panelnya.
				</li>
			</ul>
		</section>

		<section>
			<h2>Berapa lama disimpan</h2>
			<ul>
				<li>Klub yang dihapus adminnya: datanya bisa dipulihkan <strong>30 hari</strong>, lalu terhapus permanen.</li>
				<li>
					Klub yang cuma vakum (tidak dihapus): datanya tetap ada, tidak ada batas waktu — itu
					riwayat uang yang sah.
				</li>
				<li>
					Kamu bisa <strong>mengunduh</strong> seluruh data pribadimu atau
					<strong>menghapus akunmu</strong> kapan saja dari halaman <a href="/account">Akun</a>.
					Nomor, nama, dan username dilepas seketika; tagihan dan pembayaran yang sudah tercatat
					tetap ada di pembukuan klub (bukan lagi ditandai punyamu, tampil sebagai
					"Pemain terhapus").
				</li>
			</ul>
		</section>

		<p class="meta">Ada pertanyaan? Hubungi admin klubmu — mereka yang paling tahu konteks klubnya.</p>
	</div>
</main>

<style>
	.page {
		min-height: 100dvh;
		background: var(--bg);
		padding: 24px 20px 64px;
	}
	.wrap {
		max-width: 620px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		text-decoration: none;
		margin-bottom: 8px;
	}
	h1 {
		font-size: 26px;
		font-weight: 800;
		margin: 0;
	}
	.lead {
		color: var(--ink-faint);
		font-size: 14px;
		margin: 0 0 12px;
	}
	section {
		margin-top: 18px;
	}
	h2 {
		font-size: 16px;
		font-weight: 700;
		margin: 0 0 8px;
	}
	ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.55;
		color: var(--ink-soft);
	}
	a {
		color: var(--accent);
	}
	.meta {
		margin-top: 28px;
		font-size: 13px;
		color: var(--ink-faint);
	}
</style>
