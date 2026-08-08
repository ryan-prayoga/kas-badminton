<!--
	Dialog "Bayar sekarang" (F6/5, PLAN.md §9.3, §9.6) — pemain menandai
	"sudah transfer" atas tagihan yang dipilih. QRIS statis ditampilkan
	apa adanya (default, tidak pernah gagal); "Isi nominal otomatis"
	mengambil QR dinamis sekali pakai yang dibuat ULANG tiap dibuka
	(tidak pernah cache, §9.6). Setelah klaim, status jadi pending_review
	— jujur "menunggu dicek bendahara", bukan berpura-pura lunas.
-->
<script lang="ts">
	import QRCode from 'qrcode';
	import { Dialog, Button, Checkbox, toast } from '$lib/components/ui';
	import { ApiError } from '$lib/api/client';
	import { claimPayment, type PaymentMethod } from '$lib/api/payments';
	import { fetchQris, createDynamicQris, reportQrisRejected } from '$lib/api/qris';
	import { rupiah, tanggalPendek } from '$lib/format';
	import type { BillItem } from '$lib/api/me';

	let {
		open = $bindable(false),
		clubId,
		items,
		onPaid
	}: {
		open?: boolean;
		clubId: string;
		items: BillItem[]; // cuma yang status unpaid (pemanggil sudah menyaring)
		onPaid?: () => void;
	} = $props();

	let selected = $state<Set<string>>(new Set());
	let amountOverride = $state<string>('');
	let method = $state<PaymentMethod>('transfer');
	let submitting = $state(false);
	let error = $state('');

	let qrisPayload = $state<string | null>(null);
	let qrisLoaded = $state(false);
	let qrisDataUrl = $state('');
	let dynamic = $state<{ id: string; expiresAt: Date } | null>(null);
	let makingDynamic = $state(false);

	const selectedTotal = $derived(
		items.filter((i) => selected.has(i.id)).reduce((sum, i) => sum + i.amount, 0)
	);
	const amount = $derived(amountOverride ? Number(amountOverride) || 0 : selectedTotal);

	// Reset & muat ulang tiap dialog dibuka — QR dinamis TIDAK pernah
	// dibawa dari sesi sebelumnya (§9.6).
	$effect(() => {
		if (!open) return;
		selected = new Set(items.map((i) => i.id));
		amountOverride = '';
		method = 'transfer';
		error = '';
		dynamic = null;
		void loadStaticQris();
	});

	async function loadStaticQris() {
		qrisLoaded = false;
		try {
			const q = await fetchQris(clubId);
			qrisPayload = q.merchant_qris;
			if (qrisPayload) qrisDataUrl = await QRCode.toDataURL(qrisPayload, { margin: 1, width: 220 });
		} catch {
			qrisPayload = null;
		} finally {
			qrisLoaded = true;
		}
	}

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function useDynamic() {
		if (amount <= 0) {
			error = 'Pilih tagihan atau isi nominal dulu.';
			return;
		}
		makingDynamic = true;
		error = '';
		try {
			const d = await createDynamicQris(clubId, amount);
			dynamic = { id: d.id, expiresAt: new Date(d.expires_at) };
			qrisDataUrl = await QRCode.toDataURL(d.payload, { margin: 1, width: 220 });
			method = 'qris_dinamis';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal membuat QR dinamis.';
		} finally {
			makingDynamic = false;
		}
	}

	async function qrRejected() {
		if (dynamic) await reportQrisRejected(clubId, dynamic.id).catch(() => {});
		dynamic = null;
		method = 'transfer';
		toast('Kembali ke QRIS statis — ketik nominal manual di aplikasi bank.', { tone: 'netral' });
		void loadStaticQris();
	}

	async function copyPayload() {
		const text = qrisPayload;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			toast('Kode QRIS disalin.', { tone: 'netral' });
		} catch {
			// clipboard API bisa ditolak browser lama — bukan galat fatal.
		}
	}

	async function submit() {
		if (selected.size === 0) {
			error = 'Pilih minimal satu tagihan.';
			return;
		}
		if (amount < selectedTotal) {
			error = `Nominal minimal ${rupiah(selectedTotal)} (total tagihan yang dipilih).`;
			return;
		}
		submitting = true;
		error = '';
		try {
			await claimPayment(clubId, { item_ids: [...selected], amount, method });
			toast('Dilaporkan — menunggu dicek bendahara.', { tone: 'netral' });
			open = false;
			onPaid?.();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal mengirim laporan bayar.';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open title="Bayar sekarang">
	{#snippet children()}
		<div class="stack">
			<div class="items">
				{#each items as item (item.id)}
					<label class="item-row">
						<Checkbox checked={selected.has(item.id)} onchange={() => toggle(item.id)} />
						<span class="item-date">{tanggalPendek(item.played_on)}</span>
						<span class="item-amount tabular">{rupiah(item.amount)}</span>
					</label>
				{/each}
			</div>

			<div class="qr-block">
				{#if !qrisLoaded}
					<p class="hint">Memuat QRIS…</p>
				{:else if !qrisPayload}
					<p class="hint">
						Klub ini belum punya QRIS tersimpan. Transfer manual ke pengurus, lalu tandai sudah bayar
						di bawah.
					</p>
				{:else}
					<img src={qrisDataUrl} alt="Kode QRIS" width="220" height="220" class="qr-img" />
					{#if dynamic}
						<p class="qr-caption">
							Nominal {rupiah(amount)} sudah tersuntik — pindai lalu langsung bayar.
						</p>
						<Button variant="ghost" onclick={qrRejected}>QR-nya ditolak?</Button>
					{:else}
						<p class="qr-caption">Pindai, lalu ketik nominal {rupiah(amount)} sendiri.</p>
						<div class="qr-actions">
							<Button variant="secondary" onclick={copyPayload}>Salin kode QRIS</Button>
							<Button variant="secondary" disabled={makingDynamic} onclick={useDynamic}>
								{makingDynamic ? 'Membuat…' : 'Isi nominal otomatis'}
							</Button>
						</div>
					{/if}
				{/if}
			</div>

			<div class="amount-row">
				<span class="hint" style="margin-bottom:0">Nominal dilaporkan</span>
				<span class="amount-val tabular">{rupiah(amount)}</span>
			</div>

			{#if error}
				<p class="err">{error}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" fullWidth disabled={submitting} onclick={submit}>
			{submitting ? 'Mengirim…' : 'Saya sudah transfer'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 160px;
		overflow-y: auto;
	}
	.item-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 4px;
		cursor: pointer;
	}
	.item-date {
		flex: 1;
		font-size: 13.5px;
		color: var(--ink-soft);
	}
	.item-amount {
		font-size: 13.5px;
		font-weight: 700;
	}

	.qr-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 14px;
		background: var(--surface-2);
		border-radius: var(--radius-lg);
		text-align: center;
	}
	.qr-img {
		border-radius: 8px;
		background: #fff;
		padding: 8px;
	}
	.qr-caption {
		font-size: 12.5px;
		color: var(--ink-soft);
	}
	.qr-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 10px;
	}

	.amount-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 6px;
		border-top: 1px solid var(--line);
	}
	.amount-val {
		font-size: 18px;
		font-weight: 800;
	}

	.err {
		font-size: 12.5px;
		color: var(--hancur);
	}
</style>
