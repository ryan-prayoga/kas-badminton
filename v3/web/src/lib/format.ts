// Format angka siap tampil (API.md §0: rupiah selalu bigint tanpa desimal
// di wire, dibentuk "Rp 47.000" cuma di UI).
const rupiahFormatter = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0
});

export function rupiah(amount: number): string {
	return rupiahFormatter.format(amount).replace(/\s/g, ' '); // NBSP → spasi biasa, konsisten sama font di app.css
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
	weekday: 'short',
	day: 'numeric',
	month: 'short'
});

export function tanggalPendek(isoDate: string): string {
	// isoDate "YYYY-MM-DD" — new Date() tanpa waktu diinterpretasi UTC oleh
	// spec, aman dipakai di sini karena cuma tanggal kalender, bukan jam.
	return dateFormatter.format(new Date(isoDate + 'T00:00:00'));
}
