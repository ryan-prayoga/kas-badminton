<script lang="ts">
	// Preferensi notifikasi + langganan push (F8/2, PLAN.md §10.2).
	// Tombol aktifkan push SENGAJA di sini, bukan otomatis saat app
	// dibuka — "izin notifikasi diminta SETELAH ada momen relevan".
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isLoggedIn } from '$lib/stores/session.svelte';
	import { Card, Button, toast } from '$lib/components/ui';
	import { ApiError } from '$lib/api/client';
	import { getNotificationPrefs, patchNotificationPref, type NotificationPref } from '$lib/api/notifications';
	import { isPushSupported, pushPermission, currentSubscription, subscribePush, unsubscribePush } from '$lib/notifications/push';

	const KIND_LABELS: Record<string, string> = {
		game_recorded: 'Dicatat ikut main',
		bill_payer_changed: 'Penanggung tagihan berubah',
		wallet_updated: 'Deposit berubah',
		payment_verified: 'Pembayaran diverifikasi',
		claim_requested: 'Permintaan gabung (pengurus)',
		debt_overdue: 'Pengingat tunggakan'
	};
	const KIND_ORDER = Object.keys(KIND_LABELS);

	let prefs = $state<Record<string, NotificationPref>>({});
	let loading = $state(true);
	let pushSubscribed = $state(false);
	let pushBusy = $state(false);
	let pushSubId = $state<string | null>(null);

	onMount(async () => {
		if (!isLoggedIn()) {
			goto('/login');
			return;
		}
		await load();
	});

	async function load() {
		loading = true;
		try {
			const items = await getNotificationPrefs();
			const byKind: Record<string, NotificationPref> = {};
			for (const p of items) if (!p.club_id) byKind[p.kind] = p;
			prefs = byKind;
			const sub = await currentSubscription();
			pushSubscribed = !!sub;
		} catch (e) {
			toast(e instanceof ApiError ? e.message : 'Gagal memuat preferensi.', { tone: 'hancur' });
		} finally {
			loading = false;
		}
	}

	function prefFor(kind: string): NotificationPref {
		return prefs[kind] ?? { kind, push_on: true, wa_on: true };
	}

	async function toggle(kind: string, field: 'push_on' | 'wa_on') {
		const current = prefFor(kind);
		const updated = { ...current, [field]: !current[field] };
		prefs = { ...prefs, [kind]: updated };
		try {
			await patchNotificationPref(updated);
		} catch (e) {
			prefs = { ...prefs, [kind]: current };
			toast(e instanceof ApiError ? e.message : 'Gagal menyimpan preferensi.', { tone: 'hancur' });
		}
	}

	async function onEnablePush() {
		pushBusy = true;
		try {
			const sub = await subscribePush();
			pushSubId = sub.id;
			pushSubscribed = true;
			toast('Notifikasi push dinyalakan.', { tone: 'lunas' });
		} catch (e) {
			toast(e instanceof Error ? e.message : 'Gagal menyalakan push.', { tone: 'hancur' });
		} finally {
			pushBusy = false;
		}
	}

	async function onDisablePush() {
		pushBusy = true;
		try {
			await unsubscribePush(pushSubId ?? undefined);
			pushSubscribed = false;
			toast('Notifikasi push dimatikan di perangkat ini.', { tone: 'netral' });
		} catch {
			toast('Gagal mematikan push.', { tone: 'hancur' });
		} finally {
			pushBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Notifikasi — Kok Badminton</title>
</svelte:head>

<main class="page">
	<div class="wrap">
		<a href="/account" class="back">← Akun</a>
		<h1 class="display">Notifikasi</h1>

		<Card>
			<p class="lbl">Push di perangkat ini</p>
			{#if !isPushSupported()}
				<p class="hint">Browser atau perangkat ini belum mendukung notifikasi push.</p>
			{:else if pushPermission() === 'denied'}
				<p class="hint">Izin notifikasi ditolak. Nyalakan lewat pengaturan browser buat mengaktifkan lagi.</p>
			{:else if pushSubscribed}
				<p class="hint">Push aktif di perangkat ini.</p>
				<Button variant="secondary" disabled={pushBusy} onclick={onDisablePush}>
					{pushBusy ? 'Memproses…' : 'Matikan push di perangkat ini'}
				</Button>
			{:else}
				<p class="hint">Belum aktif. Nyalakan supaya kabar penting sampai seketika.</p>
				<Button variant="primary" disabled={pushBusy} onclick={onEnablePush}>
					{pushBusy ? 'Memproses…' : 'Nyalakan notifikasi push'}
				</Button>
			{/if}
		</Card>

		<Card padded={false}>
			<p class="section-title">Jenis notifikasi</p>
			{#if loading}
				<p class="hint" style="padding:0 16px 14px">Memuat…</p>
			{:else}
				<div class="rows">
					{#each KIND_ORDER as kind (kind)}
						{@const p = prefFor(kind)}
						<div class="row">
							<span class="kind">{KIND_LABELS[kind]}</span>
							<div class="toggles">
								<button type="button" class="chip" class:on={p.push_on} onclick={() => toggle(kind, 'push_on')}>
									Push
								</button>
								<button type="button" class="chip" class:on={p.wa_on} onclick={() => toggle(kind, 'wa_on')}>
									WA
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card>
		<p class="hint small">Berlaku di semua klub. Pengingat tunggakan tetap kadang lewat WA walau Push dimatikan, kalau kamu belum pernah menyalakan push di perangkat mana pun.</p>
	</div>
</main>

<style>
	.page {
		min-height: 100dvh;
		background: var(--bg);
		padding: 24px 20px;
	}
	.wrap {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.back {
		font-size: 13px;
		color: var(--ink-faint);
		text-decoration: none;
	}
	h1 {
		font-size: 22px;
		font-weight: 800;
	}
	.lbl {
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--ink-soft);
		margin-bottom: 6px;
	}
	.hint {
		font-size: 13.5px;
		color: var(--ink-soft);
		margin-bottom: 10px;
	}
	.hint.small {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.section-title {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-soft);
		padding: 14px 16px 8px;
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-top: 1px solid var(--line);
	}
	.kind {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--ink);
	}
	.toggles {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.chip {
		border: 1px solid var(--line-2);
		background: var(--surface);
		border-radius: 999px;
		padding: 5px 12px;
		font-size: 12px;
		font-weight: 700;
		color: var(--ink-faint);
		cursor: pointer;
	}
	.chip.on {
		background: color-mix(in srgb, var(--accent) 13%, var(--surface));
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
