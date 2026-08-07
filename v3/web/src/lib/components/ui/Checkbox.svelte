<script lang="ts">
	// Kotak centang custom di atas <input type=checkbox> asli — tetap bisa
	// dioperasikan keyboard/pembaca layar, tampilannya ditata lewat CSS saja.
	// Dipakai di daftar tagihan bendahara (mode pilih-banyak, PLAN.md §5.6).
	let {
		checked = $bindable(false),
		label,
		id = crypto.randomUUID(),
		...rest
	}: {
		checked?: boolean;
		label?: string;
		id?: string;
		[key: string]: unknown;
	} = $props();
</script>

<label class="wrap" for={id}>
	<input {id} type="checkbox" bind:checked {...rest} />
	<span class="box" aria-hidden="true">
		<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-6" /></svg>
	</span>
	{#if label}<span class="label">{label}</span>{/if}
</label>

<style>
	.wrap {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
	}
	input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.box {
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: 7px;
		border: 1.5px solid var(--line-2);
		background: var(--surface);
		display: grid;
		place-items: center;
		transition:
			background var(--t-state),
			border-color var(--t-state);
	}
	.box svg {
		width: 13px;
		height: 13px;
		stroke: #fff;
		stroke-width: 3;
		fill: none;
		opacity: 0;
		transition: opacity var(--t-state);
	}
	input:checked + .box {
		background: var(--accent);
		border-color: var(--accent);
	}
	input:checked + .box svg {
		opacity: 1;
	}
	input:focus-visible + .box {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.label {
		font-size: 14.5px;
		color: var(--ink);
	}
</style>
