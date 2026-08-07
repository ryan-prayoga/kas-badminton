// Toggle tema terang/gelap. Sumber kebenaran atribut `data-theme` di <html>,
// disetel duluan tanpa-kedip lewat skrip inline di app.html (baca komentarnya
// di sana kalau logikanya diubah — dua tempat ini harus tetap sinkron).

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'kok-theme';

export function getTheme(): Theme {
	if (typeof document === 'undefined') return 'light';
	return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function apply(theme: Theme) {
	document.documentElement.setAttribute('data-theme', theme);
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Storage privat/penuh — tema tetap berubah untuk sesi ini, cuma tidak diingat.
	}
}

/** Ganti tema. Dibungkus View Transitions kalau browser dukung (PLAN.md §5.7). */
export function toggleTheme() {
	const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';

	const doc = document as Document & {
		startViewTransition?: (cb: () => void) => void;
	};

	if (typeof doc.startViewTransition === 'function' && !prefersReducedMotion()) {
		doc.startViewTransition(() => apply(next));
	} else {
		apply(next);
	}
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
