<script lang="ts">
	// Kerangka responsif tiga breakpoint (PLAN.md §5.6, §14 F3):
	//   <768px   — appbar atas + bottom nav
	//   768–1024 — rail navigasi kiri (ikon saja)
	//   >1024px  — sidebar penuh + tujuan sekunder
	import type { Snippet } from 'svelte';
	import BottomNav from './BottomNav.svelte';
	import SideNav from './SideNav.svelte';

	let {
		current = '/',
		secondary = [],
		header,
		children
	}: {
		current?: string;
		secondary?: { href: string; label: string }[];
		header?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="shell">
	{#if header}
		<header class="topbar">{@render header()}</header>
	{/if}

	<div class="frame">
		<aside class="rail">
			{#if header}
				<div class="rail-header">{@render header()}</div>
			{/if}
			<SideNav {current} {secondary} />
		</aside>

		<main class="content">
			{@render children()}
		</main>
	</div>

	<BottomNav {current} />
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--bg);
	}
	.topbar {
		padding: 14px 16px 10px;
	}
	.rail-header {
		display: none;
	}
	.frame {
		flex: 1;
		display: flex;
		min-height: 0;
		min-width: 0;
	}
	.rail {
		display: none;
	}
	.content {
		flex: 1;
		min-width: 0;
		padding: 0 16px 96px;
		overflow-y: auto;
	}

	@media (min-width: 768px) {
		.topbar {
			display: none;
		}
		.rail {
			display: flex;
			flex-direction: column;
			flex: none;
			width: 76px;
		}
		.rail-header {
			display: block;
			padding: 14px 10px 6px;
		}
		.content {
			padding: 24px 28px 28px;
		}
	}
	@media (min-width: 1024px) {
		.rail {
			width: 236px;
		}
	}
</style>
