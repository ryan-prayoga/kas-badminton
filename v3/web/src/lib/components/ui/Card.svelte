<script lang="ts">
	// Satu sistem kartu (PLAN.md §5.3). Pemisahan lewat garis tipis + ruang;
	// bayangan disimpan untuk elemen yang benar-benar mengambang (Dialog/Sheet).
	import type { Snippet } from 'svelte';

	let {
		padded = true,
		children,
		...rest
	}: {
		padded?: boolean;
		children: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<div class="card" class:padded {...rest}>
	{@render children()}
</div>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
	}
	.padded {
		padding: 16px;
	}
</style>
