import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  MercadoLivreClient,
  createServiceClient,
  readEnv,
  startSyncRun
} from "../_shared/ml-client.ts";
import { ProductLinker } from "../_shared/linking.ts";

type SyncRequest = {
  marketplace_account_id: string;
  organization_id: string;
};

type ItemsSearch = {
  results: string[];
  paging: { total: number; offset: number; limit: number };
};

type MLVariation = {
  id: number;
  seller_custom_field?: string;
  available_quantity?: number;
};

type MLItem = {
  id: string;
  title: string;
  permalink?: string;
  status?: string;
  listing_type_id?: string;
  available_quantity?: number;
  seller_custom_field?: string;
  shipping?: { logistic_type?: string };
  variations?: MLVariation[];
};

type MultiGetEntry = { code: number; body: MLItem };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

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
    "listings"
  );

  try {
    const client = await MercadoLivreClient.forAccount(
      supabase,
      env,
      body.marketplace_account_id
    );
    const linker = new ProductLinker(supabase, body.organization_id);
    const sellerId = account.external_seller_id as string;

    // 1. Coleta todos os ids de itens com paginacao por offset.
    const itemIds: string[] = [];
    const LIMIT = 50;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const page = await client.get<ItemsSearch>(
        `/users/${sellerId}/items/search?limit=${LIMIT}&offset=${offset}`
      );
      const results = page.results ?? [];
      itemIds.push(...results);
      offset += results.length;
      hasMore =
        results.length === LIMIT && offset < (page.paging?.total ?? 0) && offset < 1000;
    }

    // 2. Multiget em lotes de 20 e upsert.
    let processed = 0;
    const attributes =
      "id,title,permalink,status,listing_type_id,available_quantity,seller_custom_field,shipping,variations";

    for (const ids of chunk(itemIds, 20)) {
      const entries = await client.get<MultiGetEntry[]>(
        `/items?ids=${ids.join(",")}&attributes=${attributes}`
      );

      for (const entry of entries) {
        if (entry.code !== 200 || !entry.body) continue;
        const item = entry.body;
        const sellerSku = item.seller_custom_field ?? null;
        const productId = await linker.resolve(sellerSku, item.title);

        await supabase.from("marketplace_listings").upsert(
          {
            organization_id: body.organization_id,
            marketplace_account_id: body.marketplace_account_id,
            product_id: productId,
            provider: "mercadolivre",
            external_item_id: item.id,
            seller_sku: sellerSku,
            title: item.title,
            permalink: item.permalink ?? null,
            listing_type: item.listing_type_id ?? null,
            fulfillment_type: item.shipping?.logistic_type ?? null,
            status: item.status ?? null,
            raw_payload: item
          },
          { onConflict: "marketplace_account_id,external_item_id" }
        );
        processed++;
      }
    }

    await run.finishSuccess(processed, { total_items: itemIds.length });
    return jsonResponse({ ok: true, resource: "listings", records_processed: processed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await run.finishFailed(message);
    return jsonResponse({ error: message }, 500);
  }
});
