// Port dari v2/lib/domain/stock.ts — aritmetika stok kok. Fungsi murni,
// repo layer (F2) yang menulis hasilnya ke DB.
package domain

import "fmt"

type KokType struct {
	ID           string
	Name         string
	PricePerSlop int64
	Stock        int
	Active       bool
}

// CountKoksByType menghitung berapa kok per typeId. Kok tanpa TypeID diabaikan.
func CountKoksByType(koks []Kok) map[string]int {
	out := map[string]int{}
	for _, k := range koks {
		if k.TypeID == "" {
			continue
		}
		out[k.TypeID]++
	}
	return out
}

// StockDeltas menghitung delta stok per typeId untuk transisi oldKoks →
// newKoks. Positif = stok nambah (kok dilepas), negatif = stok berkurang
// (kok dipakai).
func StockDeltas(oldKoks, newKoks []Kok) map[string]int {
	oldMap := CountKoksByType(oldKoks)
	newMap := CountKoksByType(newKoks)
	out := map[string]int{}
	seen := map[string]bool{}
	for id := range oldMap {
		seen[id] = true
	}
	for id := range newMap {
		seen[id] = true
	}
	for id := range seen {
		delta := oldMap[id] - newMap[id]
		if delta != 0 {
			out[id] = delta
		}
	}
	return out
}

// StockDiffError mengecek stok cukup buat selisih oldKoks→newKoks. Balik
// pesan error atau string kosong kalau cukup.
func StockDiffError(kokTypes []KokType, oldKoks, newKoks []Kok) string {
	oldMap := CountKoksByType(oldKoks)
	newMap := CountKoksByType(newKoks)
	byID := map[string]KokType{}
	for _, t := range kokTypes {
		byID[t.ID] = t
	}
	for id, newCount := range newMap {
		need := newCount - oldMap[id]
		if need <= 0 {
			continue
		}
		typ, ok := byID[id]
		if !ok {
			continue
		}
		avail := typ.Stock
		if avail < 0 {
			avail = 0
		}
		if need > avail {
			return fmt.Sprintf("Stok %s tidak cukup (butuh %d, sisa %d)", typ.Name, need, avail)
		}
	}
	return ""
}

// SlopsFromStock — jumlah slop untuk stok pcs (ceil, min 1 kalau stock > 0).
// 1 slop = 12 kok.
func SlopsFromStock(stock int) int {
	if stock <= 0 {
		return 0
	}
	slops := (stock + 11) / 12
	if slops < 1 {
		return 1
	}
	return slops
}

// ExpenseFromInitialStock — kas keluar dari stok awal (pcs) + harga/slop.
func ExpenseFromInitialStock(stock int, pricePerSlop int64) int64 {
	if pricePerSlop <= 0 {
		return 0
	}
	return int64(SlopsFromStock(stock)) * pricePerSlop
}
