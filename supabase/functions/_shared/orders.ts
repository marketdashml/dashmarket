import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { MercadoLivreClient } from "./ml-client.ts";
import { ProductLinker } from "./linking.ts";

export type MLOrderItem = {
  item: { id: string; title: string; seller_sku?: string };
  quantity: number;
  unit_price: number;
  full_unit_price?: number;
  sale_fee?: number;
};

export type MLOrder = {
  id: number;
  status: string;
  date_created: string;
  date_closed?: string;
  buyer?: { billing_info?: { state_or_province?: string } };
  total_amount: number;
  paid_amount?: number;
  currency_id?: string;
  order_items: MLOrderItem[];
  shipping?: { cost?: number; id?: number };
  taxes?: { amount?: number };
  coupon?: { amount?: number };
  payments?: { marketplace_fee?: number; total_paid_amount?: number }[];
};

/**
 * Faz upsert de um pedido do ML (e seus itens) no banco, vinculando ao
 * produto interno por seller_sku quando possivel. Idempotente.
 */
export async function upsertMercadoLivreOrder(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
  order: MLOrder,
  linker: ProductLinker
): Promise<boolean> {
  const grossAmount = order.total_amount ?? 0;
  const shippingCost = order.shipping?.cost ?? 0;
  const taxes = order.taxes?.amount ?? 0;
  const discounts = order.coupon?.amount ?? 0;
  const marketplaceFee = (order.payments ?? []).reduce(
    (sum, p) => sum + (p.marketplace_fee ?? 0),
    0
  );
  const netAmount = grossAmount - marketplaceFee - shippingCost - discounts - taxes;

  const { data: savedOrder, error: orderError } = await supabase
    .from("orders")
    .upsert(
      {
        organization_id: organizationId,
        marketplace_account_id: accountId,
        provider_order_id: String(order.id),
        sold_at: order.date_created,
        status: order.status,
        buyer_state: order.buyer?.billing_info?.state_or_province ?? null,
        gross_amount: grossAmount,
        marketplace_fee_amount: marketplaceFee,
        shipping_cost_amount: shippingCost,
        discounts_amount: discounts,
        taxes_amount: taxes,
        net_amount: netAmount,
        raw_payload: order
      },
      { onConflict: "marketplace_account_id,provider_order_id" }
    )
    .select("id")
    .single();

  if (orderError || !savedOrder) return false;

  for (const item of order.order_items ?? []) {
    const itemGross = item.unit_price * item.quantity;
    const itemFee = item.sale_fee ?? 0;
    const sellerSku = item.item.seller_sku ?? null;
    const productId = await linker.resolve(sellerSku, item.item.title);
    const listingId = await linker.resolveListing(accountId, item.item.id);

    await supabase.from("order_items").upsert(
      {
        organization_id: organizationId,
        order_id: savedOrder.id,
        product_id: productId,
        marketplace_listing_id: listingId,
        external_item_id: item.item.id,
        seller_sku: sellerSku,
        title: item.item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        gross_amount: itemGross,
        marketplace_fee_amount: itemFee,
        shipping_cost_amount: 0,
        discount_amount: 0,
        raw_payload: item
      },
      { onConflict: "order_id,external_item_id" }
    );
  }

  return true;
}

/** Busca um pedido na API do ML e faz upsert. Usado pelo webhook. */
export async function syncSingleOrder(
  client: MercadoLivreClient,
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
  orderId: string,
  linker: ProductLinker
): Promise<boolean> {
  const order = await client.tryGet<MLOrder>(`/orders/${orderId}`);
  if (!order) return false;
  return upsertMercadoLivreOrder(supabase, organizationId, accountId, order, linker);
}
