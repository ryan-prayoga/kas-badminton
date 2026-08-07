<!--
	F0/F4 — Beranda sungguhan (F5) datang belakangan. Sementara cuma status
	login + pintasan. Lihat v3/PLAN.md §14. Sistem desain F3: /design.
-->
<script lang="ts">
	import { isLoggedIn, currentUser, clearSession } from '$lib/stores/session.svelte';
	import { api } from '$lib/api/client';

	async function logout() {
		try {
			await api.post('/auth/logout');
		} catch {
			// Sesi lokal tetap dibuang walau panggilan server gagal (mis. sudah
			// kedaluwarsa duluan) — orangnya tetap harus bisa "keluar".
		}
		clearSession();
	}
</script>

<main class="grid min-h-dvh place-items-center" style="background:var(--bg)">
	<div style="text-align:center; display:flex; flex-direction:column; gap:10px; align-items:center">
		<p style="color:var(--ink-faint);font-size:13px">Kok Badminton v3</p>

		{#if isLoggedIn()}
			<p style="color:var(--ink);font-size:14px">Masuk sebagai <b>{currentUser()?.display_name}</b></p>
			<a href="/account/sessions" style="color:var(--accent);font-size:13px;font-weight:600"
				>Perangkat & sesi →</a
			>
			<button
				onclick={logout}
				style="color:var(--hancur);font-size:13px;font-weight:600;background:none;border:0;cursor:pointer"
				>Keluar</button
			>
		{:else}
			<a href="/login" style="color:var(--accent);font-size:13px;font-weight:600">Masuk →</a>
		{/if}

		<a href="/design" style="color:var(--ink-faint);font-size:12px">Sistem desain →</a>
	</div>
</main>
