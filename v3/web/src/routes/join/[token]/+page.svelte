<script lang="ts">
	// Alur gabung klub lewat QR tembok / tautan (PLAN.md §6.4, §7.3):
	// pindai -> info klub -> nomor -> OTP -> pilih nama lama ATAU daftar
	// baru -> antrean persetujuan admin. PUBLIK sampai OTP terverifikasi.
	import { page } from '$app/state';
	import { Button, Card, Input } from '$lib/components/ui';
	import { api, ApiError } from '$lib/api/client';
	import { setSession, isLoggedIn } from '$lib/stores/session.svelte';
	import { onMount } from 'svelte';

	const token = page.params.token;

	type ClubInfo = { id: string; slug: string; name: string };
	type Unclaimed = { id: string; display_name: string };

	type Step = 'loading' | 'invalid' | 'phone' | 'code' | 'pick' | 'pending';
	let step = $state<Step>('loading');
	let club = $state<ClubInfo | null>(null);
	let unclaimed = $state<Unclaimed[]>([]);
	let phone = $state('');
	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	let picked = $state<string | null>(null); // user_id akun bayangan, atau null = orang baru

	onMount(load);

	async function load() {
		try {
			const info = await api.get<{ club: ClubInfo; unclaimed: Unclaimed[] }>(`/join/${token}`);
			club = info.club;
			unclaimed = info.unclaimed;
			step = isLoggedIn() ? 'pick' : 'phone';
		} catch {
			step = 'invalid';
		}
	}

	async function requestOtp() {
		error = '';
		busy = true;
		try {
			await api.post(`/join/${token}`, { phone });
			step = 'code';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal mengirim kode.';
		} finally {
			busy = false;
		}
	}

	async function verifyOtp() {
		error = '';
		busy = true;
		try {
			const result = await api.post<{
				session_token: string;
				user: { id: string; phone: string; display_name: string };
			}>('/auth/otp/verify', { phone, code });
			setSession(result.session_token, result.user);
			step = 'pick';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Verifikasi gagal.';
		} finally {
			busy = false;
		}
	}

	async function submitClaim() {
		if (!club) return;
		error = '';
		busy = true;
		try {
			await api.post(`/clubs/${club.id}/claim-requests`, { target_user_id: picked });
			step = 'pending';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal mengajukan permintaan gabung.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{club ? `Gabung ${club.name}` : 'Gabung klub'} — Kok Badminton</title>
</svelte:head>

<main class="page">
	<div class="wrap">
		{#if step === 'loading'}
			<p class="hint">Memuat…</p>
		{:else if step === 'invalid'}
			<Card>
				<h2 class="title display">Tautan tidak berlaku</h2>
				<p class="hint">QR atau tautan ini sudah tidak aktif. Minta yang baru ke pengurus klub.</p>
			</Card>
		{:else if club}
			<div class="head">
				<span class="dot display">{club.name.slice(0, 2).toUpperCase()}</span>
				<div>
					<h1 class="display">{club.name}</h1>
					<p class="hint">kaskok.my.id/{club.slug}</p>
				</div>
			</div>

			{#if step === 'phone'}
				<Card>
					<h2 class="title display">Gabung klub ini</h2>
					<p class="hint">Masukkan nomor WA buat verifikasi.</p>
					<div class="field">
						<Input label="Nomor WA" placeholder="+6281234567890" bind:value={phone} error={error || undefined} />
					</div>
					<Button variant="primary" size="lg" fullWidth disabled={busy || !phone} onclick={requestOtp}>
						{busy ? 'Mengirim…' : 'Kirim kode'}
					</Button>
				</Card>
			{:else if step === 'code'}
				<Card>
					<h2 class="title display">Masukkan kode</h2>
					<p class="hint">Kode 6 digit dikirim ke {phone}.</p>
					<div class="field">
						<Input label="Kode OTP" placeholder="123456" bind:value={code} error={error || undefined} />
					</div>
					<Button variant="primary" size="lg" fullWidth disabled={busy || code.length !== 6} onclick={verifyOtp}>
						{busy ? 'Memverifikasi…' : 'Verifikasi'}
					</Button>
				</Card>
			{:else if step === 'pick'}
				<Card>
					<h2 class="title display">Ini kamu yang mana?</h2>
					<p class="hint">Pilih nama lamamu kalau pernah main di klub ini, atau daftar sebagai orang baru.</p>

					<div class="list">
						<label class="row">
							<input type="radio" name="pick" checked={picked === null} onchange={() => (picked = null)} />
							<span><b>Saya orang baru</b></span>
						</label>
						{#each unclaimed as u (u.id)}
							<label class="row">
								<input
									type="radio"
									name="pick"
									checked={picked === u.id}
									onchange={() => (picked = u.id)}
								/>
								<span>{u.display_name}</span>
							</label>
						{/each}
					</div>

					{#if error}<p class="err">{error}</p>{/if}
					<Button variant="primary" size="lg" fullWidth disabled={busy} onclick={submitClaim}>
						{busy ? 'Mengirim…' : 'Ajukan gabung'}
					</Button>
				</Card>
			{:else if step === 'pending'}
				<Card>
					<h2 class="title display">Permintaan terkirim</h2>
					<p class="hint">
						Menunggu persetujuan pengurus klub — biasanya selesai dalam hitungan menit. Kamu akan
						diberi tahu begitu disetujui.
					</p>
				</Card>
			{/if}
		{/if}
	</div>
</main>

<style>
	.page {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		background: var(--bg);
		padding: 20px;
	}
	.wrap {
		width: 100%;
		max-width: 420px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
	}
	.head .dot {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--accent);
		color: #fff;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: 15px;
		flex: none;
	}
	.head h1 {
		font-size: 19px;
		font-weight: 700;
	}
	.title {
		font-size: var(--text-title);
		font-weight: 700;
		margin-bottom: 4px;
	}
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 14px;
	}
	.field {
		margin-bottom: 14px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 16px;
		max-height: 260px;
		overflow-y: auto;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 8px;
		border-radius: var(--radius-card);
		cursor: pointer;
		font-size: 14.5px;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.err {
		color: var(--hancur);
		font-size: 13px;
		margin-bottom: 10px;
	}
</style>
