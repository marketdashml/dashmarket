import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, readEnv } from "../_shared/ml-client.ts";

type SyncAllRequest = {
  organization_id?: string;
  marketplace_account_id?: string;
  days_back?: number;
};

type AccountRow = { id: string; organization_id: string };

// Ordem importa: listings primeiro (cria produtos e vinculos), depois orders
// e inventory (que dependem dos listings), por fim advertising.
const RESOURCE_FUNCTIONS = [
  "mercadolivre-sync-listings",
  "mercadolivre-sync-orders",
  "mercadolivre-sync-inventory",
  "mercadolivre-sync-advertising"
] as const;

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
  const body = (await request.json().catch(() => ({}))) as SyncAllRequest;
  const daysBack = body.days_back ?? 30;

  // Resolve as contas a sincronizar.
  let query = supabase
    .from("marketplace_accounts")
    .select("id, organization_id")
    .eq("provider", "mercadolivre")
    .eq("status", "connected");

  if (body.marketplace_account_id) {
    query = query.eq("id", body.marketplace_account_id);
  } else if (body.organization_id) {
    query = query.eq("organization_id", body.organization_id);
  }

  const { data: accounts } = await query;
  const rows = (accounts ?? []) as AccountRow[];

  if (rows.length === 0) {
    return jsonResponse({ ok: true, accounts: [], note: "Nenhuma conta conectada." });
  }

  const functionBase = `${env.supabaseUrl}/functions/v1`;
  const authHeaders = {
    authorization: `Bearer ${env.serviceRoleKey}`,
    apikey: env.serviceRoleKey,
    "content-type": "application/json"
  };

  const summary: Record<string, unknown>[] = [];

  for (const account of rows) {
    const accountResult: Record<string, unknown> = {
      account_id: account.id,
      resources: {}
    };
    const resources = accountResult.resources as Record<string, unknown>;

    for (const fn of RESOURCE_FUNCTIONS) {
      try {
        const response = await fetch(`${functionBase}/${fn}`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            marketplace_account_id: account.id,
            organization_id: account.organization_id,
            days_back: daysBack
          })
        });
        resources[fn] = await response.json();
      } catch (error) {
        resources[fn] = { error: String(error) };
      }
    }

    // Recalcula snapshots de margem de contribuicao para a organizacao.
    try {
      const { error } = await supabase.rpc("refresh_contribution_margins", {
        target_organization_id: account.organization_id,
        period_days: daysBack
      });
      resources["margin_snapshots"] = error ? { error: error.message } : { ok: true };
    } catch (error) {
      resources["margin_snapshots"] = { error: String(error) };
    }

    summary.push(accountResult);
  }

  return jsonResponse({ ok: true, accounts: summary });
});
