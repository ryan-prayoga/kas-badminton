<script lang="ts">
	// Hub akun (F8/2) — sebelumnya avatar di header tidak mengarah ke
	// mana pun; halaman ini yang jadi tujuannya (§5.4 "profil, pemilih
	// klub, dan pengaturan ada di avatar pojok header").
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn, currentUser, clearSession } from '$lib/stores/session.svelte';
	import { Card, Button, Dialog, toast } from '$lib/components/ui';
	import { api, ApiError } from '$lib/api/client';

	onMount(() => {
		if (!isLoggedIn()) goto('/login');
	});

	async function logout() {
		try {
			await api.post('/auth/logout');
		} catch {
			// tetap keluar lokal walau request gagal (offline dsb) — sesi
			// klien harus berhenti dipakai apa pun yang terjadi di server.
		}
		clearSession();
		toast('Kamu keluar.', { tone: 'netral' });
		goto('/login');
	}

	// Ekspor & hapus akun (PLAN.md §12, F9/4). "Ekspor mengembalikan data
	// pribadi orang itu" — diunduh langsung sebagai berkas JSON, bukan
	// ditampilkan di layar (isinya seluruh riwayat main/bayar lintas klub,
	// bukan sesuatu yang enak dibaca di HP).
	let exporting = $state(false);
	async function exportData() {
		exporting = true;
		try {
			const data = await api.get('/me/export');
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'data-saya.json';
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal mengunduh data.', { tone: 'hancur' });
		} finally {
			exporting = false;
		}
	}

	// Konfirmasi menyebutkan akibatnya secara konkret (§5.6.1), bukan
	// "Apakah Anda yakin?" — dan dua langkah (dialog + tombol merah di
	// dalamnya) karena ini SATU-SATUNYA aksi akun yang benar-benar tanpa
	// jalan balik dari sisi pengguna sendiri (handleDeleteMe, account.go).
	let confirmDelete = $state(false);
	let deleting = $state(false);
	async function deleteAccount() {
		deleting = true;
		try {
			await api.post('/me/delete');
			clearSession();
			toast('Akun kamu sudah dihapus.', { tone: 'netral' });
			goto('/login');
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menghapus akun.', { tone: 'hancur' });
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>Akun — Kok Badminton</title>
</svelte:head>

<main class="page">
	<div class="wrap">
		<a href="/" class="back">← Beranda</a>
		<h1 class="display">{currentUser()?.display_name ?? 'Akun'}</h1>

		<Card padded={false}>
			<a href="/account/notifikasi" class="row">
				<span>Notifikasi</span>
				<span class="chev">→</span>
			</a>
			<a href="/account/sessions" class="row">
				<span>Perangkat & sesi</span>
				<span class="chev">→</span>
			</a>
			<a href="/privasi" class="row last">
				<span>Kebijakan privasi</span>
				<span class="chev">→</span>
			</a>
		</Card>

		<Card padded={false}>
			<button class="row" onclick={exportData} disabled={exporting}>
				<span>{exporting ? 'Menyiapkan berkas…' : 'Unduh data saya'}</span>
				<span class="chev">↓</span>
			</button>
			<button class="row last danger" onclick={() => (confirmDelete = true)}>
				<span>Hapus akun</span>
				<span class="chev">→</span>
			</button>
		</Card>

		<Button variant="destructive" onclick={logout}>Keluar</Button>
	</div>
</main>

<Dialog bind:open={confirmDelete} title="Hapus akun ini?">
	<p class="confirm-text">
		Nomor, nama, dan username kamu dilepas dari akun ini — orangnya jadi tampil sebagai
		<strong>"Pemain terhapus"</strong> di riwayat lama. Tagihan dan pembayaran yang sudah tercatat
		<strong>tetap ada</strong> di pembukuan klub (bukan urusan pribadi lagi begitu tercatat).
		Kamu akan keluar dari semua perangkat dan tidak bisa masuk lagi pakai nomor ini.
	</p>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (confirmDelete = false)}>Batal</Button>
		<Button variant="destructive" onclick={deleteAccount} disabled={deleting}>
			{deleting ? 'Menghapus…' : 'Ya, hapus akun'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.page {
		min-height: 100dvh;
		background: var(--bg);
		padding: 24px 20px;
	}
	.wrap {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		text-decoration: none;
	}
	h1 {
		font-size: 22px;
		font-weight: 800;
	}
	.row {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		border-left: 0;
		border-right: 0;
		border-top: 0;
		background: none;
		color: var(--ink);
		text-decoration: none;
		font-size: 14.5px;
		font-weight: 600;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	.row:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.row.last {
		border-bottom: 0;
	}
	.row.danger {
		color: var(--hancur);
	}
	.confirm-text {
		font-size: 14px;
		line-height: 1.5;
		color: var(--ink-soft);
	}
	.chev {
		color: var(--ink-faint);
	}
</style>
