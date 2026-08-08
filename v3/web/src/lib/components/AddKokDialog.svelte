<!--
	Tambah kok turnamen (F7/2, API.md §5). matchId TERISI = kok partai
	(dibagi 4, ukuran ganda tetap — server tolak kalau partainya BYE);
	matchId KOSONG = kok umum (dibagi rata ke SEMUA peserta turnamen —
	inilah yang menutup lubang "kok lepas" v2, PLAN.md §14 F7).
-->
<script lang="ts">
	import { Dialog, Button, Input, toast } from '$lib/components/ui';
	import { ApiError } from '$lib/api/client';
	import { addMatchKok, addTournamentKok, type Tournament } from '$lib/api/tournaments';

	let {
		open = $bindable(false),
		clubId,
		tournamentId,
		matchId,
		matchTitle,
		onAdded
	}: {
		open?: boolean;
		clubId: string;
		tournamentId: string;
		matchId?: string;
		matchTitle?: string;
		onAdded?: (t: Tournament) => void;
	} = $props();

	let typeName = $state('Kok');
	let price = $state(0);
	let qty = $state(1);
	let usedOn = $state(new Date().toISOString().slice(0, 10));
	let submitting = $state(false);
	let formError = $state('');

	function reset() {
		typeName = 'Kok';
		price = 0;
		qty = 1;
		usedOn = new Date().toISOString().slice(0, 10);
		formError = '';
	}

	async function submit() {
		if (!typeName.trim() || price <= 0 || qty <= 0) {
			formError = 'Nama, harga, dan jumlah kok wajib diisi.';
			return;
		}
		formError = '';
		submitting = true;
		try {
			const input = { type_name: typeName.trim(), price_per_person: price, qty, used_on: usedOn };
			const t = matchId
				? await addMatchKok(clubId, tournamentId, matchId, input)
				: await addTournamentKok(clubId, tournamentId, input);
			open = false;
			onAdded?.(t);
			reset();
			toast('Kok tercatat — tagihannya langsung dibagi ke peserta.', { tone: 'lunas' });
		} catch (e) {
			formError = e instanceof ApiError ? e.message : 'Gagal menambah kok. Coba lagi.';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open title={matchId ? `Kok — ${matchTitle}` : 'Kok umum turnamen'}>
	{#snippet children()}
		<div class="stack">
			{#if !matchId}
				<p class="hint">Dibagi rata ke semua peserta turnamen saat ini.</p>
			{:else}
				<p class="hint">Dibagi ke 4 pemain partai ini.</p>
			{/if}
			<Input label="Nama kok" bind:value={typeName} />
			<div class="field-group">
				<label class="lbl" for="kok-price">Harga per orang (Rp)</label>
				<input id="kok-price" type="number" min="0" step="100" bind:value={price} />
			</div>
			<div class="field-group">
				<label class="lbl" for="kok-qty">Jumlah</label>
				<input id="kok-qty" type="number" min="1" bind:value={qty} />
			</div>
			<Input type="date" label="Tanggal pakai" bind:value={usedOn} />
			{#if formError}
				<p class="err">{formError}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" fullWidth disabled={submitting} onclick={submit}>
			{submitting ? 'Menyimpan…' : 'Tambah kok'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.hint {
		font-size: 13px;
		color: var(--ink-faint);
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lbl {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-soft);
	}
	input[type='number'] {
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
</style>
