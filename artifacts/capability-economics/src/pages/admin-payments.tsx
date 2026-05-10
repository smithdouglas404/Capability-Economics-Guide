import PaymentApprovals from "@/components/payment-approvals";

import { MobileNotice } from "@/components/mobile";
export default function AdminPaymentsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <MobileNotice />
      <PaymentApprovals showHeader />
    </div>
  );
}
