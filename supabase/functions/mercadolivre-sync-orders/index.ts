import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type SyncRequest = {
  marketplace_account_id: string;
  organization_id: string;
  days_back?: number;
};

type MLOrder = {
  id: number;
  status: string;
  date_created: string;
  date_closed?: string;
  buyer?: { billing_info?: { state_or_province?: string } };
  total_amount: number;
  paid_amount?: number;
  currency_id?: string;
  order_items: MLOrderItem[];
  shipping?: { cost?: number };
  taxes?: { amount?: number };
  coupon?: { amount?: number };
  payments?: { marketplace_fee?: number; total_paid_amount?: number }[];
};

type MLOrderItem = {
  item: { id: string; title: string; seller_sku?: string };
  quantity: number;
  unit_price: number;
  full_unit_price?: number;
  sale_fee?: number;
};

type MLOrdersResponse = {
  results: MLOrder[];
  paging: { total: number; offset: number; limit: number };
};

async function mlGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`ML API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function refreshTokenIfNeeded(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const { data: creds } = await supabase
    .from("marketplace_account_credentials")
    .select("access_token, refresh_token, token_expires_at")
    .eq("account_id", accountId)
    .single();

  if (!creds) throw new Error("Credenciais nao encontradas.");

  const expiresAt = creds.token_expires_at ? new Date(creds.token_expires_at) : null;
  const needsRefresh = expiresAt && expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh || !creds.refresh_token) {
    return creds.access_token as string;
  }

  const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refresh_token as string
    })
  });

  if (!tokenResponse.ok) {
    return creds.access_token as string;
  }

  const newToken = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const newExpiresAt = newToken.expires_in
    ? new Date(Date.now() + newToken.expires_in * 1000).toISOString()
    : null;

  await supabase
    .from("marketplace_account_credentials")
    .update({
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token ?? creds.refresh_token,
      token_expires_at: newExpiresAt
    })
    .eq("account_id", accountId);

  return newToken.access_token;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Metodo nao permitido." },
      { status: 405, headers: corsHeaders }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("MERCADOLIVRE_CLIENT_ID");
  const clientSecret = Deno.env.get("MERCADOLIVRE_CLIENT_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return Response.json(
      { error: "Variaveis de ambiente incompletas." },
      { status: 500, headers: corsHeaders }
    );
  }

  const body = (await request.json()) as SyncRequest;

  if (!body.marketplace_account_id || !body.organization_id) {
    return Response.json(
      { error: "marketplace_account_id e organization_id sao obrigatorios." },
      { status: 400, headers: corsHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: account } = await supabase
    .from("marketplace_accounts")
    .select("id, external_seller_id, site_id")
    .eq("id", body.marketplace_account_id)
    .eq("organization_id", body.organization_id)
    .single();

  if (!account) {
    return Response.json(
      { error: "Conta nao encontrada." },
      { status: 404, headers: corsHeaders }
    );
  }

  const { data: syncRun } = await supabase
    .from("sync_runs")
    .insert({
      organization_id: body.organization_id,
      marketplace_account_id: body.marketplace_account_id,
      provider: "mercadolivre",
      resource: "orders",
      status: "running",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();

  const syncRunId = syncRun?.id as string | undefined;

  try {
    const accessToken = await refreshTokenIfNeeded(
      supabase,
      body.marketplace_account_id,
      clientId,
      clientSecret
    );

    const daysBack = body.days_back ?? 30;
    const dateFrom = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const sellerId = account.external_seller_id as string;
    const LIMIT = 50;
    let offset = 0;
    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        "order.date_created.from": `${dateFrom}T00:00:00.000-00:00`,
        sort: "date_desc",
        offset: String(offset),
        limit: String(LIMIT)
      });

      const page = await mlGet<MLOrdersResponse>(
        `/users/${sellerId}/orders/search?${params.toString()}`,
        accessToken
      );

      const orders = page.results ?? [];
      hasMore = offset + orders.length < page.paging.total && orders.length === LIMIT;
      offset += orders.length;

      for (const order of orders) {
        const grossAmount = order.total_amount ?? 0;
        const shippingCost = order.shipping?.cost ?? 0;
        const taxes = order.taxes?.amount ?? 0;
        const discounts = order.coupon?.amount ?? 0;

        const marketplaceFee = (order.payments ?? []).reduce(
          (sum, p) => sum + (p.marketplace_fee ?? 0),
          0
        );

        const netAmount =
          grossAmount - marketplaceFee - shippingCost - discounts - taxes;

        const { data: savedOrder, error: orderError } = await supabase
          .from("orders")
          .upsert(
            {
              organization_id: body.organization_id,
              marketplace_account_id: body.marketplace_account_id,
              provider_order_id: String(order.id),
              sold_at: order.date_created,
              status: order.status,
              buyer_state:
                order.buyer?.billing_info?.state_or_province ?? null,
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

        if (orderError || !savedOrder) continue;

        for (const item of order.order_items ?? []) {
          const itemGross = item.unit_price * item.quantity;
          const itemFee = item.sale_fee ?? 0;

          await supabase.from("order_items").upsert(
            {
              organization_id: body.organization_id,
              order_id: savedOrder.id,
              external_item_id: item.item.id,
              seller_sku: item.item.seller_sku ?? null,
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

        totalProcessed++;
      }
    }

    await supabase
      .from("marketplace_accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", body.marketplace_account_id);

    if (syncRunId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_processed: totalProcessed
        })
        .eq("id", syncRunId);
    }

    return Response.json(
      { ok: true, records_processed: totalProcessed },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";

    if (syncRunId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message
        })
        .eq("id", syncRunId);
    }

    return Response.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
});
