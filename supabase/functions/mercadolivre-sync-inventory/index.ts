import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  MercadoLivreClient,
  createServiceClient,
  readEnv,
  startSyncRun
} from "../_shared/ml-client.ts";

type SyncRequest = {
  marketplace_account_id: string;
  organization_id: string;
};

type MLVariation = {
  id: number;
  seller_custom_field?: string;
  available_quantity?: number;
};

type MLItem = {
  id: string;
  available_quantity?: number;
  sold_quantity?: number;
  seller_custom_field?: string;
  shipping?: { logistic_type?: string };
  variations?: MLVariation[];
};

type MultiGetEntry = { code: number; body: MLItem };

type ListingRow = {
  external_item_id: string;
  seller_sku: string | null;
  product_id: string | null;
  fulfillment_type: string | null;
};

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
  const run = await startSyncRun(
    supabase,
    body.organization_id,
    body.marketplace_account_id,
    "inventory"
  );

  try {
    const client = await MercadoLivreClient.forAccount(
      supabase,
      env,
      body.marketplace_account_id
    );

    // Usa os listings ja sincronizados como fonte da lista de itens.
    const { data: listings } = await supabase
      .from("marketplace_listings")
      .select("external_item_id, seller_sku, product_id, fulfillment_type")
      .eq("marketplace_account_id", body.marketplace_account_id);

    const rows = (listings ?? []) as ListingRow[];
    if (rows.length === 0) {
      await run.finishSuccess(0, { note: "Nenhum listing sincronizado ainda." });
      return jsonResponse({ ok: true, resource: "inventory", records_processed: 0 });
    }

    const byItemId = new Map(rows.map((r) => [r.external_item_id, r]));
    const capturedAt = new Date().toISOString();
    const snapshots: Record<string, unknown>[] = [];

    for (const ids of chunk(rows.map((r) => r.external_item_id), 20)) {
      const entries = await client.get<MultiGetEntry[]>(
        `/items?ids=${ids.join(",")}&attributes=id,available_quantity,sold_quantity,seller_custom_field,shipping,variations`
      );

      for (const entry of entries) {
        if (entry.code !== 200 || !entry.body) continue;
        const item = entry.body;
        const listing = byItemId.get(item.id);
        const channel = item.shipping?.logistic_type ?? listing?.fulfillment_type ?? "unknown";

        if (item.variations && item.variations.length > 0) {
          for (const variation of item.variations) {
            snapshots.push({
              organization_id: body.organization_id,
              marketplace_account_id: body.marketplace_account_id,
              product_id: listing?.product_id ?? null,
              external_item_id: item.id,
              seller_sku: variation.seller_custom_field ?? listing?.seller_sku ?? null,
              fulfillment_channel: channel,
              available_quantity: variation.available_quantity ?? 0,
              reserved_quantity: 0,
              not_available_quantity: 0,
              captured_at: capturedAt,
              raw_payload: variation
            });
          }
        } else {
          snapshots.push({
            organization_id: body.organization_id,
            marketplace_account_id: body.marketplace_account_id,
            product_id: listing?.product_id ?? null,
            external_item_id: item.id,
            seller_sku: item.seller_custom_field ?? listing?.seller_sku ?? null,
            fulfillment_channel: channel,
            available_quantity: item.available_quantity ?? 0,
            reserved_quantity: 0,
            not_available_quantity: 0,
            captured_at: capturedAt,
            raw_payload: item
          });
        }
      }
    }

    // Insere em lotes (snapshots sao append-only / historico).
    let processed = 0;
    for (const batch of chunk(snapshots, 500)) {
      const { error } = await supabase.from("inventory_snapshots").insert(batch);
      if (!error) processed += batch.length;
    }

    await run.finishSuccess(processed);
    return jsonResponse({ ok: true, resource: "inventory", records_processed: processed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await run.finishFailed(message);
    return jsonResponse({ error: message }, 500);
  }
});
