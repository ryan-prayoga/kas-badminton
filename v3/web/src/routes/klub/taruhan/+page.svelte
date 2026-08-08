<!--
	Taruhan barang (F7/4, PLAN.md §8.4) — ledger terpisah TANPA rupiah,
	tidak pernah menyentuh kas/deposit/tagihan. "2 Pocari", siapa berutang
	ke siapa, lunas atau belum — itu saja.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn, currentUser } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe } from '$lib/stores/club.svelte';
	import { listSideBets, createSideBet, updateSideBetStatus, type SideBet } from '$lib/api/sideBets';
	import { AppShell, Card, Badge, Button, toast } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import PlayerPicker from '$lib/components/PlayerPicker.svelte';

	let createOpen = $state(false);
	let bootError = $state('');
	let bets = $state<SideBet[]>([]);
	let names = $state<Record<string, string>>({});
	let loading = $state(false);
	let loadError = $state('');
	let showAll = $state(false);

	type Picked = { userId: string; displayName: string } | null;
	let debtor = $state<Picked>(null);
	let creditor = $state<Picked>(null);
	let item = $state('');
	let submitting = $state(false);
	let formError = $state('');
	let updating = $state<string | null>(null);

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
			await fetchBets();
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchBets() {
		const club = activeClub();
		if (!club) return;
		loading = true;
		loadError = '';
		try {
			bets = await listSideBets(club.club_id, !showAll);
		} catch (e) {
			loadError = e instanceof ApiError ? e.message : 'Gagal memuat daftar taruhan. Coba lagi.';
		} finally {
			loading = false;
		}
	}

	function rememberName(p: Picked) {
		if (p) names = { ...names, [p.userId]: p.displayName };
	}

	async function submit() {
		const club = activeClub();
		if (!club) return;
		if (!debtor || !creditor) {
			formError = 'Pilih siapa berutang dan siapa yang ditunggu.';
			return;
		}
		if (debtor.userId === creditor.userId) {
			formError = 'Yang berutang dan yang ditunggu tidak boleh orang yang sama.';
			return;
		}
		if (!item.trim()) {
			formError = 'Isi taruhannya apa dulu (mis. "2 Pocari").';
			return;
		}
		rememberName(debtor);
		rememberName(creditor);
		formError = '';
		submitting = true;
		try {
			const bet = await createSideBet(club.club_id, { debtor_id: debtor.userId, creditor_id: creditor.userId, item: item.trim() });
			bets = [bet, ...bets];
			debtor = null;
			creditor = null;
			item = '';
			toast('Taruhan tercatat.', { tone: 'netral' });
		} catch (e) {
			formError = e instanceof ApiError ? e.message : 'Gagal mencatat taruhan. Coba lagi.';
		} finally {
			submitting = false;
		}
	}

	async function onUpdateStatus(bet: SideBet, status: 'settled' | 'cancelled') {
		const club = activeClub();
		if (!club) return;
		updating = bet.id;
		try {
			const updated = await updateSideBetStatus(club.club_id, bet.id, status);
			bets = bets.map((b) => (b.id === updated.id ? updated : b));
			if (!showAll) bets = bets.filter((b) => b.id !== bet.id);
			toast(status === 'settled' ? 'Taruhan ditandai lunas.' : 'Taruhan dibatalkan.', { tone: 'netral' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal mengubah taruhan.', { tone: 'hancur' });
		} finally {
			updating = null;
		}
	}

	function nameOf(userId: string): string {
		return names[userId] ?? userId.slice(0, 8);
	}

	const STATUS_LABEL: Record<string, string> = { open: 'Belum lunas', settled: 'Lunas', cancelled: 'Batal' };
	const STATUS_TONE: Record<string, 'lunas' | 'belum' | 'netral'> = { open: 'belum', settled: 'lunas', cancelled: 'netral' };
</script>

<svelte:head>
	<title>Taruhan — Kok Badminton</title>
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
				<h1 class="h-title display">Taruhan</h1>
				<p class="h-sub">{club.club_name} · Pocari, gorengan, dan sejenisnya — bukan uang kas</p>
			</div>

			<Card>
				<p class="lbl">Catat taruhan baru</p>
				<div class="new-bet">
					<PlayerPicker clubId={club.club_id} label="Yang berutang" bind:value={debtor} excludeIds={creditor ? [creditor.userId] : []} />
					<PlayerPicker clubId={club.club_id} label="Yang ditunggu" bind:value={creditor} excludeIds={debtor ? [debtor.userId] : []} />
					<input type="text" placeholder="Apa taruhannya? mis. 2 Pocari" bind:value={item} />
					{#if formError}<p class="err">{formError}</p>{/if}
					<Button variant="primary" disabled={submitting} onclick={submit}>
						{submitting ? 'Menyimpan…' : 'Catat taruhan'}
					</Button>
				</div>
			</Card>

			<div class="toggle-row">
				<button type="button" class="toggle" class:active={!showAll} onclick={() => { showAll = false; fetchBets(); }}>
					Belum lunas
				</button>
				<button type="button" class="toggle" class:active={showAll} onclick={() => { showAll = true; fetchBets(); }}>
					Semua
				</button>
			</div>

			<Card padded={false}>
				{#if loadError}
					<div class="state">
						<p class="hint">{loadError}</p>
						<button class="retry" onclick={fetchBets}>Coba lagi</button>
					</div>
				{:else if loading && bets.length === 0}
					<div class="state"><p class="hint">Memuat taruhan…</p></div>
				{:else if bets.length === 0}
					<div class="state"><p class="hint">Belum ada taruhan tercatat.</p></div>
				{:else}
					{#each bets as bet, i (bet.id)}
						<div class="bet-row" class:last={i === bets.length - 1}>
							<div class="bet-main">
								<p class="bet-item">{bet.item}</p>
								<p class="bet-parties">{nameOf(bet.debtor_id)} → {nameOf(bet.creditor_id)}</p>
							</div>
							<Badge tone={STATUS_TONE[bet.status] ?? 'netral'}>{STATUS_LABEL[bet.status] ?? bet.status}</Badge>
							{#if bet.status === 'open' && (bet.debtor_id === currentUser()?.id || bet.creditor_id === currentUser()?.id)}
								<div class="bet-actions">
									<button
										type="button"
										class="mini-btn"
										disabled={updating === bet.id}
										onclick={() => onUpdateStatus(bet, 'settled')}
									>
										Lunas
									</button>
									<button
										type="button"
										class="mini-btn ghost"
										disabled={updating === bet.id}
										onclick={() => onUpdateStatus(bet, 'cancelled')}
									>
										Batal
									</button>
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
	.lbl {
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-soft);
		margin-bottom: 10px;
	}
	.new-bet {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.new-bet input[type='text'] {
		height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 15px;
	}
	.err {
		font-size: 13px;
		color: var(--hancur);
	}
	.toggle-row {
		display: flex;
		gap: 6px;
	}
	.toggle {
		border: 1px solid var(--line-2);
		background: var(--surface);
		border-radius: 999px;
		padding: 6px 14px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.toggle.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.state {
		padding: 24px 16px;
		text-align: center;
	}
	.bet-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.bet-row.last {
		border-bottom: 0;
	}
	.bet-main {
		flex: 1;
		min-width: 0;
	}
	.bet-item {
		font-size: 14px;
		font-weight: 700;
	}
	.bet-parties {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.bet-actions {
		display: flex;
		gap: 4px;
		flex: none;
	}
	.mini-btn {
		border: 1px solid var(--line-2);
		background: var(--surface);
		border-radius: 999px;
		padding: 5px 10px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
		white-space: nowrap;
	}
	.mini-btn.ghost {
		color: var(--ink-soft);
	}
</style>
