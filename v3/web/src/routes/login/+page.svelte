<script lang="ts">
	// Alur login (PLAN.md §7.2): nomor -> OTP -> sesi -> tawarkan passkey ->
	// set PIN cadangan. "Satu pesan OTP seumur pemakaian di satu HP" — sesudah
	// ini, hari-hari berikutnya cukup Face ID atau PIN (F5 nanti memasangnya
	// di alur "buka app", halaman ini baru langkah pertama: klaim akun).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Button, Card, Input, toast } from '$lib/components/ui';
	import { api, ApiError } from '$lib/api/client';
	import { isLoggedIn, currentUser, setSession } from '$lib/stores/session.svelte';
	import { isPasskeySupported, registerPasskey } from '$lib/api/webauthn';

	type Step = 'phone' | 'code' | 'setup' | 'done';
	let step = $state<Step>('phone');
	let phone = $state('');
	let code = $state('');
	let pin = $state('');
	let error = $state('');
	let busy = $state(false);
	let passkeyDone = $state(false);
	let pinDone = $state(false);

	onMount(() => {
		if (isLoggedIn()) goto('/');
	});

	async function requestOtp() {
		error = '';
		busy = true;
		try {
			await api.post('/auth/otp/request', { phone, purpose: 'device' });
			step = 'code';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal mengirim kode. Coba lagi.';
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
			step = 'setup';
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Verifikasi gagal. Coba lagi.';
		} finally {
			busy = false;
		}
	}

	async function doRegisterPasskey() {
		error = '';
		busy = true;
		try {
			await registerPasskey();
			passkeyDone = true;
			toast('Passkey terpasang. Buka berikutnya cukup Face ID / sidik jari.', { tone: 'lunas' });
		} catch {
			// Dibatalkan atau tidak didukung — passkey & PIN SETARA (§7.2),
			// jangan diperlakukan sebagai galat fatal, cukup tawarkan PIN.
			toast('Passkey tidak terpasang. PIN tetap bisa dipakai sebagai cadangan.', {
				tone: 'netral'
			});
		} finally {
			busy = false;
		}
	}

	async function savePin() {
		error = '';
		if (!/^[0-9]{6}$/.test(pin)) {
			error = 'PIN harus 6 digit angka.';
			return;
		}
		busy = true;
		try {
			await api.post('/auth/pin/set', { pin });
			pinDone = true;
			toast('PIN tersimpan sebagai cadangan.', { tone: 'lunas' });
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal menyimpan PIN.';
		} finally {
			busy = false;
		}
	}

	function finish() {
		goto('/');
	}
</script>

<svelte:head>
	<title>Masuk — Kok Badminton</title>
</svelte:head>

<main class="page">
	<div class="wrap">
		<div class="head">
			<span class="dot display">KB</span>
			<h1 class="display">Kok Badminton</h1>
		</div>

		{#if step === 'phone'}
			<Card>
				<h2 class="title display">Masukkan nomor WA</h2>
				<p class="hint">Kode verifikasi dikirim lewat WhatsApp, sekali saja.</p>
				<div class="field">
					<Input
						label="Nomor WA"
						placeholder="+6281234567890"
						bind:value={phone}
						error={error || undefined}
					/>
				</div>
				<Button variant="primary" size="lg" fullWidth disabled={busy || !phone} onclick={requestOtp}>
					{busy ? 'Mengirim…' : 'Kirim kode'}
				</Button>
			</Card>
		{:else if step === 'code'}
			<Card>
				<h2 class="title display">Masukkan kode</h2>
				<p class="hint">Kode 6 digit dikirim ke {phone}, berlaku 5 menit.</p>
				<div class="field">
					<Input label="Kode OTP" placeholder="123456" bind:value={code} error={error || undefined} />
				</div>
				<Button variant="primary" size="lg" fullWidth disabled={busy || code.length !== 6} onclick={verifyOtp}>
					{busy ? 'Memverifikasi…' : 'Verifikasi'}
				</Button>
				<Button variant="ghost" onclick={() => (step = 'phone')}>Ganti nomor</Button>
			</Card>
		{:else if step === 'setup'}
			<Card>
				<h2 class="title display">Selamat datang, {currentUser()?.display_name}</h2>
				<p class="hint">
					Siapkan cara masuk cepat buat hari-hari berikutnya — tanpa kode WA lagi.
				</p>

				{#if isPasskeySupported()}
					<div class="setup-row">
						<div>
							<b>Passkey</b>
							<p class="hint">Face ID / sidik jari, sekali sentuh.</p>
						</div>
						{#if passkeyDone}
							<span class="ok">✓ Terpasang</span>
						{:else}
							<Button variant="secondary" disabled={busy} onclick={doRegisterPasskey}>Pasang</Button>
						{/if}
					</div>
				{/if}

				<div class="setup-row">
					<div class="pin-block">
						<b>PIN cadangan</b>
						<p class="hint">6 digit, dipakai kalau passkey tidak bisa.</p>
						{#if !pinDone}
							<Input placeholder="••••••" bind:value={pin} error={error || undefined} />
						{/if}
					</div>
					{#if pinDone}
						<span class="ok">✓ Tersimpan</span>
					{:else}
						<Button variant="secondary" disabled={busy || pin.length !== 6} onclick={savePin}>Simpan</Button>
					{/if}
				</div>

				<Button variant="primary" size="lg" fullWidth onclick={finish}>Selesai</Button>
			</Card>
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
		gap: 10px;
		margin-bottom: 20px;
	}
	.head .dot {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: var(--accent);
		color: #fff;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: 14px;
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
	.setup-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.pin-block {
		flex: 1;
	}
	.pin-block :global(.field) {
		margin-top: 8px;
		max-width: 160px;
	}
	.ok {
		color: var(--lunas);
		font-size: 13px;
		font-weight: 700;
		flex: none;
	}
	.page :global(.btn.ghost) {
		margin-top: 8px;
	}
	.page :global(.btn.primary) {
		margin-top: 16px;
	}
</style>
