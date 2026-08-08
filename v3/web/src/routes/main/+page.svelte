<!--
	Main (F5/5, PLAN.md §14 F5 + §8) — daftar main klub aktif + catat main
	baru. Sama pola boot/error dgn Beranda & Klub. Batalkan cepat (§9.4):
	toast dengan tombol "Batalkan" hidup 8 detik persis setelah catat main;
	sanggahan (§9.4) ada di baris detail tiap main, HAK PEMAIN sendiri.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn, currentUser } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe, setActiveClub } from '$lib/stores/club.svelte';
	import {
		listGames,
		getGame,
		undoGame,
		disputeGamePlayer,
		type GameSummary,
		type Game
	} from '$lib/api/games';
	import { settleBet } from '$lib/api/sideBets';
	import { AppShell, Card, Badge, Button, toast } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import RecordGameDialog from '$lib/components/RecordGameDialog.svelte';
	import { rupiah, tanggalPendek } from '$lib/format';

	const SCORE_FORMAT_LABEL: Record<string, string> = {
		single: 'sampai 30',
		bo3: 'rally 21 bo3',
		rally42: 'rally 42'
	};

	let createOpen = $state(false);
	let recordOpen = $state(false);
	let games = $state<GameSummary[]>([]);
	let gamesLoading = $state(false);
	let gamesError = $state('');
	let bootError = $state('');
	let expandedId = $state<string | null>(null);
	let detailCache = $state<Record<string, Game>>({});
	let detailLoading = $state<string | null>(null);
	let settlingId = $state<string | null>(null);

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
			if (club) await fetchGames(club.club_id);
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchGames(clubId: string) {
		gamesLoading = true;
		gamesError = '';
		try {
			const res = await listGames(clubId, 30);
			games = res.items;
		} catch (e) {
			gamesError = e instanceof ApiError ? e.message : 'Gagal memuat daftar main. Coba lagi.';
		} finally {
			gamesLoading = false;
		}
	}

	async function onSwitchClub(clubId: string) {
		setActiveClub(clubId);
		expandedId = null;
		detailCache = {};
		await fetchGames(clubId);
	}

	function onGameCreated(game: Game) {
		games = [game, ...games];
		toast('Main dicatat.', {
			tone: 'lunas',
			closeDelay: 8500,
			action: { label: 'Batalkan', onClick: () => onUndo(game.id) }
		});
	}

	async function onUndo(gameId: string) {
		const club = activeClub();
		if (!club) return;
		try {
			await undoGame(club.club_id, gameId);
			games = games.filter((g) => g.id !== gameId);
			delete detailCache[gameId];
			if (expandedId === gameId) expandedId = null;
			toast('Main dibatalkan.', { tone: 'netral' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal membatalkan. Coba lagi.', { tone: 'hancur' });
		}
	}

	async function toggleExpand(gameId: string) {
		if (expandedId === gameId) {
			expandedId = null;
			return;
		}
		expandedId = gameId;
		const club = activeClub();
		if (!club || detailCache[gameId]) return;
		detailLoading = gameId;
		try {
			detailCache = { ...detailCache, [gameId]: await getGame(club.club_id, gameId) };
		} catch {
			// biarkan panel kosong — retry cukup dgn menutup-buka lagi.
		} finally {
			detailLoading = null;
		}
	}

	// Taruhan kok "yang kalah bayar kok" (§8.2, §8.4) — preset payer_id,
	// bukan mekanisme baru. Cuma tampil kalau main ini sudah ada skornya
	// (butuh pemenang buat tahu sisi mana yang kalah).
	async function onSettleBet(gameId: string) {
		const club = activeClub();
		if (!club) return;
		settlingId = gameId;
		try {
			await settleBet(club.club_id, gameId);
			detailCache = { ...detailCache, [gameId]: await getGame(club.club_id, gameId) };
			toast('Tagihan kok dipindah ke sisi yang kalah.', { tone: 'lunas' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal memindah tagihan kok.', { tone: 'hancur' });
		} finally {
			settlingId = null;
		}
	}

	async function onDispute(gameId: string, userId: string) {
		const club = activeClub();
		if (!club) return;
		try {
			await disputeGamePlayer(club.club_id, gameId, userId, 'Saya tidak ikut main ini.');
			detailCache = { ...detailCache, [gameId]: await getGame(club.club_id, gameId) };
			toast('Tersanggah — pencatat & bendahara diberi tahu, tagihan ditahan sampai selesai.', { tone: 'netral' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menyanggah. Coba lagi.', { tone: 'hancur' });
		}
	}
</script>

<svelte:head>
	<title>Main — Kok Badminton</title>
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

	<AppShell current="/main" header={clubHeader}>
		<div class="page">
			<div class="pagehead">
				<div>
					<h1 class="h-title display">Main {club!.club_name}</h1>
					<p class="h-sub">{games.length} main tercatat</p>
				</div>
				<Button variant="primary" onclick={() => (recordOpen = true)}>+ Catat main</Button>
			</div>

			<Card padded={false}>
				{#if gamesError}
					<div class="state">
						<p class="hint">{gamesError}</p>
						<button class="retry" onclick={() => fetchGames(club!.club_id)}>Coba lagi</button>
					</div>
				{:else if gamesLoading && games.length === 0}
					<div class="state"><p class="hint">Memuat main…</p></div>
				{:else if games.length === 0}
					<div class="state">
						<p class="hint">Belum ada main tercatat. Mulai dari tombol "+ Catat main" di atas.</p>
					</div>
				{:else}
					{#each games as g, i (g.id)}
						{@const detail = detailCache[g.id]}
						<div class="game" class:last={i === games.length - 1}>
							<button type="button" class="game-row" onclick={() => toggleExpand(g.id)}>
								<div class="meta">
									<span class="date">{tanggalPendek(g.played_on)}</span>
									<Badge tone="netral">{g.format}</Badge>
									{#if g.winner_side}
										<Badge tone="accent">
											Menang {g.winner_side.toUpperCase()} · {SCORE_FORMAT_LABEL[g.score_format ?? ''] ?? g.score_format}
										</Badge>
									{/if}
								</div>
								<span class="chev" class:open={expandedId === g.id}>›</span>
							</button>

							{#if expandedId === g.id}
								<div class="detail">
									{#if detailLoading === g.id}
										<p class="hint">Memuat detail…</p>
									{:else if detail}
										{#if detail.score?.length}
											<p class="score-line">
												Skor: {detail.score.map((s) => `${s.a}-${s.b}`).join(', ')}
											</p>
										{/if}
										<div class="players">
											{#each detail.players as p (p.id)}
												<div class="player-row">
													<span class="who">
														Sisi {p.side.toUpperCase()} · {rupiah(p.amount)}
														{#if p.payer_id !== p.user_id}<span class="sub">ditanggung orang lain</span>{/if}
														{#if p.disputed_at}<span class="sub disputed">disanggah</span>{/if}
													</span>
													{#if p.user_id === currentUser()?.id && !p.disputed_at}
														<button class="dispute-btn" onclick={() => onDispute(g.id, p.user_id)}>
															Saya tidak ikut
														</button>
													{/if}
												</div>
											{/each}
										</div>
										{#if detail.notes}<p class="notes">"{detail.notes}"</p>{/if}
										{#if detail.winner_side}
											<button class="settle-btn" disabled={settlingId === g.id} onclick={() => onSettleBet(g.id)}>
												{settlingId === g.id ? 'Memindah…' : 'Taruhan kok: yang kalah bayar'}
											</button>
										{/if}
									{:else}
										<p class="hint">Gagal memuat detail. Tutup lalu buka lagi.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</Card>
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} />
{#if activeClub()}
	<RecordGameDialog bind:open={recordOpen} clubId={activeClub()!.club_id} onCreated={onGameCreated} />
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

	.game {
		border-bottom: 1px solid var(--line);
	}
	.game.last {
		border-bottom: 0;
	}
	.game-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		background: none;
		border: 0;
		cursor: pointer;
		text-align: left;
		font: inherit;
		color: var(--ink);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.date {
		font-size: 13.5px;
		font-weight: 600;
	}
	.chev {
		color: var(--ink-faint);
		font-size: 18px;
		transform: rotate(90deg);
		transition: transform var(--t-tap);
		flex: none;
	}
	.chev.open {
		transform: rotate(-90deg);
	}

	.detail {
		padding: 0 16px 14px;
	}
	.score-line {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-soft);
		margin-bottom: 8px;
	}
	.players {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.player-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 13px;
	}
	.who {
		color: var(--ink-soft);
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.sub {
		font-size: 11px;
		color: var(--ink-faint);
	}
	.sub.disputed {
		color: var(--hancur);
		font-weight: 700;
	}
	.dispute-btn {
		border: 0;
		background: none;
		color: var(--hancur);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		flex: none;
	}
	.notes {
		margin-top: 8px;
		font-size: 12.5px;
		color: var(--ink-faint);
		font-style: italic;
	}
	.settle-btn {
		margin-top: 10px;
		border: 1px solid var(--line-2);
		background: var(--surface-2);
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
	}
</style>
