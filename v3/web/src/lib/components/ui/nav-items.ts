// Empat tab tetap (PLAN.md §5.4) — nama dan jumlahnya tidak berubah walau izin
// pengguna berubah, supaya orang tidak bingung saat perannya naik/turun.
export type NavItem = {
	href: string;
	label: string;
	icon: 'beranda' | 'main' | 'klub' | 'turnamen';
};

export const NAV_ITEMS: NavItem[] = [
	{ href: '/', label: 'Beranda', icon: 'beranda' },
	{ href: '/main', label: 'Main', icon: 'main' },
	{ href: '/klub', label: 'Klub', icon: 'klub' },
	{ href: '/turnamen', label: 'Turnamen', icon: 'turnamen' }
];

// Path ikon 24×24, stroke seragam — dipakai BottomNav & SideNav supaya identik.
export const NAV_ICON_PATHS: Record<NavItem['icon'], string> = {
	beranda: 'M4 11.5 12 4l8 7.5M6 10v9h12v-9M10 19v-5h4v5',
	main: 'M6 18 18 6M9 6h5.5a1.5 1.5 0 0 1 1.5 1.5V13M8 20.5A2.5 2.5 0 1 0 8 15.5a2.5 2.5 0 0 0 0 5Z',
	klub: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M15 14.7c2.4.3 4.2 2.1 4.7 5.3',
	turnamen: 'M7 4h10v3.5a5 5 0 0 1-10 0V4Zm0 1.5H4v1a3 3 0 0 0 3 3M17 5.5h3v1a3 3 0 0 1-3 3M10.5 12.3v3.2h3v-3.2M9 19.5h6l-.6-2.7a.8.8 0 0 0-.8-.6h-3.2a.8.8 0 0 0-.8.6L9 19.5Z'
};
