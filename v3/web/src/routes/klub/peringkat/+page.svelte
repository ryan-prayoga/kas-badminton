<!--
	Papan peringkat (F7/3, PLAN.md §8.3) — klasemen menang-kalah + rentetan
	dari main harian berskor. Server balas 404 kalau saklar papan_peringkat
	dimatikan admin (leaderboard.go) — ditangani sebagai keadaan eksplisit,
	bukan daftar kosong yang membingungkan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe } from '$lib/stores/club.svelte';
	import { getLeaderboard, type Leaderboard } from '$lib/api/leaderboard';
	import { AppShell, Card, Badge } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';

	let createOpen = $state(false);
	let bootError = $state('');
	let board = $state<Leaderboard | null>(null);
	let disabled = $state(false);
	let loading = $state(false);
	let loadError = $state('');

	onMount(() => {
		if (!isLoggedIn()) {
			goto('/login');
			return;
		}
		void boot();
	});

	async function boot() {
		bootError = '';
		try {
			if (!hasLoadedMemberships()) await loadMe();
			await fetchBoard();
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchBoard() {
		const club = activeClub();
		if (!club) return;
		loading = true;
		loadError = '';
		disabled = false;
		try {
			board = await getLeaderboard(club.club_id);
		} catch (e) {
			if (e instanceof ApiError && e.code === 'not_found') {
				disabled = true;
			} else {
				loadError = e instanceof ApiError ? e.message : 'Gagal memuat papan peringkat. Coba lagi.';
			}
		} finally {
			loading = false;
		}
	}

	function streakLabel(n: number): string {
		if (n === 0) return '—';
		return n > 0 ? `${n}x menang` : `${Math.abs(n)}x kalah`;
	}
</script>

<svelte:head>
	<title>Papan Peringkat — Kok Badminton</title>
</svelte:head>

{#if !hasLoadedMemberships() || isLoadingMemberships()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<p style="color:var(--ink-faint);font-size:13px">Memuat…</p>
	</main>
{:else if bootError}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">{bootError}</p>
			<button class="retry" onclick={boot}>Coba lagi</button>
		</Card>
	</main>
{:else if !activeClub()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">Belum punya klub — balik ke Beranda buat bikin atau gabung klub dulu.</p>
			<a href="/" class="retry">Ke Beranda →</a>
		</Card>
	</main>
{:else}
	{@const club = activeClub()!}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={() => {}} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/klub" header={clubHeader}>
		<div class="page">
			<a href="/klub" class="back">← Klub</a>
			<div class="pagehead">
				<h1 class="h-title display">Papan Peringkat</h1>
				<p class="h-sub">{club.club_name}{board ? ` · musim ${board.season}` : ''}</p>
			</div>

			{#if disabled}
				<Card>
					<p class="hint">Papan peringkat dimatikan di klub ini. Admin bisa menyalakannya di pengaturan klub.</p>
				</Card>
			{:else if loadError}
				<Card>
					<p class="hint">{loadError}</p>
					<button class="retry" onclick={fetchBoard}>Coba lagi</button>
				</Card>
			{:else if loading && !board}
				<Card><p class="hint">Memuat papan peringkat…</p></Card>
			{:else if board && board.rows.length === 0}
				<Card>
					<p class="hint">Belum ada main berskor musim ini. Catat skor pas mencatat main biar klasemen mulai terisi.</p>
				</Card>
			{:else if board}
				<Card padded={false}>
					<div class="rows">
						{#each board.rows as row, i (row.user_id)}
							<div class="row">
								<span class="rank">{i + 1}</span>
								<div class="who">
									<span class="nm">{row.name}</span>
									<span class="stat">{row.won}M {row.lost}K · {row.played} main · {(row.win_rate_permil / 10).toFixed(1)}%</span>
								</div>
								<Badge tone={row.current_streak > 0 ? 'lunas' : row.current_streak < 0 ? 'belum' : 'netral'}>
									{streakLabel(row.current_streak)}
								</Badge>
							</div>
						{/each}
					</div>
				</Card>
			{/if}
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} />

<style>
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 10px;
	}
	.retry {
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0;
	}
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		font-weight: 600;
		text-decoration: none;
	}
	.h-title {
		font-size: 22px;
		font-weight: 800;
	}
	.h-sub {
		color: var(--ink-faint);
		font-size: 13px;
		margin-top: 2px;
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-top: 1px solid var(--line);
	}
	.row:first-child {
		border-top: 0;
	}
	.rank {
		width: 22px;
		font-weight: 800;
		color: var(--ink-faint);
		font-size: 14px;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nm {
		font-size: 14.5px;
		font-weight: 700;
	}
	.stat {
		font-size: 12px;
		color: var(--ink-faint);
	}
</style>
