<script lang="ts">
	// Daftar panjang di layar besar jadi tabel padat, angka rata kanan
	// (PLAN.md §5.6). Style saja — head/body ditulis pemanggil lewat children.
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="wrap">
	<table class="tbl">
		{@render children()}
	</table>
</div>

<style>
	.wrap {
		overflow-x: auto;
	}
	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
	}
	.tbl :global(th) {
		text-align: left;
		font-size: 11px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--ink-faint);
		font-weight: 700;
		padding: 0 10px 8px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	.tbl :global(th.r),
	.tbl :global(td.r) {
		text-align: right;
	}
	.tbl :global(td) {
		padding: 10px;
		border-bottom: 1px solid var(--line);
	}
	.tbl :global(tbody tr) {
		transition: background var(--t-tap);
	}
	.tbl :global(tbody tr[data-clickable]) {
		cursor: pointer;
	}
	.tbl :global(tbody tr:hover) {
		background: var(--surface-2);
	}
	.tbl :global(tbody tr[aria-selected='true']) {
		background: color-mix(in srgb, var(--accent) 9%, transparent);
	}
</style>
