<!--
	Buat turnamen (F7/2, PLAN.md §14 F7 + API.md §5). pairs[] boleh nyebut
	siapa pun (anggota klub ATAU orang dari luar — §8.1): server otomatis
	bikin mereka anggota `is_tournament_guest` (tournaments.go). Ukuran
	bagan (`size`) TIDAK harus sama dengan jumlah pasangan — sisanya jadi
	BYE, sama pola v2.
-->
<script lang="ts">
	import { Dialog, Button, Input, toast } from '$lib/components/ui';
	import PlayerPicker from './PlayerPicker.svelte';
	import { ApiError } from '$lib/api/client';
	import { createTournament, type Tournament, type CreateTournamentInput } from '$lib/api/tournaments';

	let {
		open = $bindable(false),
		clubId,
		onCreated
	}: { open?: boolean; clubId: string; onCreated?: (t: Tournament) => void } = $props();

	type Picked = { userId: string; displayName: string } | null;
	type PairSlot = { a: Picked; b: Picked };

	function freshPair(): PairSlot {
		return { a: null, b: null };
	}

	const FORMAT_OPTIONS: { value: CreateTournamentInput['format']; label: string }[] = [
		{ value: 'knockout', label: 'Gugur langsung' },
		{ value: 'round_robin', label: 'Setengah kompetisi' }
	];
	const SCORE_FORMAT_OPTIONS: { value: CreateTournamentInput['score_format']; label: string }[] = [
		{ value: 'single', label: 'Sampai 30' },
		{ value: 'bo3', label: 'Rally 21 bo3' }
	];

	let name = $state('');
	let startsOn = $state(new Date().toISOString().slice(0, 10));
	let format = $state<CreateTournamentInput['format']>('knockout');
	let scoreFormat = $state<CreateTournamentInput['score_format']>('single');
	let fee = $state(0);
	let pairs = $state<PairSlot[]>([freshPair(), freshPair()]);
	let submitting = $state(false);
	let formError = $state('');

	function addPair() {
		pairs = [...pairs, freshPair()];
	}
	function removePair(i: number) {
		if (pairs.length <= 2) return;
		pairs = pairs.filter((_, idx) => idx !== i);
	}

	function chosenIds(except?: Picked): string[] {
		const ids: string[] = [];
		for (const p of pairs) {
			if (p.a && p.a !== except) ids.push(p.a.userId);
			if (p.b && p.b !== except) ids.push(p.b.userId);
		}
		return ids;
	}

	function reset() {
		name = '';
		startsOn = new Date().toISOString().slice(0, 10);
		format = 'knockout';
		scoreFormat = 'single';
		fee = 0;
		pairs = [freshPair(), freshPair()];
		formError = '';
	}

	function validate(): string {
		if (!name.trim()) return 'Nama turnamen wajib diisi.';
		const filled = pairs.filter((p) => p.a || p.b);
		if (filled.length < 2) return 'Minimal 2 pasangan buat mulai turnamen.';
		if (filled.some((p) => !p.a || !p.b)) return 'Tiap pasangan butuh dua orang — belum lengkap ada yang sebelah doang.';
		return '';
	}

	async function submit() {
		formError = validate();
		if (formError) return;

		const filled = pairs.filter((p) => p.a || p.b);
		const input: CreateTournamentInput = {
			name: name.trim(),
			starts_on: startsOn,
			format,
			size: filled.length,
			fee: Math.max(0, fee),
			score_format: scoreFormat,
			pairs: filled.map((p, i) => ({ slot: i, a: p.a?.userId, b: p.b?.userId }))
		};

		submitting = true;
		try {
			const t = await createTournament(clubId, input);
			open = false;
			onCreated?.(t);
			reset();
		} catch (e) {
			formError = e instanceof ApiError ? e.message : 'Gagal membuat turnamen. Coba lagi.';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open title="Buat turnamen">
	{#snippet children()}
		<div class="stack">
			<Input label="Nama turnamen" bind:value={name} placeholder="mis. Turnamen Agustusan" />
			<Input type="date" label="Tanggal mulai" bind:value={startsOn} />

			<div class="field-group">
				<p class="lbl">Format</p>
				<div class="fmt-row">
					{#each FORMAT_OPTIONS as opt (opt.value)}
						<button type="button" class="fmt" class:active={format === opt.value} onclick={() => (format = opt.value)}>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="field-group">
				<p class="lbl">Format skor partai</p>
				<div class="fmt-row">
					{#each SCORE_FORMAT_OPTIONS as opt (opt.value)}
						<button
							type="button"
							class="fmt sm"
							class:active={scoreFormat === opt.value}
							onclick={() => (scoreFormat = opt.value)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="field-group">
				<label class="lbl" for="fee">Iuran per orang (Rp)</label>
				<input id="fee" type="number" min="0" step="500" bind:value={fee} />
			</div>

			<div class="field-group">
				<p class="lbl">Pasangan ({pairs.filter((p) => p.a || p.b).length})</p>
				{#each pairs as pair, i (i)}
					<div class="pair-row">
						<span class="slot-no">{i + 1}</span>
						<PlayerPicker {clubId} label="Orang 1" bind:value={pair.a} excludeIds={chosenIds(pair.a)} />
						<PlayerPicker {clubId} label="Orang 2" bind:value={pair.b} excludeIds={chosenIds(pair.b)} />
						{#if pairs.length > 2}
							<button type="button" class="rm" onclick={() => removePair(i)} aria-label="Hapus pasangan">×</button>
						{/if}
					</div>
				{/each}
				<button type="button" class="add" onclick={addPair}>+ Tambah pasangan</button>
			</div>

			{#if formError}
				<p class="err">{formError}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" fullWidth disabled={submitting} onclick={submit}>
			{submitting ? 'Membuat…' : 'Buat turnamen'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.lbl {
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-soft);
	}
	.fmt-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.fmt {
		border: 1px solid var(--line-2);
		background: var(--surface);
		border-radius: 999px;
		padding: 7px 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.fmt.sm {
		font-size: 12.5px;
		padding: 6px 11px;
	}
	.fmt.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
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
	.pair-row {
		display: grid;
		grid-template-columns: 18px 1fr 1fr auto;
		gap: 6px;
		align-items: center;
	}
	.slot-no {
		font-size: 12px;
		color: var(--ink-faint);
		text-align: center;
	}
	.rm {
		width: 32px;
		height: 32px;
		flex: none;
		border: 0;
		background: var(--surface-2);
		border-radius: 8px;
		color: var(--ink-faint);
		font-size: 16px;
		cursor: pointer;
	}
	.add {
		align-self: flex-start;
		border: 0;
		background: none;
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		padding: 4px 0;
	}
	.err {
		font-size: 13px;
		color: var(--hancur);
	}

	@media (max-width: 480px) {
		.pair-row {
			grid-template-columns: 1fr;
		}
		.slot-no {
			display: none;
		}
	}
</style>
