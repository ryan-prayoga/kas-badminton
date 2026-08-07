<script lang="ts">
	// Pasang sekali di root layout. Popover manual — otomatis tampil/sembunyi
	// mengikuti jumlah toast aktif (lihat implementasi Toaster.root di paket melt).
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toaster } from './toaster-store.svelte';
</script>

<div {...toaster.root} class="root">
	{#each toaster.toasts as t (t.id)}
		<div
			{...t.content}
			class="toast {t.data.tone ?? 'netral'}"
			transition:fly={{ y: 16, duration: 220, easing: cubicOut }}
		>
			{#if t.data.title}
				<p {...t.title} class="title">{t.data.title}</p>
			{/if}
			<p {...t.description} class="desc">{t.data.description}</p>
			<button {...t.close} class="close" aria-label="Tutup notifikasi">
				<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" /></svg>
			</button>
		</div>
	{/each}
</div>

<style>
	.root {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 8px;
		padding: 12px calc(12px + env(safe-area-inset-bottom, 0px)) calc(84px + env(safe-area-inset-bottom, 0px));
		pointer-events: none;
		margin: 0;
		border: 0;
		background: none;
		inset: auto 0 0 0;
	}
	.toast {
		pointer-events: auto;
		position: relative;
		width: min(360px, calc(100vw - 24px));
		background: var(--surface);
		border: 1px solid var(--line);
		border-left: 3px solid var(--ink-faint);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
		padding: 12px 34px 12px 14px;
	}
	.toast.lunas {
		border-left-color: var(--lunas);
	}
	.toast.hancur {
		border-left-color: var(--hancur);
	}
	.title {
		font-weight: 700;
		font-size: 14px;
		margin-bottom: 2px;
	}
	.desc {
		font-size: 13.5px;
		color: var(--ink-soft);
	}
	.close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		border-radius: 7px;
		color: var(--ink-faint);
		cursor: pointer;
		transition: background var(--t-tap);
	}
	.close:hover {
		background: var(--surface-2);
	}
	.close svg {
		width: 13px;
		height: 13px;
		stroke: currentColor;
		stroke-width: 2;
		fill: none;
	}

	@media (min-width: 768px) {
		.root {
			left: auto;
			align-items: flex-end;
			padding: 16px;
		}
	}
</style>
