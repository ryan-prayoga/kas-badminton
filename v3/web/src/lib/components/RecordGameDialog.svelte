<!--
	Catat main (F5/5, PLAN.md §8) — pemain fleksibel (single/ganda/rotasi),
	penanggung biaya terpisah dari pemain (§8.2), skor opsional (§8.3).
	Biaya & pemenang dihitung SERVER (games.go) — form ini cuma mengirim
	pemain, kok ad-hoc, dan skor mentah, TIDAK PERNAH menghitung amount
	sendiri (§0 API.md "biaya dihitung server").

	Mencatat main TANPA skor harus tetap secepat v2 (§8.3) — makanya bagian
	skor default tertutup di belakang checkbox, bukan langsung ditampilkan.
-->
<script lang="ts">
	import { Dialog, Button, Input, Checkbox, toast } from '$lib/components/ui';
	import PlayerPicker from './PlayerPicker.svelte';
	import { ApiError } from '$lib/api/client';
	import { createGame, type Game, type CreateGameInput } from '$lib/api/games';

	let {
		open = $bindable(false),
		clubId,
		onCreated
	}: { open?: boolean; clubId: string; onCreated?: (game: Game) => void } = $props();

	type Picked = { userId: string; displayName: string } | null;
	type Slot = { selected: Picked; payerId: string };

	function freshSlot(): Slot {
		return { selected: null, payerId: '' };
	}

	let format = $state<'single' | 'ganda' | 'rotasi'>('ganda');
	let playedOn = $state(new Date().toISOString().slice(0, 10));
	let slotsA = $state<Slot[]>([freshSlot(), freshSlot()]);
	let slotsB = $state<Slot[]>([freshSlot(), freshSlot()]);
	let rotasiSlots = $state<Slot[]>([freshSlot(), freshSlot()]);
	let koks = $state<{ typeName: string; price: number; qty: number }[]>([]);
	let scoreEnabled = $state(false);
	let scoreFormat = $state<'single' | 'bo3' | 'rally42'>('rally42');
	let sets = $state<{ a: number; b: number }[]>([{ a: 0, b: 0 }]);
	let submitting = $state(false);
	let formError = $state('');

	const FORMAT_OPTIONS: { value: typeof format; label: string }[] = [
		{ value: 'single', label: 'Tunggal' },
		{ value: 'ganda', label: 'Ganda' },
		{ value: 'rotasi', label: 'Rotasi' }
	];
	const SCORE_FORMAT_OPTIONS: { value: typeof scoreFormat; label: string }[] = [
		{ value: 'single', label: 'Sampai 30' },
		{ value: 'rally42', label: 'Rally 42 (tarkam)' },
		{ value: 'bo3', label: 'Rally 21 bo3' }
	];

	function setFormat(f: typeof format) {
		format = f;
		// Ganti format = mulai ulang pemilihan pemain — mencampur sisa
		// pilihan format lama gampang salah pasang, lebih aman kosong lagi.
		slotsA = f === 'single' ? [freshSlot()] : [freshSlot(), freshSlot()];
		slotsB = f === 'single' ? [freshSlot()] : [freshSlot(), freshSlot()];
		rotasiSlots = [freshSlot(), freshSlot()];
	}

	function allSlots(): Slot[] {
		return format === 'rotasi' ? rotasiSlots : [...slotsA, ...slotsB];
	}

	function chosenIds(exceptSlot?: Slot): string[] {
		return allSlots()
			.filter((s) => s !== exceptSlot && s.selected)
			.map((s) => s.selected!.userId);
	}

	function pickedPlayers(): { userId: string; displayName: string }[] {
		const out: { userId: string; displayName: string }[] = [];
		for (const s of allSlots()) if (s.selected) out.push(s.selected);
		return out;
	}

	function addRotasiSlot() {
		rotasiSlots = [...rotasiSlots, freshSlot()];
	}
	function removeRotasiSlot(i: number) {
		if (rotasiSlots.length <= 2) return;
		rotasiSlots = rotasiSlots.filter((_, idx) => idx !== i);
	}

	function addKok() {
		koks = [...koks, { typeName: 'Kok', price: 0, qty: 1 }];
	}
	function removeKok(i: number) {
		koks = koks.filter((_, idx) => idx !== i);
	}

	function addSet() {
		if (sets.length >= 3) return;
		sets = [...sets, { a: 0, b: 0 }];
	}
	function removeSet(i: number) {
		if (sets.length <= 1) return;
		sets = sets.filter((_, idx) => idx !== i);
	}

	function reset() {
		setFormat('ganda');
		playedOn = new Date().toISOString().slice(0, 10);
		koks = [];
		scoreEnabled = false;
		scoreFormat = 'rally42';
		sets = [{ a: 0, b: 0 }];
		formError = '';
	}

	function validate(): string {
		const need = format === 'single' ? [slotsA[0], slotsB[0]] : format === 'ganda' ? [...slotsA, ...slotsB] : rotasiSlots;
		if (need.some((s) => !s.selected)) return 'Semua slot pemain wajib diisi.';
		const ids = need.map((s) => s.selected!.userId);
		if (new Set(ids).size !== ids.length) return 'Ada pemain yang sama dipilih dua kali.';
		if (scoreEnabled) {
			const need2 = scoreFormat === 'bo3' ? sets : [sets[0]];
			for (const s of need2) if (s.a === s.b) return `Skor ${s.a}-${s.b} seri — badminton tidak kenal imbang.`;
		}
		return '';
	}

	async function submit() {
		formError = validate();
		if (formError) return;

		const players: CreateGameInput['players'] = [];
		if (format === 'rotasi') {
			rotasiSlots.forEach((s, i) => {
				players.push({
					user_id: s.selected!.userId,
					side: i % 2 === 0 ? 'a' : 'b',
					slot: Math.floor(i / 2) + 1,
					payer_id: s.payerId || s.selected!.userId
				});
			});
		} else {
			slotsA.forEach((s, i) =>
				players.push({ user_id: s.selected!.userId, side: 'a', slot: i + 1, payer_id: s.payerId || s.selected!.userId })
			);
			slotsB.forEach((s, i) =>
				players.push({ user_id: s.selected!.userId, side: 'b', slot: i + 1, payer_id: s.payerId || s.selected!.userId })
			);
		}

		const input: CreateGameInput = {
			played_on: playedOn,
			format,
			players,
			koks: koks
				.filter((k) => k.typeName.trim() && k.qty > 0)
				.map((k) => ({ type_name: k.typeName.trim(), price_per_person: Math.max(0, k.price), qty: k.qty }))
		};
		if (scoreEnabled) {
			input.score = {
				format: scoreFormat,
				games: (scoreFormat === 'bo3' ? sets : [sets[0]]).map((s) => ({ a: s.a, b: s.b }))
			};
		}

		submitting = true;
		try {
			const game = await createGame(clubId, input);
			open = false;
			onCreated?.(game);
			reset();
		} catch (e) {
			formError = e instanceof ApiError ? e.message : 'Gagal mencatat main. Coba lagi.';
		} finally {
			submitting = false;
		}
	}

	function payerOptions(self: Picked) {
		const players = pickedPlayers();
		return players.length ? players : self ? [self] : [];
	}
