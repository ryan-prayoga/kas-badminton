<script lang="ts">
	// Tab/segmented control di atas Melt UI. Root cuma merender daftar trigger;
	// panelnya digambar pemanggil lewat snippet yang menerima instance `tabs`
	// (dipakai lewat `tabs.getContent(value)`), supaya isi tiap panel bebas.
	import { Tabs as MeltTabs } from 'melt/builders';
	import type { Snippet } from 'svelte';

	let {
		value = $bindable(''),
		items,
		children
	}: {
		value?: string;
		items: { value: string; label: string }[];
		children: Snippet<[MeltTabs<string>]>;
	} = $props();

	const tabs = new MeltTabs<string>({
		value: () => value || items[0]?.value,
		onValueChange: (v) => (value = v)
	});
</script>

<div {...tabs.triggerList} class="list">
	{#each items as item (item.value)}
		<button {...tabs.getTrigger(item.value)} class="trigger">{item.label}</button>
	{/each}
</div>

{@render children(tabs)}

<style>
	.list {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface-2);
		border-radius: 999px;
		width: fit-content;
	}
	.trigger {
		border: 0;
		background: none;
		font: inherit;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--ink-soft);
		padding: 7px 16px;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background var(--t-state),
			color var(--t-state);
	}
	.trigger[data-active] {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	.trigger:hover:not([data-active]) {
		color: var(--ink);
	}
</style>
