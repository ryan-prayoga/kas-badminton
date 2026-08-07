<!-- Dialog "buat klub baru" — dipakai layar "belum punya klub" (F5/3) dan
	tombol "+ Buat klub baru" di ClubHeaderBar (switcher). Sesudah sukses,
	langsung jadi klub aktif (pembuatnya otomatis admin, API.md §2). -->
<script lang="ts">
	import { Dialog, Button, Input, toast } from '$lib/components/ui';
	import { ApiError } from '$lib/api/client';
	import { createClub } from '$lib/api/clubs';
	import { loadMe, setActiveClub } from '$lib/stores/club.svelte';

	let {
		open = $bindable(false),
		onCreated
	}: { open?: boolean; onCreated?: (clubId: string) => void } = $props();

	let name = $state('');
	let slug = $state('');
	let slugTouched = $state(false);
	let creating = $state(false);
	let error = $state('');

	function slugify(n: string): string {
		return n
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40);
	}

	$effect(() => {
		if (!slugTouched) slug = slugify(name);
	});

	async function submit() {
		error = '';
		creating = true;
		try {
			const club = await createClub({ slug, name: name.trim() });
			open = false;
			name = '';
			slug = '';
			slugTouched = false;
			await loadMe();
			setActiveClub(club.id);
			toast(`${club.name} dibuat — kamu admin di sini.`, { tone: 'lunas' });
			onCreated?.(club.id);
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Gagal bikin klub.';
		} finally {
			creating = false;
		}
	}
</script>

<Dialog bind:open title="Buat klub baru">
	{#snippet children()}
		<div class="field-stack">
			<Input label="Nama klub" placeholder="mis. PB Sarjana" bind:value={name} />
			<Input
				label="Alamat klub"
				placeholder="pb-sarjana"
				bind:value={slug}
				hint="kaskok.my.id/{slug || '...'}"
				error={error || undefined}
				oninput={() => (slugTouched = true)}
			/>
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Batal</Button>
		<Button variant="primary" disabled={creating || !name.trim() || !slug} onclick={submit}>
			{creating ? 'Membuat…' : 'Buat klub'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.field-stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
