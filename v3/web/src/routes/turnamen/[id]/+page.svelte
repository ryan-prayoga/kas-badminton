<!--
	Detail turnamen (F7/2, PLAN.md §14 F7 + API.md §5) — bagan/klasemen,
	isi skor, kok (partai & umum), status iuran. Bagan/klasemen SUDAH
	DIHITUNG SERVER di respons GET (tournaments.go EnrichTournament) —
	halaman ini murni menampilkan, tidak pernah menghitung pemenang sendiri.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, hasManageMoney, loadMe } from '$lib/stores/club.svelte';
	import {
		getTournament,
		markFeePaid,
		markKokChargesPaid,
		type Tournament,
		type BracketMatch,
		type TournamentPair
	} from '$lib/api/tournaments';
	import { AppShell, Card, Badge, Button, toast } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import ScoreMatchDialog from '$lib/components/ScoreMatchDialog.svelte';
	import AddKokDialog from '$lib/components/AddKokDialog.svelte';
	import { rupiah, tanggalPendek } from '$lib/format';

	const id = page.params.id!;

	const STATUS_TONE: Record<string, 'lunas' | 'belum' | 'accent' | 'netral'> = {
		selesai: 'lunas',
		berjalan: 'accent',
		'akan-datang': 'netral'
	};
	const STATUS_LABEL: Record<string, string> = { selesai: 'Selesai', berjalan: 'Berjalan', 'akan-datang': 'Akan datang' };
	const FORMAT_LABEL: Record<string, string> = { knockout: 'Gugur langsung', round_robin: 'Setengah kompetisi' };

	let createOpen = $state(false);
	let bootError = $state('');
	let t = $state<Tournament | null>(null);
	let loadError = $state('');
	let loading = $state(false);

	let scoreOpen = $state(false);
	let scoringMatch = $state<BracketMatch | null>(null);
	let kokOpen = $state(false);
	let kokMatch = $state<BracketMatch | null>(null);
	let selectedCharges = $state<Set<string>>(new Set());
	let markingFee = $state<string | null>(null);
	let markingCharges = $state(false);

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
			await fetchTournament();
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchTournament() {
		const club = activeClub();
		if (!club) return;
		loading = true;
		loadError = '';
		try {
			t = await getTournament(club.club_id, id);
			selectedCharges = new Set();
		} catch (e) {
			loadError = e instanceof ApiError ? e.message : 'Gagal memuat turnamen. Coba lagi.';
		} finally {
			loading = false;
		}
	}

	function openScore(m: BracketMatch) {
		scoringMatch = m;
		scoreOpen = true;
	}
	function openKok(m: BracketMatch | null) {
		kokMatch = m;
		kokOpen = true;
	}
	function onUpdated(updated: Tournament) {
		t = updated;
		selectedCharges = new Set();
	}

	function pairLabel(pair?: TournamentPair): string {
		if (!pair) return '';
		const names = [pair.a?.name, pair.b?.name].filter(Boolean);
		return names.join(' / ');
	}
	function sideLabel(side: BracketMatch['a']): string {
		if (side.bye) return 'BYE';
		const label = pairLabel(side.pair);
		return label || 'Belum ditentukan';
	}
	function scoreLine(m: BracketMatch): string {
		if (!m.score?.games.length) return '';
		return m.score.games.map((g) => `${g.a}-${g.b}`).join(' · ');
	}
	function canAddKok(m: BracketMatch): boolean {
		return !m.a.bye && !m.b.bye;
	}

	async function onMarkFeePaid(userId: string) {
		const club = activeClub();
		if (!club) return;
		markingFee = userId;
		try {
			t = await markFeePaid(club.club_id, id, userId);
			toast('Iuran ditandai lunas.', { tone: 'lunas' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menandai iuran lunas.', { tone: 'hancur' });
		} finally {
			markingFee = null;
		}
	}

	function toggleCharge(chargeId: string) {
		const next = new Set(selectedCharges);
		if (next.has(chargeId)) next.delete(chargeId);
		else next.add(chargeId);
		selectedCharges = next;
	}

	async function onMarkChargesPaid() {
		const club = activeClub();
		if (!club || selectedCharges.size === 0) return;
		markingCharges = true;
		try {
			const res = await markKokChargesPaid(club.club_id, id, [...selectedCharges]);
			t = res.tournament;
			selectedCharges = new Set();
			const okCount = res.results.filter((r) => r.ok).length;
			toast(`${okCount} tagihan kok ditandai lunas.`, { tone: 'lunas' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menandai kok lunas.', { tone: 'hancur' });
		} finally {
			markingCharges = false;
		}
	}

	function matchLabel(matchId?: string): string {
		if (!matchId || !t?.matches) {
			// knockout: matches flat tidak dikirim, cari di rounds.
			if (!matchId || !t?.rounds) return 'Kok umum';
			for (const r of t.rounds) {
				const m = r.matches.find((x) => x.id === matchId);
				if (m) return m.title;
			}
			return 'Kok umum';
		}
		const m = t.matches.find((x) => x.id === matchId);
		return m?.title ?? 'Kok umum';
	}
</script>

<svelte:head>
	<title>{t?.name ?? 'Turnamen'} — Kok Badminton</title>
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
	{@const canManageMoney = hasManageMoney(club)}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={() => {}} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/turnamen" header={clubHeader}>
		<div class="page">
			<a href="/turnamen" class="back">← Semua turnamen</a>

			{#if loadError}
				<Card>
					<p class="hint">{loadError}</p>
					<button class="retry" onclick={fetchTournament}>Coba lagi</button>
				</Card>
			{:else if loading && !t}
				<Card><p class="hint">Memuat turnamen…</p></Card>
			{:else if t}
				<div class="pagehead">
					<div>
						<h1 class="h-title display">{t.name}</h1>
						<div class="t-sub">
							<span class="t-date">{tanggalPendek(t.starts_on)}{t.ends_on ? ` – ${tanggalPendek(t.ends_on)}` : ''}</span>
							<Badge tone="netral">{FORMAT_LABEL[t.format] ?? t.format}</Badge>
							<Badge tone={STATUS_TONE[t.status] ?? 'netral'}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
						</div>
					</div>
					<Button variant="secondary" onclick={() => openKok(null)}>+ Kok umum</Button>
				</div>

				{#if t.finished && t.champion}
					<Card>
						<p class="champ-title">🏆 Juara</p>
						<p class="champ-name display">{pairLabel(t.champion)}</p>
					</Card>
				{/if}

				<Card>
					<div class="cost-grid">
						<div>
							<p class="cost-lbl">Total kok</p>
							<p class="cost-val">{rupiah(t.cost.kok_total)}</p>
							<p class="cost-sub">{rupiah(t.cost.kok_paid)} lunas</p>
						</div>
						<div>
							<p class="cost-lbl">Iuran</p>
							<p class="cost-val">{rupiah(t.cost.fee_total)}</p>
							<p class="cost-sub">{t.cost.paid_count}/{t.cost.participants} orang lunas</p>
						</div>
					</div>
				</Card>

				{#if t.standings}
					<Card padded={false}>
						<p class="section-title">Klasemen</p>
						<div class="standings">
							{#each t.standings as row, i (row.pair.id ?? i)}
								<div class="stand-row">
									<span class="stand-rank">{i + 1}</span>
									<span class="stand-name">{pairLabel(row.pair)}</span>
									<span class="stand-stat">{row.won}M {row.lost}K</span>
									<span class="stand-diff">{row.diff > 0 ? '+' : ''}{row.diff}</span>
								</div>
							{/each}
						</div>
					</Card>
				{/if}

				<Card padded={false}>
					<p class="section-title">Partai</p>
					<div class="matches">
						{#if t.rounds}
							{#each t.rounds as round (round.round)}
								<p class="round-label">{round.label}</p>
								{#each round.matches as m (m.id)}
									{@render matchRow(m)}
								{/each}
							{/each}
						{:else if t.matches}
							{#each t.matches as m (m.id)}
								{@render matchRow(m)}
							{/each}
						{/if}
					</div>
				</Card>

				{#if t.fees?.length}
					<Card padded={false}>
						<p class="section-title">Iuran peserta</p>
						<div class="fees">
							{#each t.fees as f (f.user_id)}
								<div class="fee-row">
									<span class="fee-name">{f.name}</span>
									<span class="fee-amount">{rupiah(f.amount)}</span>
									{#if f.paid_at}
										<Badge tone="lunas">Lunas</Badge>
									{:else if canManageMoney}
										<button
											type="button"
											class="mark-btn"
											disabled={markingFee === f.user_id}
											onclick={() => onMarkFeePaid(f.user_id)}
										>
											{markingFee === f.user_id ? '…' : 'Tandai lunas'}
										</button>
									{:else}
										<Badge tone="belum">Belum lunas</Badge>
									{/if}
								</div>
							{/each}
						</div>
					</Card>
				{/if}

				{#if t.kok_charges?.length}
					<Card padded={false}>
						<div class="section-head">
							<p class="section-title">Tagihan kok</p>
							{#if canManageMoney && selectedCharges.size > 0}
								<button type="button" class="mark-btn" disabled={markingCharges} onclick={onMarkChargesPaid}>
									{markingCharges ? '…' : `Tandai ${selectedCharges.size} lunas`}
								</button>
							{/if}
						</div>
						<div class="charges">
							{#each t.kok_charges as c (c.id)}
								<div class="charge-row">
									{#if canManageMoney && !c.paid_at}
										<input
											type="checkbox"
											class="charge-check"
											checked={selectedCharges.has(c.id)}
											onchange={() => toggleCharge(c.id)}
											aria-label="Pilih tagihan {c.name}"
										/>
									{/if}
									<span class="charge-name">{c.name}</span>
									<span class="charge-match">{matchLabel(c.match_id)}</span>
									<span class="charge-amount">{rupiah(c.amount)}</span>
									{#if c.paid_at}
										<Badge tone="lunas">Lunas</Badge>
									{:else}
										<Badge tone="belum">Belum</Badge>
									{/if}
								</div>
							{/each}
						</div>
					</Card>
				{/if}
			{/if}
		</div>
	</AppShell>
{/if}

{#snippet matchRow(m: BracketMatch)}
	<div class="match-row">
		<div class="match-main">
			<p class="match-title">{m.title}</p>
			<p class="match-vs">
				<span class:winner={m.winner === 'a'}>{sideLabel(m.a)}</span>
				<span class="vs-x">vs</span>
				<span class:winner={m.winner === 'b'}>{sideLabel(m.b)}</span>
			</p>
			{#if scoreLine(m)}
				<p class="match-score">{scoreLine(m)}{m.auto_win ? ' · menang otomatis (BYE)' : ''}</p>
			{/if}
			{#if m.kok_total > 0}
				<p class="match-kok">Kok: {rupiah(m.kok_total)}</p>
			{/if}
		</div>
		<div class="match-actions">
			{#if !m.a.bye && !m.b.bye}
				<button type="button" class="mini-btn" onclick={() => openScore(m)}>
					{m.score ? 'Ubah skor' : 'Isi skor'}
				</button>
			{/if}
			{#if canAddKok(m)}
				<button type="button" class="mini-btn ghost" onclick={() => openKok(m)}>+ Kok</button>
			{/if}
		</div>
	</div>
{/snippet}

<CreateClubDialog bind:open={createOpen} />
{#if t}
	<ScoreMatchDialog
		bind:open={scoreOpen}
		clubId={activeClub()!.club_id}
		tournamentId={t.id}
		match={scoringMatch}
		scoreFormat={t.score_format}
		onScored={onUpdated}
	/>
	<AddKokDialog
		bind:open={kokOpen}
		clubId={activeClub()!.club_id}
		tournamentId={t.id}
		matchId={kokMatch?.id}
		matchTitle={kokMatch?.title}
		onAdded={onUpdated}
	/>
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
		gap: 14px;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		font-weight: 600;
		text-decoration: none;
	}
	.pagehead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.h-title {
		font-size: 22px;
		font-weight: 800;
	}
	.t-sub {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 4px;
	}
	.t-date {
		font-size: 12.5px;
		color: var(--ink-faint);
	}
	.champ-title {
		font-size: 13px;
		color: var(--ink-faint);
		margin-bottom: 2px;
	}
	.champ-name {
		font-size: 20px;
		font-weight: 800;
		color: var(--lunas);
	}
	.cost-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.cost-lbl {
		font-size: 11.5px;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.cost-val {
		font-size: 20px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.cost-sub {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.section-title {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-soft);
		padding: 14px 16px 6px;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-right: 16px;
	}

	.standings {
		display: flex;
		flex-direction: column;
	}
	.stand-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.stand-rank {
		width: 18px;
		color: var(--ink-faint);
		font-weight: 700;
	}
	.stand-name {
		flex: 1;
		font-weight: 600;
	}
	.stand-stat {
		color: var(--ink-faint);
		font-size: 12px;
	}
	.stand-diff {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		width: 36px;
		text-align: right;
	}

	.round-label {
		font-size: 12px;
		font-weight: 700;
		color: var(--ink-faint);
		padding: 10px 16px 4px;
	}
	.match-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-top: 1px solid var(--line);
	}
	.match-main {
		min-width: 0;
	}
	.match-title {
		font-size: 11.5px;
		color: var(--ink-faint);
	}
	.match-vs {
		font-size: 14px;
		font-weight: 600;
	}
	.match-vs .winner {
		color: var(--lunas);
		font-weight: 800;
	}
	.vs-x {
		color: var(--ink-faint);
		font-weight: 500;
		margin: 0 4px;
		font-size: 12px;
	}
	.match-score {
		font-size: 12px;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	.match-kok {
		font-size: 11.5px;
		color: var(--ink-faint);
	}
	.match-actions {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: none;
	}
	.mini-btn {
		border: 1px solid var(--line-2);
		background: var(--surface);
		border-radius: 999px;
		padding: 5px 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
		white-space: nowrap;
	}
	.mini-btn.ghost {
		color: var(--ink-soft);
	}

	.fees,
	.charges {
		display: flex;
		flex-direction: column;
	}
	.fee-row,
	.charge-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 16px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.fee-name,
	.charge-name {
		flex: 1;
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.charge-match {
		font-size: 11.5px;
		color: var(--ink-faint);
		flex: none;
	}
	.fee-amount,
	.charge-amount {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		flex: none;
	}
	.charge-check {
		width: 18px;
		height: 18px;
		flex: none;
	}
	.mark-btn {
		border: 0;
		background: none;
		color: var(--accent);
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		flex: none;
	}
</style>
