<!--
	Tagihan & Kas (F6/6, PLAN.md §5.4 "pintu masuk besar buat bendahara" +
	§9) — satu pintu masuk empat urusan uang klub: verifikasi klaim bayar,
	rekap tagihan, dompet per-anggota, pengeluaran, dan QRIS. Digerbang
	perm.ManageMoney di SERVER (tiap endpoint RequirePerm) — hasManageMoney
	di sini cuma mencegah UI menawarkan tombol yang bakal ditolak 403.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import {
		activeClub,
		hasLoadedMemberships,
		isLoadingMemberships,
		hasManageMoney,
		loadMe
	} from '$lib/stores/club.svelte';
	import { listMembers, type Member } from '$lib/api/members';
	import {
		listClubBills,
		verifyPayment,
		rejectPayment,
		markBillsPaid,
		type ClubBillItem
	} from '$lib/api/payments';
	import { fetchMemberWallet, topupWallet, withdrawWallet, type Wallet } from '$lib/api/wallet';
	import { fetchTreasury, listExpenses, createExpense, type Treasury, type Expense } from '$lib/api/treasury';
	import { fetchQris, putQris } from '$lib/api/qris';
	import { AppShell, Card, Badge, Button, Input, Checkbox, Tabs, Table, toast } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';
	import { rupiah, tanggalPendek } from '$lib/format';

	const STATUS_LABEL: Record<string, string> = {
		unpaid: 'Belum lunas',
		pending_review: 'Menunggu dicek',
		disputed: 'Disanggah'
	};

	let createOpen = $state(false);
	let bootError = $state('');
	let tab = $state('tagihan');

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
			if (club && hasManageMoney(club)) await loadAll(club.club_id);
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function loadAll(clubId: string) {
		await Promise.all([loadBills(clubId), loadTreasury(clubId), loadExpensesList(clubId)]);
	}

	// --- Tagihan (verifikasi + rekap) ---
	let bills = $state<ClubBillItem[]>([]);
	let billsLoading = $state(false);
	let billsError = $state('');
	let billsFilter = $state<'' | 'unpaid' | 'pending_review' | 'disputed'>('');
	let selectedUnpaid = $state<Set<string>>(new Set());
	let processingPaymentId = $state('');
	let markingPaid = $state(false);

	async function loadBills(clubId: string) {
		billsLoading = true;
		billsError = '';
		try {
			const res = await listClubBills(clubId, billsFilter || undefined);
			bills = res.items;
			selectedUnpaid = new Set();
		} catch (e) {
			billsError = e instanceof ApiError ? e.message : 'Gagal memuat tagihan.';
		} finally {
			billsLoading = false;
		}
	}

	function toggleUnpaid(id: string) {
		const next = new Set(selectedUnpaid);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedUnpaid = next;
	}

	async function markSelectedPaid() {
		const club = activeClub();
		if (!club || selectedUnpaid.size === 0) return;
		markingPaid = true;
		try {
			const res = await markBillsPaid(club.club_id, [...selectedUnpaid]);
			const failed = res.results.filter((r) => !r.ok);
			if (failed.length > 0) {
				toast(`${res.results.length - failed.length} ditandai lunas, ${failed.length} gagal.`, {
					tone: 'netral'
				});
			} else {
				toast('Ditandai lunas.', { tone: 'lunas' });
			}
			// Kas klub berubah (uang kok masuk) — treasury ikut disegarkan,
			// bukan cuma daftar tagihan.
			await Promise.all([loadBills(club.club_id), loadTreasury(club.club_id)]);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menandai lunas.', { tone: 'hancur' });
		} finally {
			markingPaid = false;
		}
	}

	async function verify(item: ClubBillItem) {
		const club = activeClub();
		if (!club || !item.payment_id) return;
		processingPaymentId = item.payment_id;
		try {
			await verifyPayment(club.club_id, item.payment_id);
			toast('Pembayaran diverifikasi.', { tone: 'lunas' });
			await loadAll(club.club_id);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal verifikasi.', { tone: 'hancur' });
		} finally {
			processingPaymentId = '';
		}
	}

	async function reject(item: ClubBillItem) {
		const club = activeClub();
		if (!club || !item.payment_id) return;
		processingPaymentId = item.payment_id;
		try {
			await rejectPayment(club.club_id, item.payment_id);
			toast('Klaim ditolak — tagihan kembali belum lunas.', { tone: 'netral' });
			await loadBills(club.club_id);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menolak.', { tone: 'hancur' });
		} finally {
			processingPaymentId = '';
		}
	}

	// --- Dompet per-anggota ---
	let memberQuery = $state('');
	let memberResults = $state<Member[]>([]);
	let memberSearchDebounce: ReturnType<typeof setTimeout> | undefined;
	let selectedMember = $state<Member | null>(null);
	let memberWallet = $state<Wallet | null>(null);
	let walletLoading = $state(false);
	let walletAmount = $state('');
	let walletNote = $state('');
	let walletSubmitting = $state(false);

	function onMemberQueryInput() {
		clearTimeout(memberSearchDebounce);
		const club = activeClub();
		if (!club) return;
		memberSearchDebounce = setTimeout(async () => {
			memberResults = await listMembers(club.club_id, memberQuery).catch(() => []);
		}, 300);
	}

	async function pickMember(m: Member) {
		selectedMember = m;
		walletAmount = '';
		walletNote = '';
		const club = activeClub();
		if (!club) return;
		walletLoading = true;
		try {
			memberWallet = await fetchMemberWallet(club.club_id, m.user_id);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal memuat dompet.', { tone: 'hancur' });
		} finally {
			walletLoading = false;
		}
	}

	async function submitTopup() {
		await submitWalletAdjust(topupWallet, 'Top-up dicatat.');
	}
	async function submitWithdraw() {
		await submitWalletAdjust(withdrawWallet, 'Tarik saldo dicatat.');
	}

	async function submitWalletAdjust(
		fn: (clubId: string, userId: string, amount: number, note?: string) => Promise<unknown>,
		successMsg: string
	) {
		const club = activeClub();
		const amount = Number(walletAmount);
		if (!club || !selectedMember || !amount || amount <= 0) {
			toast('Isi nominal lebih dari 0 dulu.', { tone: 'hancur' });
			return;
		}
		walletSubmitting = true;
		try {
			await fn(club.club_id, selectedMember.user_id, amount, walletNote || undefined);
			toast(successMsg, { tone: 'lunas' });
			walletAmount = '';
			walletNote = '';
			// Titipan pemain (treasury) berubah — bukan cuma dompet orang ini.
			const [wallet] = await Promise.all([
				fetchMemberWallet(club.club_id, selectedMember.user_id),
				loadTreasury(club.club_id)
			]);
			memberWallet = wallet;
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal memproses.', { tone: 'hancur' });
		} finally {
			walletSubmitting = false;
		}
	}

	// --- Kas (treasury + pengeluaran) ---
	let treasury = $state<Treasury | null>(null);
	let treasuryLoading = $state(false);
	let expenses = $state<Expense[]>([]);
	let expenseAmount = $state('');
	let expenseNote = $state('');
	let expenseSubmitting = $state(false);

	async function loadTreasury(clubId: string) {
		treasuryLoading = true;
		try {
			treasury = await fetchTreasury(clubId);
		} catch {
			treasury = null;
		} finally {
			treasuryLoading = false;
		}
	}

	async function loadExpensesList(clubId: string) {
		expenses = await listExpenses(clubId)
			.then((r) => r.items)
			.catch(() => []);
	}

	async function submitExpense() {
		const club = activeClub();
		const amount = Number(expenseAmount);
		if (!club || !amount) {
			toast('Isi nominal dulu (boleh minus buat kas masuk).', { tone: 'hancur' });
			return;
		}
		expenseSubmitting = true;
		try {
			await createExpense(club.club_id, { amount, note: expenseNote || undefined });
			toast('Pengeluaran dicatat.', { tone: 'lunas' });
			expenseAmount = '';
			expenseNote = '';
			await Promise.all([loadTreasury(club.club_id), loadExpensesList(club.club_id)]);
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal mencatat.', { tone: 'hancur' });
		} finally {
			expenseSubmitting = false;
		}
	}

	// --- QRIS ---
	let qrisPayload = $state('');
	let qrisVersion = $state(0);
	let qrisInput = $state('');
	let qrisLoading = $state(false);
	let qrisSubmitting = $state(false);

	async function loadQris(clubId: string) {
		qrisLoading = true;
		try {
			const q = await fetchQris(clubId);
			qrisPayload = q.merchant_qris ?? '';
			qrisVersion = q.version;
			qrisInput = qrisPayload;
		} finally {
			qrisLoading = false;
		}
	}

	async function submitQris() {
		const club = activeClub();
		if (!club || !qrisInput.trim()) return;
		qrisSubmitting = true;
		try {
			const q = await putQris(club.club_id, qrisInput.trim(), qrisVersion);
			qrisPayload = q.merchant_qris ?? '';
			qrisVersion = q.version;
			toast('QRIS klub tersimpan.', { tone: 'lunas' });
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal menyimpan QRIS — cek format payload.', {
				tone: 'hancur'
			});
		} finally {
			qrisSubmitting = false;
		}
	}

	function onSwitchClub(clubId: string) {
		void loadAll(clubId);
	}

	$effect(() => {
		const club = activeClub();
		if (!club) return;
		if (tab === 'qris' && !qrisPayload && !qrisLoading) void loadQris(club.club_id);
	});
