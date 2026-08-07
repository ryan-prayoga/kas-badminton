<script lang="ts">
	// Satu sistem kolom isian (PLAN.md §5.3). Label di atas, galat di bawah
	// dengan kalimat konkret (§5.6.1) — bukan cuma tepi merah.
	let {
		value = $bindable(''),
		label,
		error,
		hint,
		id = crypto.randomUUID(),
		type = 'text',
		...rest
	}: {
		value?: string;
		label?: string;
		error?: string;
		hint?: string;
		id?: string;
		type?: string;
		[key: string]: unknown;
	} = $props();
</script>

<div class="field">
	{#if label}
		<label for={id}>{label}</label>
	{/if}
	<input {id} {type} bind:value aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...rest} />
	{#if error}
		<p class="msg err" id="{id}-err">{error}</p>
	{:else if hint}
		<p class="msg" id="{id}-hint">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	label {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-soft);
	}
	input {
		height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 15px;
		transition: border-color var(--t-tap);
	}
	input::placeholder {
		color: var(--ink-faint);
	}
	input:hover {
		border-color: var(--ink-faint);
	}
	input:focus {
		outline: none;
		border-color: var(--accent);
	}
	input[aria-invalid='true'] {
		border-color: var(--hancur);
	}
	.msg {
		font-size: 12.5px;
		color: var(--ink-faint);
	}
	.msg.err {
		color: var(--hancur);
	}
</style>
