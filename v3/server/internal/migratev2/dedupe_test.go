package migratev2

import (
	"reflect"
	"sort"
	"testing"
)

func TestNormalizeName(t *testing.T) {
	cases := map[string]string{
		"  Rian   Pratama ": "Rian Pratama",
		"Andre":             "Andre",
		"   ":               "",
	}
	for in, want := range cases {
		if got := NormalizeName(in); got != want {
			t.Errorf("NormalizeName(%q) = %q, mau %q", in, got, want)
		}
	}
}

func TestClusterNames_CatchesCaseAndSpacingTypos(t *testing.T) {
	clusters := ClusterNames([]string{"Rian", "rian", "Andre", "Bagus"})
	if len(clusters) != 1 {
		t.Fatalf("clusters = %d, mau 1 (Rian/rian)", len(clusters))
	}
	got := append([]string{}, clusters[0].Names...)
	sort.Strings(got)
	want := []string{"Rian", "rian"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("cluster = %v, mau %v", got, want)
	}
}

func TestClusterNames_CatchesPrefixCase(t *testing.T) {
	// Kasus nyata di data seed lokal (kok_badminton dev DB) — dua orang
	// yang MUNGKIN sama, MUNGKIN beda (satu nama lengkap dipakai belakangan).
	clusters := ClusterNames([]string{"Made", "Made Wijaya", "Andre"})
	if len(clusters) != 1 || len(clusters[0].Names) != 2 {
		t.Fatalf("clusters = %+v, mau 1 cluster berisi Made + Made Wijaya", clusters)
	}
}

func TestClusterNames_DoesNotMergeClearlyDifferentNames(t *testing.T) {
	clusters := ClusterNames([]string{"Andre", "Bagus", "Cahyo", "Dedi"})
	if len(clusters) != 0 {
		t.Fatalf("clusters = %+v, mau kosong — nama-nama ini jelas beda orang", clusters)
	}
}

func TestClusterNames_DeterministicOrder(t *testing.T) {
	names := []string{"Zahwan", "rian", "Rian", "Andre", "andre"}
	a := ClusterNames(names)
	b := ClusterNames(names)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("ClusterNames tidak deterministik: %+v vs %+v", a, b)
	}
}

func TestTemplateMapping_IdentityAndMissingNames(t *testing.T) {
	tpl := TemplateMapping([]string{"Rian", "Andre", "  Rian  "})
	if len(tpl) != 2 {
		t.Fatalf("template punya %d entri, mau 2 (Rian, Andre — duplikat setelah normalisasi)", len(tpl))
	}
	if tpl["Rian"] != "Rian" || tpl["Andre"] != "Andre" {
		t.Fatalf("template bukan identity mapping: %+v", tpl)
	}

	missing := tpl.MissingNames([]string{"Rian", "Andre", "Bagus"})
	if len(missing) != 1 || missing[0] != "Bagus" {
		t.Fatalf("missing = %v, mau [Bagus]", missing)
	}
}

func TestNameMapping_Resolve(t *testing.T) {
	m := NameMapping{"rian": "Rian Pratama", "Rian": "Rian Pratama"}
	got, err := m.Resolve(" Rian ")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "Rian Pratama" {
		t.Fatalf("Resolve = %q, mau Rian Pratama", got)
	}
	if _, err := m.Resolve("TidakAda"); err == nil {
		t.Fatal("Resolve nama yang tidak ada di mapping harusnya error")
	}
}
