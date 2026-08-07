// Toaster tunggal untuk seluruh app (PLAN.md §5.3 — "dibangun sendiri di atas
// Melt UI"). Instance dibuat sekali di sini, dipakai lewat `toast(...)` dari
// mana saja, dirender oleh <Toast /> yang dipasang sekali di root layout.
import { Toaster } from 'melt/builders';

export type ToastTone = 'netral' | 'lunas' | 'hancur';

export type ToastAction = { label: string; onClick: () => void };

export type ToastData = {
	title?: string;
	description: string;
	tone?: ToastTone;
	// Batalkan cepat (§9.4) dan sanggahan (§9.4) butuh tombol aksi langsung
	// di toast, bukan cuma pesan — "Batalkan"/"Saya tidak ikut" harus di
	// jangkauan jempol persis di tempat notifikasinya muncul.
	action?: ToastAction;
};

export const toaster = new Toaster<ToastData>({ closeDelay: 4500 });

export function toast(description: string, opts: Omit<ToastData, 'description'> & { closeDelay?: number } = {}) {
	const { closeDelay, ...data } = opts;
	return toaster.addToast({ data: { description, ...data }, closeDelay });
}
