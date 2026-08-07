import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// Dev lokal saja — produksi satu binary Go, tidak ada proxy (§4.1).
		// Port Go bawaan 8300 (internal/config, PORT env di sisi server itu).
		proxy: {
			'/api': 'http://localhost:8300'
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SPA statis, di-embed ke binary Go lewat go:embed (PLAN.md §4.1).
			// fallback: index.html menangani semua rute client-side; tidak ada
			// server Node saat runtime.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: true
			})
		})
	]
});
