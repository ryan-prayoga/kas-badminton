<script lang="ts">
	// Navigasi HP < 768px (PLAN.md §5.4, §5.6). Sengaja tanpa backdrop-filter —
	// latar solid, lihat catatan §5.7.
	import { NAV_ITEMS, NAV_ICON_PATHS } from './nav-items';

	let { current = '/' }: { current?: string } = $props();
</script>

<nav class="nav" aria-label="Navigasi utama">
	{#each NAV_ITEMS as item (item.href)}
		<a href={item.href} aria-current={current === item.href ? 'page' : undefined}>
			<svg viewBox="0 0 24 24"><path d={NAV_ICON_PATHS[item.icon]} /></svg>
			<span>{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.nav {
		display: flex;
		padding: 6px 8px calc(10px + env(safe-area-inset-bottom, 0px));
		background: var(--surface);
		border-top: 1px solid var(--line);
	}
	.nav a {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 8px 2px;
		color: var(--ink-faint);
		font-size: 11px;
		font-weight: 600;
		text-decoration: none;
		transition: color var(--t-tap);
	}
	.nav a[aria-current='page'] {
		color: var(--accent);
		font-weight: 700;
	}
	.nav svg {
		width: 21px;
		height: 21px;
		stroke: currentColor;
		fill: none;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (min-width: 768px) {
		.nav {
			display: none;
		}
	}
</style>
