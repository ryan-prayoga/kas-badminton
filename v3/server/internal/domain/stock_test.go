package domain

import "testing"

func TestCountKoksByType(t *testing.T) {
	m := CountKoksByType([]Kok{{TypeID: "t1"}, {TypeID: "t1"}, {TypeID: ""}})
	if m["t1"] != 2 {
		t.Fatalf("got %d, mau 2", m["t1"])
	}
}

func TestStockDeltas_PakaiDuaKokBaru(t *testing.T) {
	d := StockDeltas(nil, []Kok{{TypeID: "t1"}, {TypeID: "t1"}})
	if d["t1"] != -2 {
		t.Fatalf("got %d, mau -2", d["t1"])
	}
}

func TestStockDiffError(t *testing.T) {
	types := []KokType{{ID: "t1", Name: "RS", Stock: 2}}

	if err := StockDiffError(types, nil, []Kok{{TypeID: "t1"}, {TypeID: "t1"}, {TypeID: "t1"}}); err == "" {
		t.Fatal("harusnya galat: butuh 3, sisa 2")
	}
	if err := StockDiffError(types, nil, []Kok{{TypeID: "t1"}, {TypeID: "t1"}}); err != "" {
		t.Fatalf("harusnya cukup, dapat: %q", err)
	}
}

func TestExpenseFromInitialStock(t *testing.T) {
	if got := ExpenseFromInitialStock(12, 130_000); got != 130_000 {
		t.Fatalf("12 pcs @130rb/slop = %d, mau 130000", got)
	}
	if got := SlopsFromStock(12); got != 1 {
		t.Fatalf("slop 12 pcs = %d, mau 1", got)
	}
	if got := ExpenseFromInitialStock(24, 130_000); got != 260_000 {
		t.Fatalf("24 pcs @130rb = %d, mau 260000", got)
	}
	if got := ExpenseFromInitialStock(12, 0); got != 0 {
		t.Fatalf("tanpa harga/slop = %d, mau 0", got)
	}
}
