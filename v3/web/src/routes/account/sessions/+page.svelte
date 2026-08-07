<script lang="ts">
	// Daftar perangkat (PLAN.md §7.2.2) — "bukan pelengkap": HP hilang/dijual
	// adalah cara paling mungkin orang lain masuk ke akun seseorang, dan ini
	// satu-satunya layar yang bisa menutupnya sendiri tanpa admin.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Button, Card, toast } from '$lib/components/ui';
	import { api, ApiError } from '$lib/api/client';
	import { isLoggedIn, clearSession } from '$lib/stores/session.svelte';

	type Session = { id: string; device_label: string; last_seen_at: string; created_at: string };

	let sessions = $state<Session[]>([]);
	let loading = $state(true);

	onMount(async () => {
		if (!isLoggedIn()) {
			goto('/login');
			return;
		}
		await load();
	});

	async function load() {
		loading = true;
		try {
			sessions = await api.get<Session[]>('/auth/sessions');
		} catch (e) {
			if (e instanceof ApiError && e.code === 'unauthenticated') {
				// Sesi INI yang barusan dikeluarkan (mis. "Keluarkan" ditekan pada
				// baris perangkat yang sedang dipakai) — bukan galat, ini logout.
				clearSession();
				toast('Kamu keluar dari perangkat ini.', { tone: 'netral' });
				goto('/login');
				return;
			}
			toast('Gagal memuat daftar perangkat.', { tone: 'hancur' });
		} finally {
			loading = false;
		}
	}

	async function revoke(id: string) {
		try {
			await api.del(`/auth/sessions/${id}`);
			toast('Perangkat dikeluarkan.', { tone: 'lunas' });
			await load();
		} catch {
			toast('Gagal mengeluarkan perangkat.', { tone: 'hancur' });
		}
	}

	async function revokeOthers() {
		try {
			await api.post('/auth/sessions/revoke-others');
			toast('Semua perangkat lain dikeluarkan.', { tone: 'lunas' });
			await load();
		} catch {
			toast('Gagal mengeluarkan perangkat lain.', { tone: 'hancur' });
		}
	}

	function fmt(iso: string) {
		try {
			return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
		} catch {
			return iso;
		}
	}
</script>

<svelte:head>
	<title>Perangkat & sesi — Kok Badminton</title>
</svelte:head>

<main class="page">
	<div class="wrap">
		<a href="/" class="back">← Beranda</a>
		<h1 class="display">Perangkat & sesi</h1>
		<p class="hint">Perangkat yang sedang masuk ke akunmu. Keluarkan yang tidak kamu kenali.</p>

		{#if loading}
			<p class="hint">Memuat…</p>
		{:else if sessions.length === 0}
			<Card>
				<p class="hint">Tidak ada perangkat aktif.</p>
			</Card>
		{:else}
			<Card padded={false}>
				{#each sessions as s, i (s.id)}
					<div class="row" class:last={i === sessions.length - 1}>
						<div>
							<b>{s.device_label || 'Perangkat tidak dikenal'}</b>
							<p class="hint">Terakhir aktif {fmt(s.last_seen_at)}</p>
						</div>
						<Button variant="destructive" onclick={() => revoke(s.id)}>Keluarkan</Button>
					</div>
				{/each}
			</Card>

			{#if sessions.length > 1}
				<Button variant="secondary" onclick={revokeOthers}>Keluarkan semua perangkat lain</Button>
			{/if}
		{/if}
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
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
	}
	.row.last {
		border-bottom: 0;
	}
</style>
