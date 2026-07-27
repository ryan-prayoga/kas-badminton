import { getData } from "@/lib/data";
import { listPaymentHistory } from "@/lib/repo/payments";
import { AppFrame } from "@/components/kok/app-frame";
import { PaymentHistoryView } from "@/components/kok/payment-history-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function RiwayatBayarPage() {
  const [data, paymentHistory] = await Promise.all([getData(), listPaymentHistory()]);
  const isAdmin = data.me.role === "admin";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <PaymentHistoryView entries={paymentHistory} photoMap={buildPhotoMap(data.players)} />
    </AppFrame>
  );
}
