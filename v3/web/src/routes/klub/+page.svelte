<!--
	Klub (F5/4, PLAN.md §14 F5) — daftar anggota + pencarian orang (§5.4).
	Sama pola boot/error dgn Beranda: klub belum ke-load / gagal / kosong
	ditangani eksplisit, bukan nebak.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { activeClub, hasLoadedMemberships, isLoadingMemberships, loadMe } from '$lib/stores/club.svelte';
	import { listMembers, type Member } from '$lib/api/members';
	import { AppShell, Card, Badge, Input } from '$lib/components/ui';
	import ClubHeaderBar from '$lib/components/ClubHeaderBar.svelte';
	import CreateClubDialog from '$lib/components/CreateClubDialog.svelte';

	const ROLE_LABEL: Record<string, string> = {
		admin: 'Admin',
		bendahara: 'Bendahara',
		pencatat: 'Pencatat',
		verifikator: 'Verifikator',
		member: 'Anggota'
	};

	let createOpen = $state(false);
	let query = $state('');
	let members = $state<Member[]>([]);
	let membersLoading = $state(false);
	let membersError = $state('');
	let bootError = $state('');
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		if (!isLoggedIn()) {
			goto('/login');
			return;
		}
		void boot();
	});

	async function boot() {
		bootError = '';
		try {
			if (!hasLoadedMemberships()) await loadMe();
			const club = activeClub();
			if (club) await fetchMembers(club.club_id, '');
		} catch (e) {
			bootError = e instanceof ApiError ? e.message : 'Gagal memuat profil. Coba lagi.';
		}
	}

	async function fetchMembers(clubId: string, q: string) {
		membersLoading = true;
		membersError = '';
		try {
			members = await listMembers(clubId, q);
		} catch (e) {
			membersError = e instanceof ApiError ? e.message : 'Gagal memuat anggota. Coba lagi.';
		} finally {
			membersLoading = false;
		}
	}

	function onQueryInput() {
		clearTimeout(searchDebounce);
		const club = activeClub();
		if (!club) return;
		searchDebounce = setTimeout(() => fetchMembers(club.club_id, query), 300);
	}

	async function onSwitchClub(clubId: string) {
		query = '';
		await fetchMembers(clubId, '');
	}
</script>

<svelte:head>
	<title>Klub — Kok Badminton</title>
</svelte:head>

{#if !hasLoadedMemberships() || isLoadingMemberships()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<p style="color:var(--ink-faint);font-size:13px">Memuat…</p>
	</main>
{:else if bootError}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">{bootError}</p>
			<button class="retry" onclick={boot}>Coba lagi</button>
		</Card>
	</main>
{:else if !activeClub()}
	<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
		<Card>
			<p class="hint">Belum punya klub — balik ke Beranda buat bikin atau gabung klub dulu.</p>
			<a href="/" class="retry">Ke Beranda →</a>
		</Card>
	</main>
{:else}
	{@const club = activeClub()}

	{#snippet clubHeader()}
		<ClubHeaderBar onSwitch={onSwitchClub} onCreateClub={() => (createOpen = true)} />
	{/snippet}

	<AppShell current="/klub" header={clubHeader}>
		<div class="page">
			<div class="pagehead">
				<h1 class="h-title display">Anggota {club!.club_name}</h1>
				<p class="h-sub">{members.length} orang · cari nama buat nemuin cepat</p>
			</div>

			<Input placeholder="Cari nama…" bind:value={query} oninput={onQueryInput} />

			<Card padded={false}>
				{#if membersError}
					<div class="state">
						<p class="hint">{membersError}</p>
						<button class="retry" onclick={() => fetchMembers(club!.club_id, query)}>Coba lagi</button>
					</div>
				{:else if membersLoading && members.length === 0}
					<div class="state"><p class="hint">Memuat anggota…</p></div>
				{:else if members.length === 0}
					<div class="state">
						<p class="hint">
							{query ? `Gak ada anggota bernama "${query}".` : 'Belum ada anggota selain kamu.'}
						</p>
					</div>
				{:else}
					{#each members as m, i (m.user_id)}
						<div class="member-row" class:last={i === members.length - 1}>
							<div class="who">
								<span class="dot display">{m.display_name.slice(0, 2).toUpperCase()}</span>
								<div class="meta">
									<span class="nm">{m.display_name}</span>
									{#if m.status === 'unclaimed'}
										<span class="sub">Belum klaim akun</span>
									{:else if m.is_tournament_guest}
										<span class="sub">Tamu turnamen</span>
									{/if}
								</div>
							</div>
							<Badge tone={m.role === 'admin' ? 'accent' : 'netral'}>{ROLE_LABEL[m.role] ?? m.role}</Badge>
						</div>
					{/each}
				{/if}
			</Card>
		</div>
	</AppShell>
{/if}

<CreateClubDialog bind:open={createOpen} />

<style>
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 10px;
	}
	.retry {
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0;
	}

	.page {
		max-width: 640px;
		margin: 0 auto;
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pagehead {
		margin-bottom: 2px;
	}
	.h-title {
		font-size: 22px;
		font-weight: 800;
	}
	.h-sub {
		color: var(--ink-faint);
		font-size: 13px;
		margin-top: 2px;
	}

	.state {
		padding: 24px 16px;
		text-align: center;
	}
	.state .hint {
		margin-bottom: 6px;
	}

	.member-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.member-row.last {
		border-bottom: 0;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.dot {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex: none;
		background: var(--surface-2);
		border: 1px solid var(--line-2);
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 12.5px;
		color: var(--ink-soft);
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.nm {
		font-size: 14.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 11.5px;
		color: var(--ink-faint);
	}
</style>
