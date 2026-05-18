import PaymentApprovals from "@/components/payment-approvals";
import { AdminPageShell } from "@/components/admin-page-shell";

export default function AdminPaymentsPage() {
  return (
    <AdminPageShell title="Payments" description="Approvals, refunds, manual comp grants.">
      <PaymentApprovals showHeader={false} />
    </AdminPageShell>
  );
}
