<!--
	Turnamen (F7/2, PLAN.md §14 F7) — daftar turnamen klub aktif + buat
	baru. Sama pola boot/error dgn Main & Klub. Isi bagan/skor/kok/iuran
	ada di halaman detail (routes/turnamen/[id]).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe, setActiveClub } from '$lib/stores/club.svelte';
	import { listTournaments, type Tournament } from '$lib/api/tournaments';
	import { AppShell, Card, Badge, Button } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import CreateTournamentDialog from '$lib/components/CreateTournamentDialog.svelte';
	import { tanggalPendek } from '$lib/format';

	const FORMAT_LABEL: Record<string, string> = { knockout: 'Gugur langsung', round_robin: 'Setengah kompetisi' };
	const STATUS_TONE: Record<string, 'lunas' | 'belum' | 'accent' | 'netral'> = {
		selesai: 'lunas',
		berjalan: 'accent',
		'akan-datang': 'netral'
	};
	const STATUS_LABEL: Record<string, string> = { selesai: 'Selesai', berjalan: 'Berjalan', 'akan-datang': 'Akan datang' };

	let createOpen = $state(false);
	let createTournamentOpen = $state(false);
	let tournaments = $state<Tournament[]>([]);
	let loading = $state(false);
	let listError = $state('');
	let bootError = $state('');

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
			const club = activeClub();
			if (club) await fetchTournaments(club.club_id);
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchTournaments(clubId: string) {
		loading = true;
		listError = '';
		try {
			tournaments = await listTournaments(clubId);
		} catch (e) {
			listError = e instanceof ApiError ? e.message : 'Gagal memuat daftar turnamen. Coba lagi.';
		} finally {
			loading = false;
		}
	}

	async function onSwitchClub(clubId: string) {
		setActiveClub(clubId);
		await fetchTournaments(clubId);
	}

	function onTournamentCreated(t: Tournament) {
		tournaments = [t, ...tournaments];
		goto(`/turnamen/${t.id}`);
	}

	function championLine(t: Tournament): string {
		if (!t.champion) return '';
		const names = [t.champion.a?.name, t.champion.b?.name].filter(Boolean);
		return names.length ? `Juara: ${names.join(' / ')}` : '';
	}
</script>

<svelte:head>
	<title>Turnamen — Kok Badminton</title>
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
	{@const club = activeClub()}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={onSwitchClub} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/turnamen" header={clubHeader}>
		<div class="page">
			<div class="pagehead">
				<div>
					<h1 class="h-title display">Turnamen {club!.club_name}</h1>
					<p class="h-sub">{tournaments.length} turnamen tercatat</p>
				</div>
				<Button variant="primary" onclick={() => (createTournamentOpen = true)}>+ Buat turnamen</Button>
			</div>

			<Card padded={false}>
				{#if listError}
					<div class="state">
						<p class="hint">{listError}</p>
						<button class="retry" onclick={() => fetchTournaments(club!.club_id)}>Coba lagi</button>
					</div>
				{:else if loading && tournaments.length === 0}
					<div class="state"><p class="hint">Memuat turnamen…</p></div>
				{:else if tournaments.length === 0}
					<div class="state">
						<p class="hint">Belum ada turnamen. Mulai dari tombol "+ Buat turnamen" di atas.</p>
					</div>
				{:else}
					{#each tournaments as t, i (t.id)}
						<a href="/turnamen/{t.id}" class="t-row" class:last={i === tournaments.length - 1}>
							<div class="t-meta">
								<span class="t-name">{t.name}</span>
								<div class="t-sub">
									<span class="t-date">{tanggalPendek(t.starts_on)}</span>
									<Badge tone="netral">{FORMAT_LABEL[t.format] ?? t.format}</Badge>
									<Badge tone={STATUS_TONE[t.status] ?? 'netral'}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
								</div>
								{#if championLine(t)}<p class="champ">{championLine(t)}</p>{/if}
							</div>
							<span class="chev">›</span>
						</a>
					{/each}
				{/if}
			</Card>
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} />
{#if activeClub()}
	<CreateTournamentDialog bind:open={createTournamentOpen} clubId={activeClub()!.club_id} onCreated={onTournamentCreated} />
{/if}

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
		gap: 16px;
	}
	.pagehead {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 2px;
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
	.state {
		padding: 24px 16px;
		text-align: center;
	}
	.state .hint {
		margin-bottom: 6px;
	}
	.t-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		text-decoration: none;
	}
	.t-row.last {
		border-bottom: 0;
	}
	.t-meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.t-name {
		font-size: 15px;
		font-weight: 700;
	}
	.t-sub {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.t-date {
		font-size: 12.5px;
		color: var(--ink-faint);
	}
	.champ {
		font-size: 12.5px;
		color: var(--lunas);
		font-weight: 600;
	}
	.chev {
		color: var(--ink-faint);
		font-size: 18px;
		flex: none;
	}
</style>
