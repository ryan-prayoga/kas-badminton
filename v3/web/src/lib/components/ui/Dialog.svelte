<script lang="ts">
	// Dialog/Sheet dari Melt UI (§5.3 — "dibangun sendiri di atas Melt UI").
	// Satu komponen, dua wujud lewat CSS murni (§5.6): sheet dari bawah di HP,
	// dialog di tengah di layar ≥768px. Elemen `content` WAJIB <dialog> asli —
	// builder Melt memanggil .showModal()/.close() padanya langsung.
	import { Dialog as MeltDialog } from 'melt/builders';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		closeOnOutsideClick = true,
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		closeOnOutsideClick?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	const titleId = `dlg-title-${crypto.randomUUID()}`;

	// SENGAJA tidak dikontrol lewat `open: () => open` (Synced getter-mode) —
	// itu cuma mencerminkan nilai getter ke `data-open`, TANPA memanggil
	// showModal()/close() (yang cuma jalan lewat setter instance `dialog.open =`,
	// lihat implementasi asli). Jadi state diserahkan ke instance, `open` prop
	// disinkronkan dua arah manual lewat efek di bawah + onOpenChange.
	const dialog = new MeltDialog({
		onOpenChange: (v) => (open = v),
		closeOnOutsideClick: () => closeOnOutsideClick
	});

	$effect(() => {
		if (dialog.open !== open) dialog.open = open;
	});
</script>

<div {...dialog.overlay}></div>
<dialog {...dialog.content} aria-labelledby={title ? titleId : undefined}>
	<div class="inner">
		<div class="handle" aria-hidden="true"></div>
		{#if title}
			<div class="head">
				<h2 id={titleId} class="title">{title}</h2>
				<button class="close" onclick={() => (dialog.open = false)} aria-label="Tutup">
					<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" /></svg>
				</button>
			</div>
		{/if}
		<div class="body">
			{@render children()}
		</div>
		{#if footer}
			<div class="foot">{@render footer()}</div>
		{/if}
	</div>
</dialog>

<style>
	[data-melt-dialog-overlay] {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--ink) 45%, transparent);
		opacity: 0;
		transition: opacity var(--t-panel);
	}
	[data-melt-dialog-overlay][data-open] {
		opacity: 1;
	}

	dialog {
		border: 0;
		padding: 0;
		background: var(--surface);
		color: var(--ink);
		max-width: 100%;
		width: 100%;
		position: fixed;
		inset: auto 0 0 0;
		margin: 0;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
		transform: translateY(100%);
		transition: transform var(--t-panel);
		max-height: min(85dvh, 640px);
	}
	dialog[data-open] {
		transform: translateY(0);
	}
	dialog::backdrop {
		background: transparent;
	}

	.handle {
		width: 36px;
		height: 4px;
		border-radius: 999px;
		background: var(--line-2);
		margin: 10px auto 0;
	}

	.inner {
		display: flex;
		flex-direction: column;
		max-height: min(85dvh, 640px);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px 4px;
	}
	.title {
		font-family: var(--font-display);
		font-size: var(--text-title);
		font-weight: 700;
	}
	.close {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 9px;
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
		flex: none;
		transition:
			background var(--t-tap),
			color var(--t-tap);
	}
	.close:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
	.close svg {
		width: 16px;
		height: 16px;
		stroke: currentColor;
		stroke-width: 2;
		fill: none;
	}

	.body {
		padding: 12px 18px 18px;
		overflow-y: auto;
	}
	.foot {
		padding: 12px 18px 18px;
		border-top: 1px solid var(--line);
		display: flex;
		gap: 10px;
	}

	/* ≥768px — dialog di tengah, bukan sheet (PLAN.md §5.6) */
	@media (min-width: 768px) {
		.handle {
			display: none;
		}
		dialog {
			inset: 0;
			margin: auto;
			width: min(480px, calc(100% - 40px));
			border-radius: var(--radius-lg);
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
			transform: translateY(12px) scale(0.98);
			opacity: 0;
			transition:
				transform var(--t-panel),
				opacity var(--t-panel);
		}
		dialog[data-open] {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
	}
</style>
