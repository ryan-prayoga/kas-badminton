<script lang="ts">
	// Satu sistem tombol (PLAN.md §5.3). Tinggi 52px untuk aksi utama (`lg`),
	// minimum 44px untuk sisanya — ditegakkan di sini, bukan disiplin manual.
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
	type Size = 'md' | 'lg';

	let {
		variant = 'secondary',
		size = 'md',
		type = 'button',
		disabled = false,
		fullWidth = false,
		href,
		children,
		...rest
	}: {
		variant?: Variant;
		size?: Size;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		/** Lebar penuh kontainer — dipakai untuk CTA utama seperti "Bayar sekarang". */
		fullWidth?: boolean;
		href?: string;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const tag = $derived(href ? 'a' : 'button');
</script>

<svelte:element
	this={tag}
	{href}
	type={tag === 'button' ? type : undefined}
	{disabled}
	aria-disabled={disabled}
	class="btn {variant} {size}"
	class:full={fullWidth}
	{...rest}
>
	{@render children()}
</svelte:element>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		border-radius: var(--radius);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		text-decoration: none;
		transition:
			background var(--t-tap),
			border-color var(--t-tap),
			color var(--t-tap),
			transform var(--t-tap);
	}
	.btn:active {
		transform: scale(0.985);
	}
	.btn[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.5;
		transform: none;
	}
	.full {
		width: 100%;
	}

	.md {
		min-height: 44px;
		padding: 0 16px;
		font-size: 14.5px;
	}
	.lg {
		height: 52px;
		padding: 0 20px;
		font-size: 15.5px;
	}

	.primary {
		background: var(--accent);
		color: #fff;
	}
	.primary:not([aria-disabled='true']):hover {
		background: var(--accent-deep);
	}

	.secondary {
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line-2);
	}
	.secondary:not([aria-disabled='true']):hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.ghost {
		background: none;
		color: var(--ink-soft);
	}
	.ghost:not([aria-disabled='true']):hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.destructive {
		background: none;
		border: 1px solid var(--line-2);
		color: var(--hancur);
	}
	.destructive:not([aria-disabled='true']):hover {
		background: color-mix(in srgb, var(--hancur) 10%, transparent);
		border-color: var(--hancur);
	}
</style>
