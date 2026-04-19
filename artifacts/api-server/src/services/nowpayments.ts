import { logger } from "../lib/logger";

/**
 * Thin wrapper around the NOWPayments REST API. Only the pieces we actually
 * need: create a hosted invoice that the user is redirected to. The IPN
 * webhook (routes/nowpayments-webhook.ts) handles payment confirmation.
 *
 * Docs: https://documenter.getpostman.com/view/7907941/S1a32n38
 */

const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

export function isNowPaymentsConfigured(): boolean {
  return !!process.env.NOWPAYMENTS_API_KEY;
}

export type CreateInvoiceInput = {
  orderId: string;           // membership id or credit-purchase id — the webhook matches on this
  priceAmount: number;       // fiat amount, e.g. 299.00
  priceCurrency: string;     // ISO currency, typically "usd"
  orderDescription: string;
  ipnCallbackUrl: string;    // https://<host>/api/payments/nowpayments/webhook
  successUrl: string;
  cancelUrl: string;
};

export type CreateInvoiceResult = {
  invoiceId: string;
  invoiceUrl: string;
  orderId: string;
};

export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not configured");

  const body = {
    price_amount: input.priceAmount,
    price_currency: input.priceCurrency,
    order_id: input.orderId,
    order_description: input.orderDescription,
    ipn_callback_url: input.ipnCallbackUrl,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };

  const res = await fetch(`${NOWPAYMENTS_API}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, text }, "[nowpayments] invoice create failed");
    throw new Error(`NOWPayments invoice create failed: ${res.status} ${text}`);
  }

  const json = await res.json() as {
    id: string;
    invoice_url: string;
    order_id: string;
  };

  return {
    invoiceId: String(json.id),
    invoiceUrl: json.invoice_url,
    orderId: String(json.order_id),
  };
}

/** List available crypto currencies NOWPayments accepts (for UI display). */
export async function listAvailableCurrencies(): Promise<string[]> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`${NOWPAYMENTS_API}/currencies`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return [];
    const json = await res.json() as { currencies: string[] };
    return json.currencies ?? [];
  } catch (err) {
    logger.warn({ err }, "[nowpayments] failed to list currencies");
    return [];
  }
}
