<script lang="ts">
	// Halaman publik klub (PLAN.md §6.3, §14 F9) — TANPA auth, TANPA
	// AppShell (bukan bagian app.kaskok.my.id yang login). Konsumsi
	// /api/v1/public/clubs/{slug}/* apa adanya: 404 dari server (klub
	// tidak ada ATAU halaman_publik mati) ditangani SATU cara di sini,
	// server sengaja tidak membedakan keduanya (public.go).
	//
	// Bagan turnamen lengkap SENGAJA belum dirender di sini — cuma
	// ringkasan (nama, format, status, juara). Bagan penuh disusul di
	// iterasi berikutnya; endpoint publiknya sudah ada
	// (GET .../tournaments/{id}) kalau UI-nya menyusul.
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api/client';
	import { Card, Badge } from '$lib/components/ui';
	import { rupiah } from '$lib/format';

	const slug = page.params.slug;

	type ClubInfo = {
		slug: string;
		name: string;
		timezone: string;
		transparansi_kas: boolean;
		papan_peringkat: boolean;
		member_count: number;
		game_count: number;
		tournament_count: number;
	};
	type Treasury = { kas_klub: number; titipan_pemain: number; iuran_turnamen: number };
	type BillItem = { user_id: string; display_name: string; total_owed: number };
	type LeaderboardRow = { user_id: string; name: string; played: number; won: number; lost: number };
	type TournamentSummary = {
		id: string;
		name: string;
		starts_on: string;
		format: string;
		status: string;
		played_count: number;
		total_count: number;
		champion?: { label: string } | null;
	};

	type Step = 'loading' | 'not_found' | 'ready';
	let step = $state<Step>('loading');
	let club = $state<ClubInfo | null>(null);
	let treasury = $state<Treasury | null>(null);
	let bills = $state<BillItem[]>([]);
	let leaderboard = $state<LeaderboardRow[]>([]);
	let tournaments = $state<TournamentSummary[]>([]);

	onMount(load);

	async function load() {
		try {
			club = await api.get<ClubInfo>(`/public/clubs/${slug}`);
		} catch (e) {
			step = e instanceof ApiError && e.code === 'not_found' ? 'not_found' : 'not_found';
			return;
		}
		step = 'ready';

		// Sisanya boleh gagal sendiri-sendiri (saklar per bagian, §6.3) —
		// satu bagian mati tidak boleh menjatuhkan seluruh halaman.
		void loadTreasury();
		void loadBills();
		void loadLeaderboard();
		void loadTournaments();
	}

	async function loadTreasury() {
		try {
			treasury = await api.get<Treasury>(`/public/clubs/${slug}/treasury`);
		} catch {
			treasury = null;
		}
	}
	async function loadBills() {
		try {
			const res = await api.get<{ items: BillItem[] }>(`/public/clubs/${slug}/bills`);
			bills = res.items;
		} catch {
			bills = [];
		}
	}
	async function loadLeaderboard() {
		try {
			const res = await api.get<{ rows: LeaderboardRow[] }>(`/public/clubs/${slug}/leaderboard`);
			leaderboard = res.rows.slice(0, 5);
		} catch {
			leaderboard = [];
		}
	}
	async function loadTournaments() {
		try {
			const res = await api.get<{ items: TournamentSummary[] }>(`/public/clubs/${slug}/tournaments`);
			tournaments = res.items;
		} catch {
			tournaments = [];
		}
	}
</script>

<svelte:head>
	<title>{club ? club.name : slug} · Kok Badminton</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
	{#if step === 'loading'}
		<p class="muted">Memuat...</p>
	{:else if step === 'not_found'}
		<Card>
			<h1>Halaman tidak ditemukan</h1>
			<p class="muted">
				Klub ini belum membuka halaman publiknya, atau alamatnya salah ketik.
			</p>
		</Card>
	{:else if club}
		<header class="hero">
			<h1>{club.name}</h1>
			<p class="muted">
				{club.member_count} anggota · {club.game_count} main tercatat
				{#if club.tournament_count > 0}· {club.tournament_count} turnamen{/if}
			</p>
		</header>

		{#if treasury}
			<Card>
				<h2>Kas klub</h2>
				<div class="stat-row">
					<div>
						<div class="stat-value">{rupiah(treasury.kas_klub)}</div>
						<div class="stat-label">Kas klub</div>
					</div>
					<div>
						<div class="stat-value">{rupiah(treasury.titipan_pemain)}</div>
						<div class="stat-label">Titipan pemain</div>
					</div>
					<div>
						<div class="stat-value">{rupiah(treasury.iuran_turnamen)}</div>
						<div class="stat-label">Iuran turnamen</div>
					</div>
				</div>
			</Card>
		{/if}

		{#if bills.length > 0}
			<Card>
				<h2>Sisa patungan</h2>
				<ul class="list">
					{#each bills as item (item.user_id)}
						<li>
							<span>{item.display_name}</span>
							<Badge tone="belum">{rupiah(item.total_owed)}</Badge>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}

		{#if leaderboard.length > 0}
			<Card>
				<h2>Papan peringkat</h2>
				<ul class="list">
					{#each leaderboard as row (row.user_id)}
						<li>
							<span>{row.name}</span>
							<span class="muted">{row.won}M-{row.lost}K dari {row.played} main</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}

		{#if tournaments.length > 0}
			<Card>
				<h2>Turnamen</h2>
				<ul class="list">
					{#each tournaments as t (t.id)}
						<li>
							<span>{t.name}</span>
							<span class="muted">
								{#if t.champion}Juara: {t.champion.label}{:else}{t.played_count}/{t.total_count} partai{/if}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>

<style>
	.wrap {
		max-width: 640px;
		margin: 0 auto;
		padding: 24px 16px 48px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.hero h1 {
		font-size: 32px;
		font-weight: 800;
		margin: 0 0 4px;
	}
	.muted {
		color: var(--ink-faint);
		font-size: 13px;
	}
	h2 {
		font-size: 15px;
		font-weight: 700;
		margin: 0 0 12px;
	}
	.stat-row {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
	}
	.stat-value {
		font-size: 24px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.stat-label {
		font-size: 13px;
		color: var(--ink-faint);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 15px;
		border-bottom: 1px solid var(--line);
		padding-bottom: 10px;
	}
	.list li:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}
</style>
