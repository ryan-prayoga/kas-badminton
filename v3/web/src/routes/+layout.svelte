<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toast from '$lib/components/ui/Toast.svelte';
	import { initOutbox } from '$lib/offline/outbox';

	let { children } = $props();

	// F5/1: nyalain watcher jaringan + antrean tulis offline sekali di root
	// (PLAN.md §11). connectRealtime(clubIds) dipanggil belakangan (F5/2+)
	// begitu klub aktif diketahui — realtime.ts nganggur sampai dipanggil.
	onMount(() => {
		void initOutbox();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<Toast />
