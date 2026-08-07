<!--
	Beranda (F5/3, PLAN.md §5.5) — tagihanku sebagai hero, lingkupnya klub
	aktif saja (bukan gabungan lintas klub, §5.5.1). "Bayar sekarang" masih
	stub: QRIS/payments-claim baru dibangun F6, jadi tombolnya jujur bilang
	belum tersedia alih-alih pura-pura jalan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { isLoggedIn, currentUser, clearSession } from '$lib/stores/session.svelte';
	import { api, ApiError } from '$lib/api/client';
	import {
		activeClub,
		otherMemberships,
		hasLoadedMemberships,
		isLoadingMemberships,
		loadMe,
		setActiveClub
	} from '$lib/stores/club.svelte';
	import { myBill, isBillLoading, loadMyBill } from '$lib/stores/bill.svelte';
	import { setAutoDeduct } from '$lib/api/clubs';
	import { listRecentGames, type GameSummary } from '$lib/api/games';
	import { AppShell, Button, Card, Badge, toast } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import { rupiah, tanggalPendek } from '$lib/format';

	let createOpen = $state(false);
	let recentGames = $state<GameSummary[]>([]);
	let togglingAutoDeduct = $state(false);
	// Gagal muat profil (§0 galat) HARUS beda dari "memang belum punya
	// klub" — kalau digabung, satu koneksi putus bikin layarnya bohong
	// bilang "belum punya klub" padahal klubnya ada (PLAN.md §5.6.1 nada
	// bicara: status jujur, bukan tebakan optimis).
	let bootError = $state('');
	let billError = $state('');

	onMount(() => {
		if (!isLoggedIn()) return;
		void boot();
	});

	async function boot() {
		bootError = '';
		try {
			await loadMe();
			const club = activeClub();
			if (club) await loadClubData(club.club_id);
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function loadClubData(clubId: string) {
		billError = '';
		try {
			await loadMyBill(clubId);
		} catch (e) {
			billError = e instanceof ApiError ? e.message : 'Gagal memuat tagihan. Coba lagi.';
		}
		try {
			recentGames = await listRecentGames(clubId, 3);
		} catch {
			recentGames = [];
		}
	}

	async function pickClub(clubId: string) {
		setActiveClub(clubId);
		await loadClubData(clubId);
	}

	async function toggleAutoDeduct() {
		const club = activeClub();
		const bill = myBill();
		const user = currentUser();
		if (!club || !bill || !user) return;
		togglingAutoDeduct = true;
		try {
			await setAutoDeduct(club.club_id, user.id, !bill.auto_deduct);
			// optimistic: outbox yang urus kirim beneran, cerminan lokal
			// langsung ikut biar saklarnya kerasa instan.
			await loadMyBill(club.club_id);
		} finally {
			togglingAutoDeduct = false;
		}
	}

	function bayarSekarang() {
		toast('Pembayaran online segera hadir — transfer manual ke pengurus dulu ya.', { tone: 'netral' });
	}

	async function logout() {
		try {
			await api.post('/auth/logout');
		} catch {
			// Sesi lokal tetap dibuang walau panggilan server gagal.
		}
		clearSession();
	}
</script>

<svelte:head>
	<title>Kok Badminton v3</title>
</svelte:head>

{#if !isLoggedIn()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<div style="text-align:center; display:flex; flex-direction:column; gap:10px; align-items:center">
			<p style="color:var(--ink-faint);font-size:13px">Kok Badminton v3</p>
			<a href="/login" style="color:var(--accent);font-size:13px;font-weight:600">Masuk →</a>
			<a href="/design" style="color:var(--ink-faint);font-size:12px">Sistem desain →</a>
		</div>
	</main>
{:else if !hasLoadedMemberships() || isLoadingMemberships()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<p style="color:var(--ink-faint);font-size:13px">Memuat…</p>
	</main>
{:else if bootError}
	<main class="empty-page">
		<div class="empty-wrap">
			<Card>
				<h1 class="title display">Gagal memuat</h1>
				<p class="hint">{bootError}</p>
				<Button variant="primary" size="lg" fullWidth onclick={boot}>Coba lagi</Button>
			</Card>
			<button class="logout-link" onclick={logout}>Keluar</button>
		</div>
	</main>
{:else if !activeClub()}
	<main class="empty-page">
		<div class="empty-wrap">
			<Card>
				<h1 class="title display">Belum punya klub</h1>
				<p class="hint">
					Bikin klub baru buat mulai catat main, atau minta pengurus klubmu kirim tautan/QR gabung.
				</p>
				<Button variant="primary" size="lg" fullWidth onclick={() => (createOpen = true)}>
					Buat klub baru
				</Button>
				<p class="hint" style="margin-top:10px;margin-bottom:0">
					Punya tautan atau QR undangan? Buka lewat HP-mu, pindai langsung mengarah ke sini.
				</p>
			</Card>
			<button class="logout-link" onclick={logout}>Keluar</button>
		</div>
	</main>
{:else}
	{@const club = activeClub()}
	{@const bill = myBill()}
	{@const others = otherMemberships()}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={pickClub} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/" header={clubHeader}>
		<div class="page">
			<!-- Tagihanku -->
			<section aria-labelledby="s-bill">
				<Card>
					{#if billError}
						<p class="hero-label">Tagihanku</p>
						<p class="hint">{billError}</p>
						<Button variant="secondary" onclick={() => loadClubData(club!.club_id)}>Coba lagi</Button>
					{:else if isBillLoading() && !bill}
						<p class="hint">Memuat tagihan…</p>
					{:else if bill}
						{#if bill.total_owed > 0}
							<p class="hero-label">Tagihanku</p>
							<p class="hero-amount display tabular">{rupiah(bill.total_owed)}</p>
							<p class="hero-ctx">
								{bill.items.length} main belum lunas
								{#if bill.items.some((i) => i.status === 'disputed')}· ada yang disanggah{/if}
							</p>
							<Button variant="primary" size="lg" fullWidth onclick={bayarSekarang}>Bayar sekarang</Button>
						{:else}
							<p class="hero-label">Tagihanku</p>
							<p class="hero-clear display">Semua beres 🎉</p>
							<p class="hero-ctx">Gak ada tagihan nunggak di {club!.club_name}.</p>
						{/if}
					{/if}
				</Card>
			</section>

			{#if others.length > 0}
				<div class="other-clubs">
					{#each others as m (m.club_id)}
						<button class="other-row" onclick={() => pickClub(m.club_id)}>
							<span>{m.club_name}</span>
							<span class="chev">→</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Deposit -->
			<section aria-labelledby="s-deposit">
				<h2 id="s-deposit" class="sec-title display">Deposit</h2>
				<Card>
					<div class="deposit-row">
						<div>
							<p class="deposit-amount tabular display">{rupiah(bill?.wallet_balance ?? 0)}</p>
							<p class="hint" style="margin-bottom:0">Saldo di {club!.club_name}</p>
						</div>
						<Button
							variant={bill?.auto_deduct ? 'primary' : 'secondary'}
							disabled={togglingAutoDeduct || !bill}
							onclick={toggleAutoDeduct}
						>
							{bill?.auto_deduct ? 'Potong otomatis: nyala' : 'Potong otomatis: mati'}
						</Button>
					</div>
				</Card>
			</section>

			<!-- Main terakhirku -->
			{#if recentGames.length > 0}
				<section aria-labelledby="s-recent">
					<h2 id="s-recent" class="sec-title display">Main terakhir</h2>
					<Card padded={false}>
						{#each recentGames as g, i (g.id)}
							<div class="game-row" class:last={i === recentGames.length - 1}>
								<span>{tanggalPendek(g.played_on)}</span>
								<Badge tone="netral">{g.format}</Badge>
							</div>
						{/each}
					</Card>
				</section>
			{/if}
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} onCreated={(clubId) => loadClubData(clubId)} />

<style>
	.empty-page {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		background: var(--bg);
		padding: 20px;
	}
	.empty-wrap {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: center;
	}
	.title {
		font-size: var(--text-title);
		font-weight: 700;
		margin-bottom: 4px;
	}
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 14px;
	}
	.logout-link {
		background: none;
		border: 0;
		color: var(--ink-faint);
		font-size: 12.5px;
		cursor: pointer;
	}

	.page {
		max-width: 640px;
		margin: 0 auto;
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.sec-title {
		font-size: var(--text-title);
		font-weight: 700;
		margin-bottom: 10px;
	}

	.hero-label {
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-faint);
		margin-bottom: 4px;
	}
	.hero-amount {
		font-size: var(--text-hero);
		font-weight: 800;
		line-height: var(--text-hero--line-height);
		letter-spacing: var(--text-hero--letter-spacing);
		margin-bottom: 6px;
	}
	.hero-clear {
		font-size: 22px;
		font-weight: 800;
		margin-bottom: 6px;
	}
	.hero-ctx {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 14px;
	}

	.other-clubs {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: -10px;
	}
	.other-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: none;
		border: 0;
		font: inherit;
		font-size: 13.5px;
		color: var(--ink-soft);
		padding: 8px 4px;
		cursor: pointer;
		text-align: left;
	}
	.other-row:hover {
		color: var(--accent);
	}
	.chev {
		color: var(--ink-faint);
	}

	.deposit-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.deposit-amount {
		font-size: 20px;
		font-weight: 800;
	}

	.game-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
		font-size: 14px;
	}
	.game-row.last {
		border-bottom: 0;
	}
</style>
