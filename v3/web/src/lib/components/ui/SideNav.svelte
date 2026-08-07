<script lang="ts">
	// Rail 768–1024px, sidebar penuh (+ tujuan sekunder) ≥1024px (PLAN.md §5.6).
	import { NAV_ITEMS, NAV_ICON_PATHS } from './nav-items';

	let {
		current = '/',
		secondary = []
	}: {
		current?: string;
		secondary?: { href: string; label: string }[];
	} = $props();
</script>

<nav class="side" aria-label="Navigasi utama">
	{#each NAV_ITEMS as item (item.href)}
		<a href={item.href} aria-current={current === item.href ? 'page' : undefined}>
			<svg viewBox="0 0 24 24"><path d={NAV_ICON_PATHS[item.icon]} /></svg>
			<span class="label">{item.label}</span>
		</a>
	{/each}

	{#if secondary.length}
		<p class="grp">Lainnya</p>
		{#each secondary as item (item.href)}
			<a href={item.href} class="secondary" aria-current={current === item.href ? 'page' : undefined}>
				<span class="label">{item.label}</span>
			</a>
		{/each}
	{/if}
</nav>

<style>
	.side {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 8px;
		height: 100%;
		background: var(--surface);
		border-right: 1px solid var(--line);
	}
	.side a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border-radius: 9px;
		color: var(--ink-soft);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		transition:
			background var(--t-tap),
			color var(--t-tap);
	}
	.side a:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
	.side a[aria-current='page'] {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}
	.side svg {
		width: 18px;
		height: 18px;
		stroke: currentColor;
		fill: none;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}
	.grp {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 14px 10px 4px;
	}
	.secondary {
		padding-left: 10px;
	}

	/* 768–1024px: rail — cuma ikon, label disembunyikan & sekunder disembunyikan */
	@media (max-width: 1023px) {
		.side {
			align-items: center;
			padding: 12px 6px;
		}
		.side a {
			width: 44px;
			justify-content: center;
		}
		.label,
		.grp {
			display: none;
		}
	}
</style>
