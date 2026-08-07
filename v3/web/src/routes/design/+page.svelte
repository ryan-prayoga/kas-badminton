<script lang="ts">
	// Halaman contoh F3 — PLAN.md §14: "halaman contoh yang memamerkan seluruh
	// komponen". Selesai kalau tampil benar di terang & gelap, di tiga
	// breakpoint, dan tiap token teks lolos kontras 4.5:1 (sudah diwarisi dari
	// mockup/index.html, lihat app.css).
	import { toggleTheme } from '$lib/theme';
	import {
		AppShell,
		Button,
		Card,
		Input,
		Checkbox,
		Badge,
		Dialog,
		Tabs,
		Table,
		toast
	} from '$lib/components/ui';

	let dialogOpen = $state(false);
	let tabValue = $state('semua');
	let checkA = $state(true);
	let checkB = $state(false);
	let namaInput = $state('');
</script>

<svelte:head>
	<title>Sistem desain — Kok Badminton v3</title>
</svelte:head>

{#snippet clubHeader()}
	<div class="club-row">
		<button class="club-btn">
			<span class="dot display">PS</span>
			<span class="club-txt">
				<span class="nm">PB Sarjana</span>
				<span class="cv">ketuk buat ganti klub</span>
			</span>
		</button>
		<div class="avatar">R</div>
	</div>
{/snippet}

<AppShell
	current="/design"
	secondary={[
		{ href: '#kas', label: 'Kas' },
		{ href: '#anggota', label: 'Anggota' },
		{ href: '#stok', label: 'Stok' },
		{ href: '#pengaturan', label: 'Pengaturan' }
	]}
	header={clubHeader}
>
	<div class="page">
		<div class="pagehead">
			<div>
				<h1 class="h-title display">Sistem desain</h1>
				<p class="h-sub">
					Token &amp; komponen inti F3 — resize jendela buat lihat 3 breakpoint
					(&lt;768 / 768–1024 / &gt;1024px).
				</p>
			</div>
			<Button variant="secondary" onclick={toggleTheme}>Ganti tema</Button>
		</div>

		<!-- ============ Tipografi ============ -->
		<section aria-labelledby="s-type">
			<h2 id="s-type" class="sec-title display">Tipografi</h2>
			<Card>
				<div class="type-row">
					<span class="type-label">Hero</span>
					<span class="hero-sample display tabular">Rp 47.000</span>
				</div>
				<div class="type-row">
					<span class="type-label">Judul</span>
					<span class="title-sample display">Main terakhir</span>
				</div>
				<div class="type-row">
					<span class="type-label">Isi</span>
					<span class="body-sample">Sisa patungan kamu, dihitung dari main yang belum lunas.</span>
				</div>
				<div class="type-row">
					<span class="type-label">Meta</span>
					<span class="meta-sample">Sabtu, 8 Agu · Partai 2 — batas terkecil, 13px</span>
				</div>
			</Card>
		</section>

		<!-- ============ Warna ============ -->
		<section aria-labelledby="s-color">
			<h2 id="s-color" class="sec-title display">Warna</h2>
			<div class="swatches">
				{#each [{ v: '--accent', n: 'accent' }, { v: '--lunas', n: 'lunas' }, { v: '--belum', n: 'belum' }, { v: '--hancur', n: 'hancur (destruktif saja)' }] as sw (sw.v)}
					<div class="swatch">
						<div class="chip" style="background:var({sw.v})"></div>
						<span>{sw.n}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- ============ Tombol ============ -->
		<section aria-labelledby="s-btn">
			<h2 id="s-btn" class="sec-title display">Tombol</h2>
			<Card>
				<div class="row-wrap">
					<Button variant="primary" size="lg" fullWidth>Bayar sekarang</Button>
					<Button variant="secondary">Sekunder</Button>
					<Button variant="ghost">Ghost</Button>
					<Button variant="destructive">Hapus main</Button>
					<Button variant="primary" disabled>Nonaktif</Button>
				</div>
			</Card>
		</section>

		<!-- ============ Kolom isian & centang ============ -->
		<section aria-labelledby="s-form">
			<h2 id="s-form" class="sec-title display">Kolom isian</h2>
			<Card>
				<div class="form-grid">
					<Input label="Nama pemain" placeholder="mis. Dimas" bind:value={namaInput} />
					<Input label="Nominal" hint="Format rupiah penuh" placeholder="Rp 0" />
					<Input label="Kode klub" error="Kode tidak ditemukan" value="PBX-999" />
				</div>
				<div class="row-wrap" style="margin-top:14px">
					<Checkbox label="Dimas — Rp 15.000" bind:checked={checkA} />
					<Checkbox label="Bagas — lunas" bind:checked={checkB} />
				</div>
			</Card>
		</section>

		<!-- ============ Badge ============ -->
		<section aria-labelledby="s-badge">
			<h2 id="s-badge" class="sec-title display">Status</h2>
			<Card>
				<div class="row-wrap">
					<Badge tone="lunas">Lunas</Badge>
					<Badge tone="belum">Belum lunas</Badge>
					<Badge tone="accent">Potong otomatis</Badge>
					<Badge tone="netral">Tamu</Badge>
				</div>
			</Card>
		</section>

		<!-- ============ Tabs ============ -->
		<section aria-labelledby="s-tabs">
			<h2 id="s-tabs" class="sec-title display">Tab tersegmen</h2>
			<Card>
				<Tabs
					bind:value={tabValue}
					items={[
						{ value: 'semua', label: 'Semua' },
						{ value: 'belum', label: 'Belum lunas' },
						{ value: 'lunas', label: 'Lunas' }
					]}
				>
					{#snippet children(tabs)}
						<div {...tabs.getContent('semua')} class="panel">12 main, 4 belum lunas.</div>
						<div {...tabs.getContent('belum')} class="panel">4 main belum lunas.</div>
						<div {...tabs.getContent('lunas')} class="panel">8 main sudah lunas.</div>
					{/snippet}
				</Tabs>
			</Card>
		</section>

		<!-- ============ Dialog / Sheet ============ -->
		<section aria-labelledby="s-dialog">
			<h2 id="s-dialog" class="sec-title display">Dialog / Sheet</h2>
			<Card>
				<p class="body-sample" style="margin-bottom:12px">
					Sheet dari bawah di HP, dialog di tengah di ≥768px — satu komponen yang sama.
				</p>
				<Button variant="primary" onclick={() => (dialogOpen = true)}>Buka contoh</Button>
			</Card>
			<Dialog bind:open={dialogOpen} title="Hapus main 8 Agustus?">
				{#snippet children()}
					<p class="body-sample">Tagihan 4 orang ikut hilang. Aksi ini bisa dibatalkan 10 detik.</p>
				{/snippet}
				{#snippet footer()}
					<Button variant="secondary" onclick={() => (dialogOpen = false)}>Batal</Button>
					<Button variant="destructive" onclick={() => (dialogOpen = false)}>Hapus</Button>
				{/snippet}
			</Dialog>
		</section>

		<!-- ============ Toast ============ -->
		<section aria-labelledby="s-toast">
			<h2 id="s-toast" class="sec-title display">Toast</h2>
			<Card>
				<div class="row-wrap">
					<Button
						variant="secondary"
						onclick={() => toast('Catatan tersimpan.', { tone: 'lunas' })}
					>
						Sukses
					</Button>
					<Button
						variant="secondary"
						onclick={() =>
							toast('Gagal menyimpan — koneksi terputus. Dikirim lagi otomatis kalau online.', {
								tone: 'hancur',
								title: 'Belum tersimpan'
							})}
					>
						Galat
					</Button>
				</div>
			</Card>
		</section>

		<!-- ============ Tabel (layar besar) ============ -->
		<section aria-labelledby="s-table">
			<h2 id="s-table" class="sec-title display">Tabel padat</h2>
			<Card padded={false}>
				<div style="padding:16px">
					<Table>
						<thead>
							<tr>
								<th>Nama</th>
								<th class="r">Sisa</th>
								<th class="r">Status</th>
							</tr>
						</thead>
						<tbody>
							<tr data-clickable>
								<td>Dimas Pratama</td>
								<td class="r tabular">Rp 15.000</td>
								<td class="r"><Badge tone="belum">Belum</Badge></td>
							</tr>
							<tr data-clickable aria-selected="true">
								<td>Bagas Wicaksono</td>
								<td class="r tabular">Rp 0</td>
								<td class="r"><Badge tone="lunas">Lunas</Badge></td>
							</tr>
						</tbody>
					</Table>
				</div>
			</Card>
		</section>
	</div>
</AppShell>

<style>
	.page {
		max-width: 860px;
		margin: 0 auto;
		padding-top: 20px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.pagehead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.h-title {
		font-size: 26px;
		font-weight: 800;
	}
	.h-sub {
		color: var(--ink-soft);
		font-size: 13.5px;
		max-width: 56ch;
		margin-top: 4px;
	}
	.sec-title {
		font-size: var(--text-title);
		font-weight: 700;
		margin-bottom: 10px;
	}

	.type-row {
		display: flex;
		align-items: baseline;
		gap: 16px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
	}
	.type-row:last-child {
		border-bottom: 0;
	}
	.type-label {
		width: 52px;
		flex: none;
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-faint);
	}
	.hero-sample {
		font-size: var(--text-hero);
		font-weight: 800;
		line-height: var(--text-hero--line-height);
		letter-spacing: var(--text-hero--letter-spacing);
	}
	.title-sample {
		font-size: var(--text-title);
		font-weight: 700;
	}
	.body-sample {
		font-size: var(--text-body);
		color: var(--ink-soft);
	}
	.meta-sample {
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
	}
	.swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--ink-soft);
	}
	.chip {
		width: 56px;
		height: 56px;
		border-radius: var(--radius-card);
		border: 1px solid var(--line);
	}

	.row-wrap {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px;
	}
	@media (min-width: 560px) {
		.form-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.panel {
		padding: 14px 2px 2px;
		font-size: 14px;
		color: var(--ink-soft);
	}

	/* header klub, dipakai lewat snippet di AppShell (appbar HP & atas rail desktop) */
	.club-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.club-btn {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		background: none;
		border: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		padding: 4px;
		margin: -4px;
	}
	.dot {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		flex: none;
		background: var(--accent);
		color: #fff;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: 13px;
	}
	.club-txt {
		display: flex;
		flex-direction: column;
		text-align: left;
		min-width: 0;
	}
	.nm {
		font-weight: 700;
		font-size: 14.5px;
	}
	.cv {
		color: var(--ink-faint);
		font-size: 11px;
	}
	.avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		flex: none;
		background: var(--surface-2);
		border: 1px solid var(--line-2);
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 13px;
		color: var(--ink-soft);
	}

	@media (min-width: 768px) {
		.club-txt {
			display: none;
		}
		.club-btn {
			margin: 0 auto;
		}
		.club-row {
			justify-content: center;
		}
		/* Rail 768–1024px cuma cukup buat satu ikon — avatar profil pindah ke
		   menu lain begitu identitas sungguhan (F4) ada. Sementara disembunyikan
		   di sini biar tidak numpuk dengan dot klub. */
		.avatar {
			display: none;
		}
	}
	@media (min-width: 1024px) {
		.club-row {
			justify-content: space-between;
		}
		.avatar {
			display: grid;
		}
		.club-txt {
			display: flex;
		}
		.club-btn {
			margin: 0;
			width: 100%;
		}
	}
</style>
