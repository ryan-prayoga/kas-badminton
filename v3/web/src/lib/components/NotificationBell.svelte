<!--
	Pusat notifikasi in-app (F8/2, PLAN.md §10.1 "pusat notifikasi adalah
	kebenaran — push bisa terlewat, ditolak izinnya, atau tidak didukung
	perangkat"). Lonceng di header, ada di SEMUA halaman (dipasang lewat
	ClubHeaderBar) — bukan halaman terpisah, supaya selalu satu ketuk dari
	mana pun sedang berada.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Dialog } from '$lib/components/ui';
	import { listNotifications, markNotificationRead, type AppNotification } from '$lib/api/notifications';

	let open = $state(false);
	let items = $state<AppNotification[]>([]);
	let loading = $state(false);
	let loaded = $state(false);

	const unreadCount = $derived(items.filter((n) => !n.read_at).length);

	onMount(refresh);

	async function refresh() {
		loading = true;
		try {
			items = await listNotifications();
		} catch {
			// Diam — lonceng tidak boleh melempar error mengganggu tiap
			// halaman cuma karena satu fetch gagal; coba lagi pas dibuka.
		} finally {
			loading = false;
			loaded = true;
		}
	}

	function onToggle() {
		open = !open;
		if (open && !loaded) refresh();
	}

	async function onItemClick(n: AppNotification) {
		if (!n.read_at) {
			try {
				const updated = await markNotificationRead(n.id);
				items = items.map((x) => (x.id === n.id ? updated : x));
			} catch {
				// biarkan tetap tampil belum-dibaca — tidak fatal.
			}
		}
		if (n.url) {
			open = false;
			goto(n.url);
		}
	}

	function timeAgo(iso: string): string {
		const diffMs = Date.now() - new Date(iso).getTime();
		const min = Math.floor(diffMs / 60000);
		if (min < 1) return 'baru saja';
		if (min < 60) return `${min} menit lalu`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr} jam lalu`;
		return `${Math.floor(hr / 24)} hari lalu`;
	}
</script>

<button type="button" class="bell" onclick={onToggle} aria-label="Notifikasi">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
		<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
		<path d="M13.73 21a2 2 0 0 1-3.46 0" />
	</svg>
	{#if unreadCount > 0}
		<span class="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
	{/if}
</button>

<Dialog bind:open title="Notifikasi">
	{#snippet children()}
		{#if loading && items.length === 0}
			<p class="hint">Memuat…</p>
		{:else if items.length === 0}
			<p class="hint">Belum ada notifikasi.</p>
		{:else}
			<div class="list">
				{#each items as n (n.id)}
					<button type="button" class="item" class:unread={!n.read_at} onclick={() => onItemClick(n)}>
						<div class="dot" class:visible={!n.read_at}></div>
						<div class="body">
							<p class="title">{n.title || n.kind}</p>
							{#if n.body}<p class="text">{n.body}</p>{/if}
							<p class="time">{timeAgo(n.created_at)}</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/snippet}
</Dialog>

<style>
	.bell {
		position: relative;
		width: 34px;
		height: 34px;
		flex: none;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		color: var(--ink-soft);
		cursor: pointer;
		border-radius: 50%;
	}
	.bell:hover {
		background: var(--surface-2);
	}
	.bell svg {
		width: 20px;
		height: 20px;
	}
	.badge {
		position: absolute;
		top: 2px;
		right: 2px;
		min-width: 15px;
		height: 15px;
		padding: 0 3px;
		border-radius: 999px;
		background: var(--hancur);
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		display: grid;
		place-items: center;
		line-height: 1;
	}
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		text-align: center;
		padding: 12px 0;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 60vh;
		overflow-y: auto;
	}
	.item {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 6px;
		border: 0;
		background: none;
		border-radius: var(--radius-card);
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface-2);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 6px;
		flex: none;
		background: transparent;
	}
	.dot.visible {
		background: var(--accent);
	}
	.body {
		min-width: 0;
	}
	.title {
		font-size: 13.5px;
		font-weight: 700;
		color: var(--ink);
	}
	.item.unread .title {
		font-weight: 800;
	}
	.text {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin-top: 2px;
	}
	.time {
		font-size: 11px;
		color: var(--ink-faint);
		margin-top: 3px;
	}
</style>
