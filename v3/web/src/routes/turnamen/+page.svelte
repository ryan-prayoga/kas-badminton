<!--
	Turnamen — SENGAJA kosong sampai F7 (PLAN.md §14 F5 catatan tab
	Turnamen): nav 4-tab dibangun utuh di F5, isinya menyusul. Keadaan
	kosong jujur, bukan layar rusak.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe } from '$lib/stores/club.svelte';
	import { AppShell, Card } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';

	let createOpen = $state(false);

	onMount(() => {
		if (!isLoggedIn()) {
			goto('/login');
			return;
		}
		if (!hasLoadedMemberships()) void loadMe();
	});
</script>

<svelte:head>
	<title>Turnamen — Kok Badminton</title>
</svelte:head>

{#if !hasLoadedMemberships() || isLoadingMemberships()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<p style="color:var(--ink-faint);font-size:13px">Memuat…</p>
	</main>
{:else if !activeClub()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">Belum punya klub — balik ke Beranda buat bikin atau gabung klub dulu.</p>
			<a href="/" class="retry">Ke Beranda →</a>
		</Card>
	</main>
{:else}
	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={() => {}} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/turnamen" header={clubHeader}>
		<div class="page">
			<Card>
				<p class="empty-title display">Turnamen segera hadir</p>
				<p class="hint">Bagan, klasemen, dan iuran turnamen lagi digarap — belum bisa dipakai di sini.</p>
			</Card>
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} />

<style>
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 0;
	}
	.retry {
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
	}
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding-top: 16px;
	}
	.empty-title {
		font-size: 18px;
		font-weight: 800;
		margin-bottom: 6px;
	}
</style>
