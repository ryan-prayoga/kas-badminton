import { getData } from "@/lib/data";
import { listBalanceAdjustments, listKokPurchases } from "@/lib/repo/expenses";
import { listPaymentHistory } from "@/lib/repo/payments";
import { AppFrame } from "@/components/kok/app-frame";
import { PaymentHistoryView } from "@/components/kok/payment-history-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function RiwayatBayarPage() {
  const [data, paymentHistory, balanceAdjustments, kokPurchases] = await Promise.all([
    getData(),
    listPaymentHistory(),
    listBalanceAdjustments(),
    listKokPurchases(),
  ]);
  const isAdmin = data.me.role === "admin";
  const entries = [...paymentHistory, ...balanceAdjustments, ...kokPurchases].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <PaymentHistoryView entries={entries} photoMap={buildPhotoMap(data.players)} />
    </AppFrame>
  );
}
