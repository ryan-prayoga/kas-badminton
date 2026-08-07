<!--
	Indikator mode pesawat (PLAN.md §14 F5 "mode pesawat tetap bisa dibaca").
	Reaktif ke isOnline() (network.svelte.ts, dinyalain outbox.ts di root
	layout) — banner ini murni tampilan, tidak menyentuh logic outbox.
-->
<script lang="ts">
	import { isOnline } from '$lib/offline/network.svelte';
</script>

{#if !isOnline()}
	<div class="banner" role="status">
		<span class="dot"></span>
		Mode pesawat — perubahan tersimpan, terkirim otomatis pas online lagi.
	</div>
{/if}

<style>
	.banner {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 7px 12px calc(7px + env(safe-area-inset-top, 0px));
		padding-top: calc(7px + env(safe-area-inset-top, 0px));
		background: var(--ink);
		color: var(--surface);
		font-size: 12.5px;
		font-weight: 600;
		text-align: center;
	}
	.dot {
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.7;
	}
</style>
