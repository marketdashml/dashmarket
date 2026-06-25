import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  MercadoLivreClient,
  createServiceClient,
  readEnv,
  startSyncRun
} from "../_shared/ml-client.ts";
import { ProductLinker } from "../_shared/linking.ts";
import { upsertMercadoLivreOrder, type MLOrder } from "../_shared/orders.ts";

type SyncRequest = {
  marketplace_account_id: string;
  organization_id: string;
  days_back?: number;
};

type MLOrdersResponse = {
  results: MLOrder[];
  paging: { total: number; offset: number; limit: number };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metodo nao permitido." }, 405);
  }

  let env;
  try {
    env = readEnv();
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500);
  }

  const body = (await request.json()) as SyncRequest;
  if (!body.marketplace_account_id || !body.organization_id) {
    return jsonResponse(
      { error: "marketplace_account_id e organization_id sao obrigatorios." },
      400
    );
  }

  const supabase = createServiceClient(env);

  const { data: account } = await supabase
    .from("marketplace_accounts")
    .select("id, external_seller_id")
    .eq("id", body.marketplace_account_id)
    .eq("organization_id", body.organization_id)
    .single();

  if (!account) {
    return jsonResponse({ error: "Conta nao encontrada." }, 404);
  }

  const run = await startSyncRun(
    supabase,
    body.organization_id,
    body.marketplace_account_id,
    "orders"
  );

  try {
    const client = await MercadoLivreClient.forAccount(
      supabase,
      env,
      body.marketplace_account_id
    );
    const linker = new ProductLinker(supabase, body.organization_id);

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

      const page = await client.get<MLOrdersResponse>(
        `/orders/search?seller=${sellerId}&${params.toString()}`
      );

      const orders = page.results ?? [];
      hasMore =
        offset + orders.length < page.paging.total && orders.length === LIMIT;
      offset += orders.length;

      for (const order of orders) {
        const ok = await upsertMercadoLivreOrder(
          supabase,
          body.organization_id,
          body.marketplace_account_id,
          order,
          linker
        );
        if (ok) totalProcessed++;
      }
    }

    await supabase
      .from("marketplace_accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", body.marketplace_account_id);

    await run.finishSuccess(totalProcessed);
    return jsonResponse({
      ok: true,
      resource: "orders",
      records_processed: totalProcessed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await run.finishFailed(message);
    return jsonResponse({ error: message }, 500);
  }
});
