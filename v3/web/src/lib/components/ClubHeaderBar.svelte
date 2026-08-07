<!--
	Header klub dipakai lewat `header` snippet AppShell di semua tab (F5/3
	Beranda, F5/4 Klub, dst) — dot+nama+"ketuk buat ganti klub" di appbar HP
	& atas rail desktop (pola dari routes/design/+page.svelte), avatar di
	kanan. Baca activeClub/myMemberships langsung dari store, jadi tiap
	halaman cuma perlu nyambungin onSwitch (reload data klub) +
	onCreateClub (buka dialog "buat klub baru" lokal halaman itu).
-->
<script lang="ts">
	import { activeClub, myMemberships, otherMemberships } from '$lib/stores/club.svelte';
	import { currentUser } from '$lib/stores/session.svelte';
	import { Dialog, Button } from '$lib/components/ui';

	let { onSwitch, onCreateClub }: { onSwitch: (clubId: string) => void; onCreateClub: () => void } =
		$props();

	let switcherOpen = $state(false);

	function pick(clubId: string) {
		switcherOpen = false;
		onSwitch(clubId);
	}
</script>

<div class="club-row">
	<button class="club-btn" onclick={() => (switcherOpen = true)}>
		<span class="dot display">{(activeClub()?.club_name ?? '?').slice(0, 2).toUpperCase()}</span>
		<span class="club-txt">
			<span class="nm">{activeClub()?.club_name}</span>
			{#if otherMemberships().length > 0}
				<span class="cv">ketuk buat ganti klub</span>
			{/if}
		</span>
	</button>
	<div class="avatar">{(currentUser()?.display_name ?? '?').slice(0, 1).toUpperCase()}</div>
</div>

<Dialog bind:open={switcherOpen} title="Ganti klub">
	{#snippet children()}
		<div class="switch-list">
			{#each myMemberships() as m (m.club_id)}
				<button
					class="switch-row"
					aria-current={m.club_id === activeClub()?.club_id ? 'true' : undefined}
					onclick={() => pick(m.club_id)}
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
				onCreateClub();
			}}
		>
			+ Buat klub baru
		</Button>
	{/snippet}
</Dialog>

<style>
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
</style>
