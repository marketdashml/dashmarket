import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  MercadoLivreClient,
  createServiceClient,
  readEnv
} from "../_shared/ml-client.ts";
import { ProductLinker } from "../_shared/linking.ts";
import { syncSingleOrder } from "../_shared/orders.ts";

type EventRow = {
  id: string;
  organization_id: string | null;
  marketplace_account_id: string | null;
  topic: string;
  resource: string;
  external_user_id: string | null;
};

/** Extrai o id final de um resource tipo "/orders/2000003508419013". */
function resourceId(resource: string): string | null {
  const parts = resource.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
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

  const supabase = createServiceClient(env);
  const body = (await request.json().catch(() => ({}))) as { limit?: number };
  const limit = body.limit ?? 100;

  // Pega eventos ainda nao processados e vinculados a uma conta.
  const { data: events } = await supabase
    .from("marketplace_events")
    .select("id, organization_id, marketplace_account_id, topic, resource, external_user_id")
    .eq("provider", "mercadolivre")
    .is("processed_at", null)
    .not("marketplace_account_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(limit);

  const rows = (events ?? []) as EventRow[];
  if (rows.length === 0) {
    return jsonResponse({ ok: true, processed: 0, orders_synced: 0 });
  }

  // Cache de client/linker por conta para reaproveitar token e produtos.
  const clients = new Map<string, MercadoLivreClient>();
  const linkers = new Map<string, ProductLinker>();
  let ordersSynced = 0;
  const processedIds: string[] = [];

  for (const event of rows) {
    const accountId = event.marketplace_account_id!;
    const orgId = event.organization_id!;

    try {
      const isOrderTopic =
        event.topic === "orders" ||
        event.topic === "orders_v2" ||
        event.resource.includes("/orders/");

      if (isOrderTopic) {
        const orderId = resourceId(event.resource);
        if (orderId) {
          if (!clients.has(accountId)) {
            clients.set(
              accountId,
              await MercadoLivreClient.forAccount(supabase, env, accountId)
            );
          }
          if (!linkers.has(accountId)) {
            linkers.set(accountId, new ProductLinker(supabase, orgId));
          }

          const ok = await syncSingleOrder(
            clients.get(accountId)!,
            supabase,
            orgId,
            accountId,
            orderId,
            linkers.get(accountId)!
          );
          if (ok) ordersSynced++;
        }
      }
      // Outros topicos (items, questions, shipments) sao apenas marcados como
      // processados por ora — o sync agendado cobre listings/estoque.

      processedIds.push(event.id);
    } catch (_error) {
      // Mantem o evento nao processado para nova tentativa no proximo ciclo.
    }
  }

  if (processedIds.length > 0) {
    await supabase
      .from("marketplace_events")
      .update({ processed_at: new Date().toISOString() })
      .in("id", processedIds);
  }

  return jsonResponse({
    ok: true,
    processed: processedIds.length,
    orders_synced: ordersSynced
  });
});
