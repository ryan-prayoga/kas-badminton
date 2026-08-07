<!--
	Pemilih pemain (PLAN.md §5.4 "pencarian ada di mana pun ada daftar
	orang" + §8.1 pemain tamu). Dipakai per slot di form catat main (F5/5):
	cari nama anggota yang sudah ada, atau bikin akun bayangan `unclaimed`
	langsung kalau namanya belum ada — "autocomplete wajib memunculkan nama
	mirip lebih dulu sebelum menawarkan 'buat baru'" (§8.1).
-->
<script lang="ts">
	import { listMembers, createGuestMember, type Member } from '$lib/api/members';
	import { toast } from '$lib/components/ui';

	let {
		clubId,
		label,
		value = $bindable<{ userId: string; displayName: string } | null>(null),
		excludeIds = []
	}: {
		clubId: string;
		label: string;
		value?: { userId: string; displayName: string } | null;
		excludeIds?: string[];
	} = $props();

	let query = $state('');
	let results = $state<Member[]>([]);
	let open = $state(false);
	let creating = $state(false);
	let debounce: ReturnType<typeof setTimeout> | undefined;

	function onInput() {
		open = true;
		clearTimeout(debounce);
		const q = query;
		debounce = setTimeout(async () => {
			try {
				const all = await listMembers(clubId, q);
				results = all.filter((m) => !excludeIds.includes(m.user_id));
			} catch {
				results = [];
			}
		}, 250);
	}

	function pick(m: Member) {
		value = { userId: m.user_id, displayName: m.display_name };
		query = '';
		results = [];
		open = false;
	}

	function clear() {
		value = null;
		query = '';
	}

	async function addAsGuest() {
		const name = query.trim();
		if (!name) return;
		creating = true;
		try {
			const m = await createGuestMember(clubId, name);
			pick(m as Member);
			toast(`"${name}" ditambahkan sebagai pemain baru.`, { tone: 'netral' });
		} catch {
			toast('Gagal menambah pemain baru. Coba lagi.', { tone: 'hancur' });
		} finally {
			creating = false;
		}
	}

	const exactMatch = $derived(results.some((m) => m.display_name.toLowerCase() === query.trim().toLowerCase()));
</script>

<div class="picker">
	{#if value}
		<div class="chip">
			<span class="nm">{value.displayName}</span>
			<button type="button" class="x" onclick={clear} aria-label="Ganti pemain">
				<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" /></svg>
			</button>
		</div>
	{:else}
		<input
			type="text"
			placeholder={label}
			bind:value={query}
			oninput={onInput}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 150)}
		/>
		{#if open && query.trim().length > 0}
			<div class="dropdown">
				{#each results as m (m.user_id)}
					<button type="button" class="opt" onmousedown={() => pick(m)}>
						{m.display_name}
						{#if m.status === 'unclaimed'}<span class="tag">tamu</span>{/if}
					</button>
				{/each}
				{#if !exactMatch}
					<button type="button" class="opt new" disabled={creating} onmousedown={addAsGuest}>
						+ Tambah "{query.trim()}" sebagai pemain baru
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}
	input {
		width: 100%;
		height: 40px;
		padding: 0 12px;
		border-radius: var(--radius);
		border: 1px solid var(--line-2);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 40px;
		padding: 0 6px 0 12px;
		border-radius: var(--radius);
		background: var(--surface-2);
		border: 1px solid var(--line-2);
	}
	.nm {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.x {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
		flex: none;
	}
	.x svg {
		width: 13px;
		height: 13px;
		stroke: currentColor;
		stroke-width: 2;
		fill: none;
	}
	.dropdown {
		position: absolute;
		z-index: 20;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
		max-height: 220px;
		overflow-y: auto;
		padding: 4px;
	}
	.opt {
		display: block;
		width: 100%;
		text-align: left;
		padding: 9px 10px;
		border-radius: 8px;
		border: 0;
		background: none;
		font: inherit;
		font-size: 13.5px;
		color: var(--ink);
		cursor: pointer;
	}
	.opt:hover {
		background: var(--surface-2);
	}
	.opt.new {
		color: var(--accent);
		font-weight: 600;
	}
	.tag {
		margin-left: 6px;
		font-size: 11px;
		color: var(--ink-faint);
	}
</style>
