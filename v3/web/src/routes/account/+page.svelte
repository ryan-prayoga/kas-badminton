<script lang="ts">
	// Hub akun (F8/2) — sebelumnya avatar di header tidak mengarah ke
	// mana pun; halaman ini yang jadi tujuannya (§5.4 "profil, pemilih
	// klub, dan pengaturan ada di avatar pojok header").
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn, currentUser, clearSession } from '$lib/stores/session.svelte';
	import { Card, Button, toast } from '$lib/components/ui';
	import { api } from '$lib/api/client';

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
			<a href="/account/sessions" class="row last">
				<span>Perangkat & sesi</span>
				<span class="chev">→</span>
			</a>
		</Card>

		<Button variant="destructive" onclick={logout}>Keluar</Button>
	</div>
</main>

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
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		text-decoration: none;
		font-size: 14.5px;
		font-weight: 600;
	}
	.row.last {
		border-bottom: 0;
	}
	.chev {
		color: var(--ink-faint);
	}
</style>