</script>

<Dialog bind:open title="Catat main">
	{#snippet children()}
		<div class="stack">
			<div class="fmt-row">
				{#each FORMAT_OPTIONS as opt (opt.value)}
					<button type="button" class="fmt" class:active={format === opt.value} onclick={() => setFormat(opt.value)}>
						{opt.label}
					</button>
				{/each}
			</div>

			<Input type="date" label="Tanggal" bind:value={playedOn} />

			{#if format === 'rotasi'}
				<div class="field-group">
					<p class="lbl">Pemain</p>
					{#each rotasiSlots as slot, i (i)}
						<div class="slot-row">
							<PlayerPicker {clubId} label="Cari nama…" bind:value={slot.selected} excludeIds={chosenIds(slot)} />
							{#if slot.selected}
								<select bind:value={slot.payerId} class="payer">
									<option value="">Nanggung sendiri</option>
									{#each payerOptions(slot.selected).filter((p) => p.userId !== slot.selected!.userId) as p (p.userId)}
										<option value={p.userId}>Ditanggung {p.displayName}</option>
									{/each}
								</select>
							{/if}
							{#if rotasiSlots.length > 2}
								<button type="button" class="rm" onclick={() => removeRotasiSlot(i)} aria-label="Hapus slot">×</button>
							{/if}
						</div>
					{/each}
					<button type="button" class="add" onclick={addRotasiSlot}>+ Tambah pemain</button>
				</div>
			{:else}
				<div class="vs-grid">
					<div class="field-group">
						<p class="lbl">Sisi A</p>
						{#each slotsA as slot, i (i)}
							<div class="slot-row">
								<PlayerPicker {clubId} label="Cari nama…" bind:value={slot.selected} excludeIds={chosenIds(slot)} />
							</div>
							{#if slot.selected}
								<select bind:value={slot.payerId} class="payer">
									<option value="">Nanggung sendiri</option>
									{#each payerOptions(slot.selected).filter((p) => p.userId !== slot.selected!.userId) as p (p.userId)}
										<option value={p.userId}>Ditanggung {p.displayName}</option>
									{/each}
								</select>
							{/if}
						{/each}
					</div>
					<div class="field-group">
						<p class="lbl">Sisi B</p>
						{#each slotsB as slot, i (i)}
							<div class="slot-row">
								<PlayerPicker {clubId} label="Cari nama…" bind:value={slot.selected} excludeIds={chosenIds(slot)} />
							</div>
							{#if slot.selected}
								<select bind:value={slot.payerId} class="payer">
									<option value="">Nanggung sendiri</option>
									{#each payerOptions(slot.selected).filter((p) => p.userId !== slot.selected!.userId) as p (p.userId)}
										<option value={p.userId}>Ditanggung {p.displayName}</option>
									{/each}
								</select>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<div class="field-group">
				<p class="lbl">Kok</p>
				{#each koks as k, i (i)}
					<div class="kok-row">
						<input type="text" placeholder="Nama kok" bind:value={k.typeName} />
						<input type="number" min="0" step="100" placeholder="Harga/orang" bind:value={k.price} />
						<input type="number" min="1" placeholder="Qty" bind:value={k.qty} />
						<button type="button" class="rm" onclick={() => removeKok(i)} aria-label="Hapus kok">×</button>
					</div>
				{/each}
				<button type="button" class="add" onclick={addKok}>+ Tambah kok</button>
			</div>

			<div class="field-group">
				<Checkbox label="Catat skor main ini (opsional)" bind:checked={scoreEnabled} />
				{#if scoreEnabled}
					<div class="fmt-row">
						{#each SCORE_FORMAT_OPTIONS as opt (opt.value)}
							<button
								type="button"
								class="fmt sm"
								class:active={scoreFormat === opt.value}
								onclick={() => {
									scoreFormat = opt.value;
									sets = [{ a: 0, b: 0 }];
								}}
							>
								{opt.label}
							</button>
						{/each}
					</div>
					{#each scoreFormat === 'bo3' ? sets : [sets[0]] as s, i (i)}
						<div class="score-row">
							<span class="game-no">Set {i + 1}</span>
							<input type="number" min="0" bind:value={s.a} />
							<span>—</span>
							<input type="number" min="0" bind:value={s.b} />
							{#if scoreFormat === 'bo3' && sets.length > 1}
								<button type="button" class="rm" onclick={() => removeSet(i)} aria-label="Hapus set">×</button>
							{/if}
						</div>
					{/each}
					{#if scoreFormat === 'bo3' && sets.length < 3}
						<button type="button" class="add" onclick={addSet}>+ Tambah set</button>
					{/if}
				{/if}
			</div>

			{#if formError}
				<p class="err">{formError}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" fullWidth disabled={submitting} onclick={submit}>
			{submitting ? 'Menyimpan…' : 'Catat main'}
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
	.vs-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.slot-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.payer {
		height: 32px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--surface-2);
		color: var(--ink-soft);
		font-size: 12px;
		padding: 0 8px;
		margin: -2px 0 2px;
	}
	.kok-row {
		display: grid;
		grid-template-columns: 1.4fr 1fr 0.6fr auto;
		gap: 6px;
	}
	.kok-row input,
	.score-row input {
		height: 38px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 13.5px;
		padding: 0 10px;
		min-width: 0;
	}
	.score-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.score-row input {
		width: 64px;
		text-align: center;
	}
	.game-no {
		font-size: 12.5px;
		color: var(--ink-faint);
		width: 44px;
		flex: none;
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
		.vs-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
