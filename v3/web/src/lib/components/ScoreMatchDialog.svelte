<!--
	Isi skor partai turnamen (F7/2, API.md §5
	POST .../matches/{matchId}/score). matchId adalah id LOGIS bagan
	("r0-0"/"rr1-2", dari BracketMatch.id) — server yang bikin baris
	`matches` fisik begitu skor pertama masuk (tournaments.go EnsureMatch).
	Pemenang & juara dihitung SERVER, dialog ini cuma kirim angka mentah.
-->
<script lang="ts">
	import { Dialog, Button, toast } from '$lib/components/ui';
	import { ApiError } from '$lib/api/client';
	import { scoreMatch, type Tournament, type BracketMatch } from '$lib/api/tournaments';

	let {
		open = $bindable(false),
		clubId,
		tournamentId,
		match,
		scoreFormat,
		onScored
	}: {
		open?: boolean;
		clubId: string;
		tournamentId: string;
		match: BracketMatch | null;
		scoreFormat: 'single' | 'bo3';
		onScored?: (t: Tournament) => void;
	} = $props();

	let sets = $state<{ a: number; b: number }[]>([{ a: 0, b: 0 }]);
	let playedAt = $state(new Date().toISOString().slice(0, 10));
	let submitting = $state(false);
	let formError = $state('');

	$effect(() => {
		if (open && match) {
			sets = match.score?.games.length ? match.score.games.map((g) => ({ ...g })) : [{ a: 0, b: 0 }];
			playedAt = match.score?.played_at ?? match.played_on ?? new Date().toISOString().slice(0, 10);
			formError = '';
		}
	});

	function addSet() {
		if (sets.length >= 3) return;
		sets = [...sets, { a: 0, b: 0 }];
	}
	function removeSet(i: number) {
		if (sets.length <= 1) return;
		sets = sets.filter((_, idx) => idx !== i);
	}

	async function submit() {
		if (!match) return;
		const active = scoreFormat === 'bo3' ? sets : [sets[0]];
		for (const s of active) {
			if (s.a === s.b) {
				formError = `Skor ${s.a}-${s.b} seri — badminton tidak kenal imbang.`;
				return;
			}
		}
		formError = '';
		submitting = true;
		try {
			const t = await scoreMatch(clubId, tournamentId, match.id, {
				format: scoreFormat,
				games: active,
				played_at: playedAt
			});
			open = false;
			onScored?.(t);
			toast('Skor tersimpan.', { tone: 'lunas' });
		} catch (e) {
			formError = e instanceof ApiError ? e.message : 'Gagal menyimpan skor. Coba lagi.';
		} finally {
			submitting = false;
		}
	}

	function sideLabel(side: { pair?: { a?: { name: string }; b?: { name: string } }; bye: boolean }): string {
		if (side.bye) return 'BYE';
		if (!side.pair) return 'Belum ditentukan';
		const names = [side.pair.a?.name, side.pair.b?.name].filter(Boolean);
		return names.length ? names.join(' / ') : 'Belum ditentukan';
	}
</script>

<Dialog bind:open title={match?.title ?? 'Isi skor'}>
	{#snippet children()}
		{#if match}
			<div class="stack">
				<p class="vs">{sideLabel(match.a)} <span class="vs-x">vs</span> {sideLabel(match.b)}</p>
				<div class="field-group">
					<label class="lbl" for="played-at">Tanggal main</label>
					<input id="played-at" type="date" bind:value={playedAt} />
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
				{#if formError}
					<p class="err">{formError}</p>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" fullWidth disabled={submitting} onclick={submit}>
			{submitting ? 'Menyimpan…' : 'Simpan skor'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.vs {
		font-size: 14px;
		font-weight: 700;
		text-align: center;
	}
	.vs-x {
		color: var(--ink-faint);
		font-weight: 500;
		margin: 0 4px;
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lbl {
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-soft);
	}
	input[type='date'] {
		height: 40px;
		border-radius: var(--radius);
		border: 1px solid var(--line-2);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		padding: 0 10px;
	}
	.score-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.score-row input {
		width: 64px;
		height: 40px;
		text-align: center;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 15px;
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
		align-self: center;
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
		text-align: center;
	}
</style>
