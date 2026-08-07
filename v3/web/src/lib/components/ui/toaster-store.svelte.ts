// Toaster tunggal untuk seluruh app (PLAN.md §5.3 — "dibangun sendiri di atas
// Melt UI"). Instance dibuat sekali di sini, dipakai lewat `toast(...)` dari
// mana saja, dirender oleh <Toast /> yang dipasang sekali di root layout.
import { Toaster } from 'melt/builders';

export type ToastTone = 'netral' | 'lunas' | 'hancur';

export type ToastData = {
	title?: string;
	description: string;
	tone?: ToastTone;
};

export const toaster = new Toaster<ToastData>({ closeDelay: 4500 });

export function toast(description: string, opts: Omit<ToastData, 'description'> = {}) {
	return toaster.addToast({ data: { description, ...opts } });
}
