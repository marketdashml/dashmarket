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
  days_back?: number;
};

type Advertiser = { advertiser_id: number; site_id: string; account_name?: string };
type AdvertisersResponse = { advertisers: Advertiser[] };

type Campaign = {
  id: number;
  name: string;
  status?: string;
  channel?: string;
  strategy?: string;
  budget?: number;
  acos_target?: number;
};
type CampaignsResponse = { results: Campaign[]; paging?: { total: number } };

type CampaignMetrics = {
  metrics?: {
    prints?: number;
    clicks?: number;
    cost?: number;
    direct_amount?: number;
    indirect_amount?: number;
    direct_units_quantity?: number;
    indirect_units_quantity?: number;
    acos?: number;
  };
};

const ADS_HEADERS = { "Api-Version": "1" };

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
    "advertising"
  );

  try {
    const client = await MercadoLivreClient.forAccount(
      supabase,
      env,
      body.marketplace_account_id
    );

    // 1. Descobre o(s) advertiser(s) de Product Ads. Conta sem ads => null.
    const advertisers = await client.tryGet<AdvertisersResponse>(
      "/advertising/advertisers?product_id=PADS",
      { headers: ADS_HEADERS }
    );

    if (!advertisers || (advertisers.advertisers ?? []).length === 0) {
      await run.finishSuccess(0, { note: "Conta sem Product Ads." });
      return jsonResponse({
        ok: true,
        resource: "advertising",
        records_processed: 0,
        note: "Conta sem Product Ads."
      });
    }

    const daysBack = body.days_back ?? 30;
    const dateTo = new Date().toISOString().slice(0, 10);
    const dateFrom = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    let processed = 0;

    for (const advertiser of advertisers.advertisers) {
      const campaignsResp = await client.tryGet<CampaignsResponse>(
        `/advertising/advertisers/${advertiser.advertiser_id}/product_ads/campaigns?limit=100&offset=0`,
        { headers: ADS_HEADERS }
      );

      const campaigns = campaignsResp?.results ?? [];

      for (const campaign of campaigns) {
        const { data: savedCampaign } = await supabase
          .from("advertising_campaigns")
          .upsert(
            {
              organization_id: body.organization_id,
              marketplace_account_id: body.marketplace_account_id,
              provider_campaign_id: String(campaign.id),
              name: campaign.name,
              campaign_type: campaign.strategy ?? campaign.channel ?? null,
              status: campaign.status ?? null,
              budget_amount: campaign.budget ?? null,
              daily_goal_amount: null,
              raw_payload: campaign
            },
            { onConflict: "marketplace_account_id,provider_campaign_id" }
          )
          .select("id")
          .single();

        // 2. Metricas agregadas da campanha no periodo.
        const metricsResp = await client.tryGet<CampaignMetrics>(
          `/advertising/product_ads/campaigns/${campaign.id}/metrics?date_from=${dateFrom}&date_to=${dateTo}`,
          { headers: ADS_HEADERS }
        );

        const m = metricsResp?.metrics;
        if (savedCampaign?.id && m) {
          const attributedRevenue = (m.direct_amount ?? 0) + (m.indirect_amount ?? 0);
          const attributedOrders =
            (m.direct_units_quantity ?? 0) + (m.indirect_units_quantity ?? 0);

          // product_id e nulo (metrica agregada por campanha); como NULL nao
          // dispara o unique constraint, garantimos idempotencia removendo a
          // metrica do dia antes de inserir.
          await supabase
            .from("advertising_metrics")
            .delete()
            .eq("campaign_id", savedCampaign.id)
            .is("product_id", null)
            .eq("metric_date", dateTo);

          await supabase.from("advertising_metrics").insert({
            organization_id: body.organization_id,
            campaign_id: savedCampaign.id,
            product_id: null,
            metric_date: dateTo,
            impressions: Math.round(m.prints ?? 0),
            clicks: Math.round(m.clicks ?? 0),
            ad_spend_amount: m.cost ?? 0,
            attributed_revenue_amount: attributedRevenue,
            attributed_orders: Math.round(attributedOrders),
            acos: m.acos ?? null,
            raw_payload: metricsResp
          });
        }

        processed++;
      }
    }

    await run.finishSuccess(processed);
    return jsonResponse({
      ok: true,
      resource: "advertising",
      records_processed: processed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await run.finishFailed(message);
    return jsonResponse({ error: message }, 500);
  }
});
