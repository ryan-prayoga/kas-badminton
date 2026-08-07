<script lang="ts">
	// Pill status (mockup .pill/.tag). Merah HANYA untuk destruktif — dipetakan
	// di sini, bukan lewat kelas warna bebas di tempat pemakaian (PLAN.md §5.2 #3).
	import type { Snippet } from 'svelte';

	type Tone = 'lunas' | 'belum' | 'accent' | 'netral';

	let { tone = 'netral', children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		font-size: 11.5px;
		font-weight: 700;
		padding: 3px 9px;
		border-radius: 999px;
		line-height: 1.6;
	}
	.lunas {
		background: color-mix(in srgb, var(--lunas) 13%, transparent);
		color: var(--lunas);
	}
	.belum {
		background: color-mix(in srgb, var(--belum) 14%, transparent);
		color: var(--belum);
	}
	.accent {
		background: color-mix(in srgb, var(--accent) 11%, transparent);
		color: var(--accent);
	}
	.netral {
		background: var(--surface-2);
		color: var(--ink-soft);
	}
</style>