</script>

<svelte:head>
	<title>Tagihan & Kas — Kok Badminton</title>
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
			<p class="hint">Belum punya klub.</p>
			<a href="/" class="retry">Ke Beranda →</a>
		</Card>
	</main>
{:else if !hasManageMoney(activeClub())}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">Cuma bendahara/admin yang bisa buka halaman ini.</p>
			<a href="/klub" class="retry">Ke Klub →</a>
		</Card>
	</main>
{:else}
	{@const club = activeClub()!}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={onSwitchClub} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/klub/kas" header={clubHeader} secondary={[{ href: '/klub/kas', label: 'Tagihan & Kas' }]}>
		<div class="page">
			<div class="pagehead">
				<h1 class="h-title display">Tagihan & Kas — {club.club_name}</h1>
				<a href="/klub" class="back">← Anggota</a>
			</div>

			{#if treasury}
				<div class="treasury-row">
					<Card>
						<p class="tr-label">Kas klub</p>
						<p class="tr-amount tabular">{rupiah(treasury.kas_klub)}</p>
					</Card>
					<Card>
						<p class="tr-label">Titipan pemain</p>
						<p class="tr-amount tabular">{rupiah(treasury.titipan_pemain)}</p>
					</Card>
					<Card>
						<p class="tr-label">Iuran turnamen</p>
						<p class="tr-amount tabular">{rupiah(treasury.iuran_turnamen)}</p>
					</Card>
				</div>
			{/if}

			<Tabs
				bind:value={tab}
				items={[
					{ value: 'tagihan', label: 'Tagihan' },
					{ value: 'dompet', label: 'Dompet' },
					{ value: 'kas', label: 'Pengeluaran' },
					{ value: 'qris', label: 'QRIS' }
				]}
			>
				{#snippet children(tabs)}
					<div {...tabs.getContent('tagihan')}>
						{#if tab === 'tagihan'}
							<div class="filter-row">
								{#each [['', 'Semua'], ['unpaid', 'Belum lunas'], ['pending_review', 'Menunggu'], ['disputed', 'Disanggah']] as [val, label] (val)}
									<button
										class="chip"
										class:active={billsFilter === val}
										onclick={() => {
											billsFilter = val as typeof billsFilter;
											loadBills(club.club_id);
										}}>{label}</button
									>
								{/each}
							</div>

							{#if selectedUnpaid.size > 0}
								<div class="bulk-row">
									<span>{selectedUnpaid.size} dipilih</span>
									<Button disabled={markingPaid} onclick={markSelectedPaid}>
										{markingPaid ? 'Memproses…' : 'Tandai lunas (cash)'}
									</Button>
								</div>
							{/if}

							<Card padded={false}>
								{#if billsError}
									<div class="state">
										<p class="hint">{billsError}</p>
										<button class="retry" onclick={() => loadBills(club.club_id)}>Coba lagi</button>
									</div>
								{:else if billsLoading}
									<div class="state"><p class="hint">Memuat…</p></div>
								{:else if bills.length === 0}
									<div class="state"><p class="hint">Tidak ada tagihan di kategori ini.</p></div>
								{:else}
									<Table>
										{#snippet children()}
											<thead>
												<tr>
													<th></th>
													<th>Tanggal</th>
													<th>Status</th>
													<th class="r">Nominal</th>
													<th></th>
												</tr>
											</thead>
											<tbody>
												{#each bills as item (item.id)}
													<tr>
														<td>
															{#if item.status === 'unpaid'}
																<Checkbox
																	checked={selectedUnpaid.has(item.id)}
																	onchange={() => toggleUnpaid(item.id)}
																/>
															{/if}
														</td>
														<td>{tanggalPendek(item.played_on)}</td>
														<td>
															<Badge
																tone={item.status === 'unpaid'
																	? 'belum'
																	: item.status === 'pending_review'
																		? 'accent'
																		: 'netral'}>{STATUS_LABEL[item.status]}</Badge
															>
														</td>
														<td class="r tabular">{rupiah(item.amount)}</td>
														<td class="r">
															{#if item.status === 'pending_review' && item.payment_id}
																<div class="row-actions">
																	<button
																		class="link-btn"
																		disabled={processingPaymentId === item.payment_id}
																		onclick={() => verify(item)}>Verifikasi</button
																	>
																	<button
																		class="link-btn danger"
																		disabled={processingPaymentId === item.payment_id}
																		onclick={() => reject(item)}>Tolak</button
																	>
																</div>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										{/snippet}
									</Table>
								{/if}
							</Card>
						{/if}
					</div>

					<div {...tabs.getContent('dompet')}>
						{#if tab === 'dompet'}
							<Input placeholder="Cari anggota…" bind:value={memberQuery} oninput={onMemberQueryInput} />
							{#if memberResults.length > 0}
								<div class="member-results">
									{#each memberResults as m (m.user_id)}
										<button class="member-hit" onclick={() => pickMember(m)}>{m.display_name}</button>
									{/each}
								</div>
							{/if}

							{#if selectedMember}
								<Card>
									<p class="wallet-name">{selectedMember.display_name}</p>
									{#if walletLoading}
										<p class="hint">Memuat dompet…</p>
									{:else if memberWallet}
										<p class="wallet-balance tabular display">{rupiah(memberWallet.balance)}</p>
										<div class="wallet-form">
											<Input
												type="number"
												placeholder="Nominal"
												bind:value={walletAmount}
											/>
											<Input placeholder="Catatan (opsional)" bind:value={walletNote} />
											<div class="wallet-actions">
												<Button disabled={walletSubmitting} onclick={submitTopup}>Top-up</Button>
												<Button
													variant="secondary"
													disabled={walletSubmitting}
													onclick={submitWithdraw}>Tarik</Button
												>
											</div>
										</div>
										{#if memberWallet.entries.length > 0}
											<div class="entries">
												{#each memberWallet.entries as e (e.id)}
													<div class="entry-row">
														<span class="entry-note">{e.note || e.kind}</span>
														<span class="entry-amount tabular" class:neg={e.amount < 0}>
															{e.amount > 0 ? '+' : ''}{rupiah(e.amount)}
														</span>
													</div>
												{/each}
											</div>
										{/if}
									{/if}
								</Card>
							{/if}
						{/if}
					</div>

					<div {...tabs.getContent('kas')}>
						{#if tab === 'kas'}
							<Card>
								<p class="wallet-name">Catat pengeluaran</p>
								<div class="wallet-form">
									<Input
										type="number"
										placeholder="Nominal (minus = kas masuk)"
										bind:value={expenseAmount}
									/>
									<Input placeholder="Catatan (mis. beli 2 slop)" bind:value={expenseNote} />
									<Button disabled={expenseSubmitting} onclick={submitExpense}>
										{expenseSubmitting ? 'Menyimpan…' : 'Catat'}
									</Button>
								</div>
							</Card>

							<Card padded={false}>
								{#if expenses.length === 0}
									<div class="state"><p class="hint">Belum ada pengeluaran tercatat.</p></div>
								{:else}
									{#each expenses as e, i (e.id)}
										<div class="entry-row padded" class:last={i === expenses.length - 1}>
											<div>
												<span class="entry-note">{e.note || e.type_name || 'Pengeluaran'}</span>
												<span class="entry-date">{tanggalPendek(e.created_at.slice(0, 10))}</span>
											</div>
											<span class="entry-amount tabular" class:neg={e.amount > 0}>
												{e.amount > 0 ? '-' : '+'}{rupiah(Math.abs(e.amount))}
											</span>
										</div>
									{/each}
								{/if}
							</Card>
						{/if}
					</div>

					<div {...tabs.getContent('qris')}>
						{#if tab === 'qris'}
							<Card>
								<p class="wallet-name">QRIS statis klub</p>
								{#if qrisLoading}
									<p class="hint">Memuat…</p>
								{:else}
									<p class="hint">
										Tempel payload QRIS yang sudah didekode dari foto (dipindai lewat kamera HP,
										bukan diketik manual).
									</p>
									<textarea class="qris-input" rows="3" bind:value={qrisInput} placeholder="00020101021126..."
									></textarea>
									<Button disabled={qrisSubmitting || !qrisInput.trim()} onclick={submitQris}>
										{qrisSubmitting ? 'Menyimpan…' : 'Simpan QRIS'}
									</Button>
									{#if qrisPayload}
										<p class="hint" style="margin-top:10px;margin-bottom:0">
											QRIS tersimpan ({qrisPayload.length} karakter) — versi {qrisVersion}.
										</p>
									{/if}
								{/if}
							</Card>
						{/if}
					</div>
				{/snippet}
			</Tabs>
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
		max-width: 720px;
		margin: 0 auto;
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pagehead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.h-title {
		font-size: 20px;
		font-weight: 800;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		text-decoration: none;
		flex: none;
	}

	.treasury-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.tr-label {
		font-size: 11.5px;
		color: var(--ink-faint);
		font-weight: 700;
		margin-bottom: 4px;
	}
	.tr-amount {
		font-size: 16px;
		font-weight: 800;
	}
	@media (max-width: 560px) {
		.treasury-row {
			grid-template-columns: 1fr;
		}
	}

	.filter-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chip {
		border: 1px solid var(--line-2);
		background: var(--surface);
		color: var(--ink-soft);
		font-size: 12.5px;
		font-weight: 600;
		padding: 6px 12px;
		border-radius: 999px;
		cursor: pointer;
	}
	.chip.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.bulk-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 13px;
		color: var(--ink-soft);
	}

	.state {
		padding: 24px 16px;
		text-align: center;
	}

	.row-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.link-btn {
		background: none;
		border: 0;
		color: var(--accent);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
	}
	.link-btn.danger {
		color: var(--hancur);
	}

	.member-results {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.member-hit {
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 10px 12px;
		font-size: 13.5px;
		cursor: pointer;
	}
	.member-hit:hover {
		border-color: var(--accent);
	}

	.wallet-name {
		font-size: 14px;
		font-weight: 700;
		margin-bottom: 4px;
	}
	.wallet-balance {
		font-size: 24px;
		font-weight: 800;
		margin-bottom: 12px;
	}
	.wallet-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.wallet-actions {
		display: flex;
		gap: 8px;
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 14px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}
	.entry-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 13px;
		padding: 6px 0;
	}
	.entry-row.padded {
		padding: 10px 16px;
		border-bottom: 1px solid var(--line);
	}
	.entry-row.padded.last {
		border-bottom: 0;
	}
	.entry-note {
		color: var(--ink-soft);
	}
	.entry-date {
		display: block;
		font-size: 11px;
		color: var(--ink-faint);
	}
	.entry-amount {
		font-weight: 700;
		color: var(--lunas);
	}
	.entry-amount.neg {
		color: var(--hancur);
	}

	.qris-input {
		width: 100%;
		font: inherit;
		font-size: 12.5px;
		font-family: var(--font-mono, monospace);
		padding: 10px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		resize: vertical;
		margin-bottom: 10px;
	}
	.qris-input:focus {
		outline: none;
		border-color: var(--accent);
	}
</style>
