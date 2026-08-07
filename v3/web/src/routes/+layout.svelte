<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toast from '$lib/components/ui/Toast.svelte';
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';
	import { initOutbox } from '$lib/offline/outbox.svelte';
	import { registerServiceWorker } from '$lib/offline/sw';

	let { children } = $props();

	// F5/1: nyalain watcher jaringan + antrean tulis offline sekali di root
	// (PLAN.md §11). connectRealtime(clubIds) dipanggil belakangan (F5/2+)
	// begitu klub aktif diketahui — realtime.ts nganggur sampai dipanggil.
	// F5 (ekor): service worker + ajakan update, cuma di produksi (lihat
	// import.meta.env.DEV guard di sw.ts).
	onMount(() => {
		void initOutbox();
		registerServiceWorker();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<OfflineBanner />
{@render children()}
<Toast />
