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
		myMemberships,
		activeClub,
		otherMemberships,
		hasLoadedMemberships,
		isLoadingMemberships,
		loadMe,
		setActiveClub
	} from '$lib/stores/club.svelte';
	import { myBill, isBillLoading, loadMyBill } from '$lib/stores/bill.svelte';
	import { createClub, setAutoDeduct } from '$lib/api/clubs';
	import { listRecentGames, type GameSummary } from '$lib/api/games';
	import { AppShell, Button, Card, Badge, Dialog, Input, toast } from '$lib/components/ui';
	import { rupiah, tanggalPendek } from '$lib/format';

	let switcherOpen = $state(false);
	let createOpen = $state(false);
	let newClubName = $state('');
	let newClubSlug = $state('');
	let slugTouched = $state(false);
	let creating = $state(false);
	let createError = $state('');
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

	function slugify(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40);
	}

	$effect(() => {
		if (!slugTouched) newClubSlug = slugify(newClubName);
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
		switcherOpen = false;
		await loadClubData(clubId);
	}

	async function submitCreateClub() {
		createError = '';
		creating = true;
		try {
			const club = await createClub({ slug: newClubSlug, name: newClubName.trim() });
			createOpen = false;
			newClubName = '';
			newClubSlug = '';
			slugTouched = false;
			await loadMe();
			await pickClub(club.id);
			toast(`${club.name} dibuat — kamu admin di sini.`, { tone: 'lunas' });
		} catch (e) {
			createError = e instanceof ApiError ? e.message : 'Gagal bikin klub.';
		} finally {
			creating = false;
		}
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
		<div class="club-row">
			<button class="club-btn" onclick={() => (switcherOpen = true)}>
				<span class="dot display">{club!.club_name.slice(0, 2).toUpperCase()}</span>
				<span class="club-txt">
					<span class="nm">{club!.club_name}</span>
					{#if others.length > 0}
						<span class="cv">ketuk buat ganti klub</span>
					{/if}
				</span>
			</button>
			<div class="avatar">{(currentUser()?.display_name ?? '?').slice(0, 1).toUpperCase()}</div>
		</div>
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

	<Dialog bind:open={switcherOpen} title="Ganti klub">
		{#snippet children()}
			<div class="switch-list">
				{#each myMemberships() as m (m.club_id)}
					<button
						class="switch-row"
						aria-current={m.club_id === club!.club_id ? 'true' : undefined}
						onclick={() => pickClub(m.club_id)}
					>
						<span class="dot display sm">{m.club_name.slice(0, 2).toUpperCase()}</span>
						<span>{m.club_name}</span>
					</button>
				{/each}
			</div>
		{/snippet}
		{#snippet footer()}
			<Button
				variant="secondary"
				fullWidth
				onclick={() => {
					switcherOpen = false;
					createOpen = true;
				}}
			>
				+ Buat klub baru
			</Button>
		{/snippet}
	</Dialog>
{/if}

<Dialog bind:open={createOpen} title="Buat klub baru">
	{#snippet children()}
		<div class="field-stack">
			<Input label="Nama klub" placeholder="mis. PB Sarjana" bind:value={newClubName} />
			<Input
				label="Alamat klub"
				placeholder="pb-sarjana"
				bind:value={newClubSlug}
				hint="kaskok.my.id/{newClubSlug || '...'}"
				error={createError || undefined}
				oninput={() => (slugTouched = true)}
			/>
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createOpen = false)}>Batal</Button>
		<Button
			variant="primary"
			disabled={creating || !newClubName.trim() || !newClubSlug}
			onclick={submitCreateClub}
		>
			{creating ? 'Membuat…' : 'Buat klub'}
		</Button>
	{/snippet}
</Dialog>

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

	/* header klub — sama pola dgn routes/design/+page.svelte */
	.club-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.club-btn {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		background: none;
		border: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		padding: 4px;
		margin: -4px;
	}
	.dot {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		flex: none;
		background: var(--accent);
		color: #fff;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: 13px;
	}
	.dot.sm {
		width: 26px;
		height: 26px;
		font-size: 11.5px;
	}
	.club-txt {
		display: flex;
		flex-direction: column;
		text-align: left;
		min-width: 0;
	}
	.nm {
		font-weight: 700;
		font-size: 14.5px;
	}
	.cv {
		color: var(--ink-faint);
		font-size: 11px;
	}
	.avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		flex: none;
		background: var(--surface-2);
		border: 1px solid var(--line-2);
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 13px;
		color: var(--ink-soft);
	}
	@media (min-width: 768px) {
		.club-txt {
			display: none;
		}
		.club-btn {
			margin: 0 auto;
		}
		.club-row {
			justify-content: center;
		}
		.avatar {
			display: none;
		}
	}
	@media (min-width: 1024px) {
		.club-row {
			justify-content: space-between;
		}
		.avatar {
			display: grid;
		}
		.club-txt {
			display: flex;
		}
		.club-btn {
			margin: 0;
			width: 100%;
		}
	}

	.switch-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.switch-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 8px;
		border-radius: var(--radius-card);
		background: none;
		border: 0;
		font: inherit;
		font-size: 14.5px;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
	}
	.switch-row:hover {
		background: var(--surface-2);
	}
	.switch-row[aria-current='true'] {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		font-weight: 700;
	}

	.field-stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
