package domain

import "testing"

func TestDefaultChannelFor(t *testing.T) {
	if DefaultChannelFor(NotifDebtOverdue) != ChannelWA {
		t.Fatalf("tunggakan lewat batas harus WA")
	}
	for _, k := range []NotifKind{NotifGameRecorded, NotifBillPayerChanged, NotifWalletUpdated, NotifPaymentVerified, NotifClaimRequested} {
		if DefaultChannelFor(k) != ChannelPush {
			t.Fatalf("%s harusnya Push", k)
		}
	}
}

func TestIsQuietHour(t *testing.T) {
	cases := map[int]bool{
		0: true, 6: true, 7: false, 12: false, 20: false, 21: true, 23: true,
	}
	for hour, want := range cases {
		if got := IsQuietHour(hour); got != want {
			t.Fatalf("IsQuietHour(%d) = %v, mau %v", hour, got, want)
		}
	}
}
