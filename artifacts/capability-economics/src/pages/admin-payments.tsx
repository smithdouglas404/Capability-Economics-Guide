import PaymentApprovals from "@/components/payment-approvals";

export default function AdminPaymentsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <PaymentApprovals showHeader />
    </div>
  );
}
