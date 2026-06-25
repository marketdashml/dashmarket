"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Boxes,
  Cable,
  CircleDollarSign,
  ClipboardList,
  LineChart,
  LogOut,
  Megaphone,
  PackageCheck,
  PackagePlus,
  Percent,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  WalletCards
} from "lucide-react";
import {
  calculateContributionMargins,
  type AdvertisingSpend,
  type ContributionMarginRow,
  type SaleRecord,
  type SkuCost
} from "@/lib/metrics/contribution-margin";
import {
  MarginHistoryChart,
  type MarginSnapshot
} from "@/components/dashboard/MarginHistoryChart";
import { getMarketplaceAdapter, listMarketplaceAdapters } from "@/lib/marketplaces/registry";
import type { MarketplaceProvider } from "@/lib/marketplaces/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ViewKey = "margem" | "custos" | "estoque" | "ads";
type SupabaseStatus = "checking" | "demo" | "connected" | "error";

type Organization = {
  id: string;
  name: string;
  slug: string;
};

type ProductRow = {
  id: string;
  internal_sku: string;
  title: string;
};

type CostCenterRow = {
  id: string;
  cost_name: string;
  cost_category: SkuCost["category"];
  allocation_method: SkuCost["allocation"];
  amount: number | string;
  valid_from: string;
  valid_to: string | null;
  products: ProductRow | ProductRow[] | null;
};

const salesSeed: SaleRecord[] = [
  {
    sku: "MLB-CABO-USB-C-1M",
    title: "Cabo USB-C turbo 1m",
    units: 184,
    orders: 129,
    grossRevenue: 10120,
    marketplaceFees: 1540,
    shippingCosts: 680,
    discounts: 320,
    taxes: 0
  },
  {
    sku: "MLB-CAPA-AIR-13",
    title: "Capa notebook Air 13",
    units: 76,
    orders: 61,
    grossRevenue: 11856,
    marketplaceFees: 1864,
    shippingCosts: 510,
    discounts: 420,
    taxes: 0
  },
  {
    sku: "MLB-SUPORTE-MESA-PRO",
    title: "Suporte articulado de mesa",
    units: 43,
    orders: 39,
    grossRevenue: 16770,
    marketplaceFees: 2732,
    shippingCosts: 940,
    discounts: 680,
    taxes: 0
  },
  {
    sku: "MLB-FONE-BT-COMPACT",
    title: "Fone bluetooth compacto",
    units: 112,
    orders: 97,
    grossRevenue: 14224,
    marketplaceFees: 2218,
    shippingCosts: 795,
    discounts: 530,
    taxes: 0
  }
];

const costsSeed: SkuCost[] = [
  {
    id: "cost-1",
    sku: "MLB-CABO-USB-C-1M",
    label: "Fornecedor",
    category: "product",
    amount: 18.9,
    allocation: "per_unit",
    validFrom: "2026-05-01"
  },
  {
    id: "cost-2",
    sku: "MLB-CABO-USB-C-1M",
    label: "Embalagem",
    category: "packaging",
    amount: 1.25,
    allocation: "per_unit",
    validFrom: "2026-05-01"
  },
  {
    id: "cost-3",
    sku: "MLB-CAPA-AIR-13",
    label: "Fornecedor",
    category: "product",
    amount: 72.4,
    allocation: "per_unit",
    validFrom: "2026-05-01"
  },
  {
    id: "cost-4",
    sku: "MLB-SUPORTE-MESA-PRO",
    label: "Fornecedor",
    category: "product",
    amount: 184,
    allocation: "per_unit",
    validFrom: "2026-05-01"
  },
  {
    id: "cost-5",
    sku: "MLB-FONE-BT-COMPACT",
    label: "Fornecedor",
    category: "product",
    amount: 48.7,
    allocation: "per_unit",
    validFrom: "2026-05-01"
  }
];

const adSpendSeed: AdvertisingSpend[] = [
  {
    sku: "MLB-CABO-USB-C-1M",
    amount: 870,
    clicks: 2480,
    impressions: 81400,
    attributedRevenue: 4480
  },
  {
    sku: "MLB-CAPA-AIR-13",
    amount: 420,
    clicks: 1114,
    impressions: 35600,
    attributedRevenue: 2910
  },
  {
    sku: "MLB-SUPORTE-MESA-PRO",
    amount: 980,
    clicks: 1560,
    impressions: 42200,
    attributedRevenue: 6200
  },
  {
    sku: "MLB-FONE-BT-COMPACT",
    amount: 740,
    clicks: 2030,
    impressions: 61500,
    attributedRevenue: 3890
  }
];

type InventoryRow = {
  sku: string;
  channel: string;
  available: number;
  reserved: number;
  transfer: number;
  status: string;
};

const inventoryRows: InventoryRow[] = [
  {
    sku: "MLB-CABO-USB-C-1M",
    channel: "Full",
    available: 420,
    reserved: 36,
    transfer: 280,
    status: "Saudavel"
  },
  {
    sku: "MLB-CAPA-AIR-13",
    channel: "Full",
    available: 96,
    reserved: 12,
    transfer: 40,
    status: "Atencao"
  },
  {
    sku: "MLB-SUPORTE-MESA-PRO",
    channel: "Full",
    available: 31,
    reserved: 8,
    transfer: 20,
    status: "Critico"
  },
  {
    sku: "MLB-FONE-BT-COMPACT",
    channel: "Flex",
    available: 188,
    reserved: 19,
    transfer: 0,
    status: "Saudavel"
  }
];

const promotionRows = [
  {
    sku: "MLB-CABO-USB-C-1M",
    name: "Oferta relampago",
    discount: "8%",
    period: "12 a 14 mai",
    impact: "Boa margem"
  },
  {
    sku: "MLB-SUPORTE-MESA-PRO",
    name: "Campanha marketplace",
    discount: "R$ 24,00",
    period: "10 a 18 mai",
    impact: "Revisar custo"
  }
];

const costCategoryLabel: Record<SkuCost["category"], string> = {
  product: "Produto",
  packaging: "Embalagem",
  inbound_freight: "Frete entrada",
  tax: "Tributo",
  marketplace_fixed: "Taxa fixa",
  other: "Outro"
};

const allocationLabel: Record<SkuCost["allocation"], string> = {
  per_unit: "Por unidade",
  percentage: "Percentual",
  per_order: "Por pedido"
};

const views: Array<{ key: ViewKey; label: string; icon: typeof BarChart3 }> = [
  { key: "margem", label: "Margem", icon: BarChart3 },
  { key: "custos", label: "Centro de custos", icon: WalletCards },
  { key: "estoque", label: "Estoque Full", icon: Boxes },
  { key: "ads", label: "Publicidade", icon: Megaphone }
];

const formatCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const formatNumber = new Intl.NumberFormat("pt-BR");

function formatPercent(value: number) {
  return `${(value * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  })}%`;
}

function statusClass(status: string) {
  if (status === "Critico") return "bg-rose-50 text-berry ring-rose-200";
  if (status === "Atencao") return "bg-amber-50 text-clay ring-amber-200";
  return "bg-emerald-50 text-sea ring-emerald-200";
}

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "sea"
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof BarChart3;
  tone?: "sea" | "moss" | "clay" | "berry";
}) {
  const toneClass = {
    sea: "bg-teal-50 text-sea ring-teal-100",
    moss: "bg-lime-50 text-moss ring-lime-100",
    clay: "bg-amber-50 text-clay ring-amber-100",
    berry: "bg-rose-50 text-berry ring-rose-100"
  }[tone];

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-black/50">
            {title}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-normal text-ink">{value}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-lg ring-1 ${toneClass}`}>
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-sm text-black/60">{detail}</p>
    </section>
  );
}

function ModuleButton({
  view,
  activeView,
  onClick
}: {
  view: (typeof views)[number];
  activeView: ViewKey;
  onClick: (view: ViewKey) => void;
}) {
  const Icon = view.icon;

  return (
    <button
      className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 transition ${
        activeView === view.key
          ? "bg-ink text-white ring-ink"
          : "bg-white text-ink ring-black/10 hover:bg-black/[0.03]"
      }`}
      onClick={() => onClick(view.key)}
      type="button"
    >
      <Icon aria-hidden className="h-4 w-4" />
      <span>{view.label}</span>
    </button>
  );
}

function marginTone(row: ContributionMarginRow) {
  if (row.contributionMarginRate < 0.12) return "text-berry";
  if (row.contributionMarginRate < 0.22) return "text-clay";
  return "text-sea";
}

function getRelatedProduct(row: CostCenterRow) {
  if (Array.isArray(row.products)) return row.products[0] ?? null;
  return row.products;
}

function mapCostCenterRow(row: CostCenterRow): SkuCost | null {
  const product = getRelatedProduct(row);
  if (!product) return null;

  return {
    id: row.id,
    sku: product.internal_sku,
    label: row.cost_name,
    category: row.cost_category,
    amount: Number(row.amount),
    allocation: row.allocation_method,
    validFrom: row.valid_from,
    validTo: row.valid_to ?? undefined
  };
}

export function DashmarketDashboard() {
  const [supabaseClient] = useState(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  });
  const [selectedProvider, setSelectedProvider] =
    useState<MarketplaceProvider>("mercadolivre");
  const [activeView, setActiveView] = useState<ViewKey>("margem");
  const [skuFilter, setSkuFilter] = useState("");
  const [costs, setCosts] = useState<SkuCost[]>(costsSeed);
  const [salesData, setSalesData] = useState<SaleRecord[]>(salesSeed);
  const [inventoryData, setInventoryData] =
    useState<InventoryRow[]>(inventoryRows);
  const [adsData, setAdsData] = useState<AdvertisingSpend[]>(adSpendSeed);
  const [marginSnapshots, setMarginSnapshots] = useState<MarginSnapshot[]>([]);
  const [marginPeriod, setMarginPeriod] = useState<30 | 60 | 90>(90);
  const [isSyncing, setIsSyncing] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [supabaseStatus, setSupabaseStatus] =
    useState<SupabaseStatus>("checking");
  const [realProducts, setRealProducts] = useState<ProductRow[]>([]);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [isSavingCost, setIsSavingCost] = useState(false);
  const [costForm, setCostForm] = useState({
    sku: salesSeed[0]?.sku ?? "",
    label: "",
    category: "product" as SkuCost["category"],
    amount: "",
    allocation: "per_unit" as SkuCost["allocation"],
    validFrom: "2026-05-01"
  });

  const productOptions = useMemo(
    () =>
      realProducts.length > 0
        ? realProducts.map((product) => ({
            sku: product.internal_sku,
            title: product.title
          }))
        : salesData.map((sale) => ({ sku: sale.sku, title: sale.title })),
    [realProducts, salesData]
  );

  const selectedAdapter = getMarketplaceAdapter(selectedProvider);
  const marginRows = useMemo(
    () => calculateContributionMargins(salesData, costs, adsData),
    [salesData, costs, adsData]
  );

  const filteredMargins = marginRows.filter((row) => {
    const query = skuFilter.trim().toLowerCase();
    return (
      !query ||
      row.sku.toLowerCase().includes(query) ||
      row.title.toLowerCase().includes(query)
    );
  });

  const totals = marginRows.reduce(
    (acc, row) => ({
      grossRevenue: acc.grossRevenue + row.grossRevenue,
      netRevenue: acc.netRevenue + row.netRevenue,
      marketplaceFees: acc.marketplaceFees + row.marketplaceFees,
      shippingCosts: acc.shippingCosts + row.shippingCosts,
      discounts: acc.discounts + row.discounts,
      skuCosts: acc.skuCosts + row.skuCosts,
      advertisingCosts: acc.advertisingCosts + row.advertisingCosts,
      contributionMargin: acc.contributionMargin + row.contributionMargin,
      units: acc.units + row.units
    }),
    {
      grossRevenue: 0,
      netRevenue: 0,
      marketplaceFees: 0,
      shippingCosts: 0,
      discounts: 0,
      skuCosts: 0,
      advertisingCosts: 0,
      contributionMargin: 0,
      units: 0
    }
  );

  const marginRate =
    totals.netRevenue > 0 ? totals.contributionMargin / totals.netRevenue : 0;

  const loadSalesData = useCallback(async (organizationId: string) => {
    if (!supabaseClient) return;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Filtra na tabela principal (orders) e expande os itens via join.
    // Filtros em tabelas relacionadas via !inner são ignorados pelo Supabase JS.
    const { data: orders } = await supabaseClient
      .from("orders")
      .select(
        "shipping_cost_amount, discounts_amount, taxes_amount, gross_amount, order_items(seller_sku, title, quantity, gross_amount, marketplace_fee_amount, shipping_cost_amount, discount_amount)"
      )
      .eq("organization_id", organizationId)
      .gte("sold_at", thirtyDaysAgo)
      .neq("status", "cancelled");

    if (!orders || orders.length === 0) return;

    type OrderRow = {
      shipping_cost_amount: number;
      discounts_amount: number;
      taxes_amount: number;
      gross_amount: number;
      order_items: {
        seller_sku: string | null;
        title: string;
        quantity: number;
        gross_amount: number;
        marketplace_fee_amount: number;
        shipping_cost_amount: number;
        discount_amount: number;
      }[];
    };

    const grouped = new Map<string, SaleRecord>();

    for (const order of orders as unknown as OrderRow[]) {
      for (const item of order.order_items ?? []) {
        const sku = item.seller_sku ?? item.title;

        // Rateia frete e desconto do pedido proporcionalmente ao valor bruto do item.
        const ratio =
          order.gross_amount > 0 ? item.gross_amount / order.gross_amount : 0;
        const shippingAlloc = order.shipping_cost_amount * ratio;
        const discountAlloc = order.discounts_amount * ratio;
        const taxAlloc = order.taxes_amount * ratio;

        const existing = grouped.get(sku);
        if (existing) {
          existing.units += item.quantity;
          existing.orders += 1;
          existing.grossRevenue += item.gross_amount;
          existing.marketplaceFees += item.marketplace_fee_amount;
          existing.shippingCosts += shippingAlloc;
          existing.discounts += discountAlloc;
          existing.taxes += taxAlloc;
        } else {
          grouped.set(sku, {
            sku,
            title: item.title,
            units: item.quantity,
            orders: 1,
            grossRevenue: item.gross_amount,
            marketplaceFees: item.marketplace_fee_amount,
            shippingCosts: shippingAlloc,
            discounts: discountAlloc,
            taxes: taxAlloc
          });
        }
      }
    }

    const records = Array.from(grouped.values());
    if (records.length > 0) {
      setSalesData(records);
    }
  }, [supabaseClient]);

  const loadInventory = useCallback(async (organizationId: string) => {
    if (!supabaseClient) return;

    const { data } = await supabaseClient
      .from("inventory_snapshots")
      .select("seller_sku, fulfillment_channel, available_quantity, reserved_quantity, captured_at")
      .eq("organization_id", organizationId)
      .order("captured_at", { ascending: false })
      .limit(500);

    if (!data || data.length === 0) return;

    type SnapshotRow = {
      seller_sku: string | null;
      fulfillment_channel: string;
      available_quantity: number;
      reserved_quantity: number;
      captured_at: string;
    };

    // Mantem apenas o snapshot mais recente de cada sku+canal.
    const seen = new Set<string>();
    const rows: InventoryRow[] = [];

    for (const snap of data as SnapshotRow[]) {
      const sku = snap.seller_sku ?? "(sem SKU)";
      const key = `${sku}-${snap.fulfillment_channel}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const available = snap.available_quantity;
      const status =
        available <= 5 ? "Critico" : available <= 20 ? "Atencao" : "Saudavel";

      rows.push({
        sku,
        channel: snap.fulfillment_channel,
        available,
        reserved: snap.reserved_quantity,
        transfer: 0,
        status
      });
    }

    if (rows.length > 0) setInventoryData(rows);
  }, [supabaseClient]);

  const loadAds = useCallback(async (organizationId: string) => {
    if (!supabaseClient) return;

    const { data } = await supabaseClient
      .from("advertising_metrics")
      .select(
        "ad_spend_amount, clicks, impressions, attributed_revenue_amount, metric_date, advertising_campaigns!inner(name, organization_id)"
      )
      .eq("organization_id", organizationId)
      .order("metric_date", { ascending: false })
      .limit(200);

    if (!data || data.length === 0) return;

    type MetricRow = {
      ad_spend_amount: number;
      clicks: number;
      impressions: number;
      attributed_revenue_amount: number;
      advertising_campaigns: { name: string } | { name: string }[];
    };

    const rows: AdvertisingSpend[] = (data as MetricRow[]).map((row) => {
      const campaign = Array.isArray(row.advertising_campaigns)
        ? row.advertising_campaigns[0]
        : row.advertising_campaigns;
      return {
        sku: campaign?.name ?? "Campanha",
        amount: row.ad_spend_amount,
        clicks: row.clicks,
        impressions: row.impressions,
        attributedRevenue: row.attributed_revenue_amount
      };
    });

    if (rows.length > 0) setAdsData(rows);
  }, [supabaseClient]);

  const loadMarginHistory = useCallback(
    async (organizationId: string, days: number) => {
      if (!supabaseClient) return;

      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const { data } = await supabaseClient
        .from("contribution_margin_snapshots")
        .select(
          "period_end, contribution_margin_percent, products!inner(internal_sku, title)"
        )
        .eq("organization_id", organizationId)
        .gte("period_end", from)
        .order("period_end", { ascending: true });

      if (!data || data.length === 0) return;

      type RawRow = {
        period_end: string;
        contribution_margin_percent: number | null;
        products: { internal_sku: string; title: string } | { internal_sku: string; title: string }[];
      };

      const snaps: MarginSnapshot[] = (data as RawRow[]).map((row) => {
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        return {
          period_end: row.period_end,
          sku: product?.internal_sku ?? "—",
          title: product?.title ?? "—",
          contribution_margin_percent: row.contribution_margin_percent ?? 0
        };
      });

      setMarginSnapshots(snaps);
    },
    [supabaseClient]
  );

  const loadCostCenter = useCallback(async (organizationId: string) => {
    if (!supabaseClient) return;

    const { data: productsData, error: productsError } = await supabaseClient
      .from("products")
      .select("id, internal_sku, title")
      .eq("organization_id", organizationId)
      .order("internal_sku", { ascending: true });

    if (productsError) throw productsError;

    const products = (productsData ?? []) as ProductRow[];
    setRealProducts(products);

    const { data: costsData, error: costsError } = await supabaseClient
      .from("sku_costs")
      .select(
        "id, cost_name, cost_category, allocation_method, amount, valid_from, valid_to, products(id, internal_sku, title)"
      )
      .eq("organization_id", organizationId)
      .order("valid_from", { ascending: false });

    if (costsError) throw costsError;

    const mappedCosts = ((costsData ?? []) as CostCenterRow[])
      .map(mapCostCenterRow)
      .filter((cost): cost is SkuCost => Boolean(cost));

    setCosts(mappedCosts);
  }, [supabaseClient]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspace() {
      if (!supabaseClient) {
        setSupabaseStatus("demo");
        setCosts(costsSeed);
        return;
      }

      try {
        const { data: sessionData, error: sessionError } =
          await supabaseClient.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (!session) {
          if (!isMounted) return;
          setSupabaseStatus("demo");
          setUserEmail(null);
          setOrganization(null);
          setRealProducts([]);
          setCosts(costsSeed);
          return;
        }

        const { data: organizationsData, error: organizationsError } =
          await supabaseClient
            .from("organizations")
            .select("id, name, slug")
            .order("created_at", { ascending: true })
            .limit(1);

        if (organizationsError) throw organizationsError;

        const currentOrganization =
          ((organizationsData ?? [])[0] as Organization | undefined) ?? null;

        if (!isMounted) return;

        setUserEmail(session.user.email ?? null);
        setOrganization(currentOrganization);
        setSupabaseStatus("connected");

        if (currentOrganization) {
          await Promise.all([
            loadCostCenter(currentOrganization.id),
            loadSalesData(currentOrganization.id),
            loadInventory(currentOrganization.id),
            loadAds(currentOrganization.id),
            loadMarginHistory(currentOrganization.id, 90)
          ]);
        } else {
          setCosts([]);
          setDataMessage("Usuario autenticado, mas sem empresa vinculada.");
        }
      } catch (error) {
        if (!isMounted) return;
        setSupabaseStatus("error");
        setCosts(costsSeed);
        setDataMessage(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar os dados do Supabase."
        );
      }
    }

    loadWorkspace();

    return () => {
      isMounted = false;
    };
  }, [loadCostCenter, loadSalesData, loadInventory, loadAds, loadMarginHistory, supabaseClient]);

  async function addCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!costForm.label.trim() || !costForm.amount) return;

    if (supabaseClient && organization) {
      setIsSavingCost(true);
      setDataMessage(null);

      try {
        let product = realProducts.find(
          (currentProduct) => currentProduct.internal_sku === costForm.sku
        );

        if (!product) {
          const seedProduct = salesSeed.find((sale) => sale.sku === costForm.sku);
          const { data: insertedProduct, error: productError } =
            await supabaseClient
              .from("products")
              .insert({
                organization_id: organization.id,
                internal_sku: costForm.sku,
                title: seedProduct?.title ?? costForm.sku
              })
              .select("id, internal_sku, title")
              .single();

          if (productError) throw productError;
          product = insertedProduct as ProductRow;
        }

        const { error: costError } = await supabaseClient.from("sku_costs").insert({
          organization_id: organization.id,
          product_id: product.id,
          cost_name: costForm.label.trim(),
          cost_category: costForm.category,
          allocation_method: costForm.allocation,
          amount: Number(costForm.amount),
          valid_from: costForm.validFrom
        });

        if (costError) throw costError;

        await loadCostCenter(organization.id);
        setCostForm((current) => ({ ...current, label: "", amount: "" }));
        setDataMessage("Custo salvo no Supabase.");
      } catch (error) {
        setDataMessage(
          error instanceof Error
            ? error.message
            : "Nao foi possivel salvar o custo."
        );
      } finally {
        setIsSavingCost(false);
      }

      return;
    }

    setCosts((current) => [
      ...current,
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `cost-${Date.now()}`,
        sku: costForm.sku,
        label: costForm.label.trim(),
        category: costForm.category,
        amount: Number(costForm.amount),
        allocation: costForm.allocation,
        validFrom: costForm.validFrom
      }
    ]);

    setCostForm((current) => ({ ...current, label: "", amount: "" }));
  }

  useEffect(() => {
    if (organization && supabaseStatus === "connected") {
      loadMarginHistory(organization.id, marginPeriod);
    }
  }, [marginPeriod, organization, supabaseStatus, loadMarginHistory]);

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    setSupabaseStatus("demo");
    setUserEmail(null);
    setOrganization(null);
    setRealProducts([]);
    setCosts(costsSeed);
    setSalesData(salesSeed);
    setInventoryData(inventoryRows);
    setAdsData(adSpendSeed);
    setDataMessage("Sessao encerrada.");
  }

  async function syncOrders() {
    if (!supabaseClient || supabaseStatus !== "connected") return;

    setIsSyncing(true);
    setDataMessage(null);

    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("Sessao expirada.");

      const response = await fetch("/api/marketplaces/mercadolivre/sync", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ days_back: 30 })
      });

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        accounts?: {
          resources?: Record<string, { records_processed?: number }>;
        }[];
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Erro ao sincronizar.");
      }

      const orders =
        result.accounts?.reduce(
          (sum, account) =>
            sum +
            (account.resources?.["mercadolivre-sync-orders"]?.records_processed ?? 0),
          0
        ) ?? 0;

      if (organization) {
        await Promise.all([
          loadSalesData(organization.id),
          loadInventory(organization.id),
          loadAds(organization.id)
        ]);
      }

      setDataMessage(
        `Sincronizacao concluida. ${orders} pedido(s) processado(s).`
      );
    } catch (error) {
      setDataMessage(
        error instanceof Error ? error.message : "Erro ao sincronizar vendas."
      );
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-black/10 bg-ink px-4 py-4 text-white lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-sm font-black text-ink">
                  DM
                </span>
                <div>
                  <p className="text-lg font-black tracking-normal">DASHMARKET</p>
                  <p className="text-xs text-white/60">Marketplace intelligence</p>
                </div>
              </div>
            </div>
            {supabaseStatus === "connected" ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/20 lg:mt-6"
                onClick={signOut}
                type="button"
              >
                <LogOut aria-hidden className="h-4 w-4" />
                Sair
              </button>
            ) : (
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/20 lg:mt-6"
                href="/login"
              >
                <ShieldCheck aria-hidden className="h-4 w-4" />
                Entrar
              </Link>
            )}
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {views.map((view) => {
              const Icon = view.icon;
              return (
                <button
                  className={`flex h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition ${
                    activeView === view.key
                      ? "bg-white text-ink"
                      : "bg-white/10 text-white/70 hover:bg-white/20"
                  }`}
                  key={view.key}
                  onClick={() => setActiveView(view.key)}
                  type="button"
                >
                  <Icon aria-hidden className="h-4 w-4" />
                  {view.label}
                </button>
              );
            })}
          </nav>

          <section className="mt-6 rounded-lg border border-white/10 bg-white/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cable aria-hidden className="h-4 w-4 text-teal-200" />
              Conector ativo
            </div>
            <p className="mt-3 text-2xl font-semibold">{selectedAdapter.displayName}</p>
            <p className="mt-1 text-sm text-white/60">
              Estrutura pronta para multiplos marketplaces.
            </p>
            <div className="mt-4 rounded-lg bg-black/15 p-3 text-xs text-white/72">
              <p className="font-bold text-white">
                {organization?.name ?? "Modo demonstrativo"}
              </p>
              <p className="mt-1">
                {userEmail ??
                  (supabaseStatus === "checking"
                    ? "Verificando sessao"
                    : "Entre para gravar custos reais")}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedAdapter.capabilities.map((capability) => (
                <span
                  className="rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-white/80"
                  key={capability}
                >
                  {capability}
                </span>
              ))}
            </div>
          </section>
        </aside>

        <section className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-black/10 pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-normal text-black/50">
                Visao operacional
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-normal text-ink sm:text-4xl">
                Margem, estoque e crescimento por SKU
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex rounded-lg bg-white p-1 ring-1 ring-black/10">
                {listMarketplaceAdapters().slice(0, 3).map((adapter) => (
                  <button
                    className={`h-9 rounded-md px-3 text-sm font-semibold ${
                      selectedProvider === adapter.provider
                        ? "bg-ink text-white"
                        : "text-black/60 hover:bg-black/[0.04]"
                    }`}
                    key={adapter.provider}
                    onClick={() => setSelectedProvider(adapter.provider)}
                    type="button"
                  >
                    {adapter.displayName}
                  </button>
                ))}
              </div>
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-sea px-4 text-sm font-bold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
                disabled={isSyncing || supabaseStatus !== "connected"}
                onClick={syncOrders}
                type="button"
              >
                <RefreshCw
                  aria-hidden
                  className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
                />
                {isSyncing ? "Sincronizando..." : "Sincronizar"}
              </button>
            </div>
          </header>

          <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              detail={`${formatNumber.format(totals.units)} unidades vendidas no periodo`}
              icon={CircleDollarSign}
              title="Receita liquida"
              value={formatCurrency.format(totals.netRevenue)}
            />
            <KpiCard
              detail={`${formatPercent(marginRate)} sobre a receita liquida`}
              icon={Percent}
              title="Margem contribuicao"
              tone={marginRate < 0.18 ? "clay" : "moss"}
              value={formatCurrency.format(totals.contributionMargin)}
            />
            <KpiCard
              detail="Inclui produto, embalagem e custos por SKU"
              icon={WalletCards}
              title="Custos cadastrados"
              tone="clay"
              value={formatCurrency.format(totals.skuCosts)}
            />
            <KpiCard
              detail="Investimento atribuido aos SKUs vendidos"
              icon={Megaphone}
              title="Publicidade"
              tone="berry"
              value={formatCurrency.format(totals.advertisingCosts)}
            />
          </section>

          <section className="mt-5 rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {views.map((view) => (
                  <ModuleButton
                    activeView={activeView}
                    key={view.key}
                    onClick={setActiveView}
                    view={view}
                  />
                ))}
              </div>
              <label className="relative block min-w-0 sm:w-80">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40"
                />
                <input
                  className="h-10 w-full rounded-lg border border-black/10 bg-paper pl-9 pr-3 text-sm outline-none ring-sea/25 placeholder:text-black/40 focus:ring-4"
                  onChange={(event) => setSkuFilter(event.target.value)}
                  placeholder="Buscar SKU ou produto"
                  value={skuFilter}
                />
              </label>
            </div>
          </section>

          {(dataMessage || supabaseStatus === "connected") && (
            <section className="mt-4 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm shadow-sm">
              <p className="font-semibold text-ink">
                {supabaseStatus === "connected"
                  ? `Supabase conectado${organization ? `: ${organization.name}` : ""}`
                  : "Modo demonstrativo"}
              </p>
              <p className="mt-1 text-black/60">
                {dataMessage ??
                  "Custos cadastrados nesta tela ja sao salvos no banco. Vendas, estoque e publicidade seguem demonstrativos ate conectarmos o Mercado Livre."}
              </p>
            </section>
          )}

          {activeView === "margem" && (
            <>
            <section className="mt-5 rounded-lg border border-black/10 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Evolução da margem de contribuição</h2>
                  <p className="text-sm text-black/60">
                    Percentual de margem por SKU ao longo do tempo.
                  </p>
                </div>
                <div className="flex rounded-lg bg-paper p-1 ring-1 ring-black/10">
                  {([30, 60, 90] as const).map((days) => (
                    <button
                      className={`h-8 rounded-md px-3 text-sm font-semibold transition ${
                        marginPeriod === days
                          ? "bg-ink text-white"
                          : "text-black/60 hover:bg-black/[0.04]"
                      }`}
                      key={days}
                      onClick={() => setMarginPeriod(days)}
                      type="button"
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                <MarginHistoryChart snapshots={marginSnapshots} />
              </div>
            </section>

            <section className="mt-4 rounded-lg border border-black/10 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Conciliação da margem por SKU</h2>
                  <p className="text-sm text-black/60">
                    Receita, taxas, frete, custos internos e publicidade no mesmo lugar.
                  </p>
                </div>
                <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-sea ring-1 ring-emerald-100">
                  <PackageCheck aria-hidden className="h-4 w-4" />
                  Base preparada para conciliar pedidos
                </span>
              </div>
              <div className="table-scroll overflow-x-auto">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="bg-black/[0.025] text-xs uppercase tracking-normal text-black/50">
                    <tr>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Receita liquida</th>
                      <th className="px-4 py-3">Taxas</th>
                      <th className="px-4 py-3">Frete</th>
                      <th className="px-4 py-3">Custo SKU</th>
                      <th className="px-4 py-3">Ads</th>
                      <th className="px-4 py-3">Margem</th>
                      <th className="px-4 py-3">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {filteredMargins.map((row) => (
                      <tr className="hover:bg-black/[0.018]" key={row.sku}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-ink">{row.sku}</p>
                          <p className="text-xs text-black/50">{row.title}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {formatCurrency.format(row.netRevenue)}
                        </td>
                        <td className="px-4 py-3 text-black/60">
                          {formatCurrency.format(row.marketplaceFees)}
                        </td>
                        <td className="px-4 py-3 text-black/60">
                          {formatCurrency.format(row.shippingCosts)}
                        </td>
                        <td className="px-4 py-3 text-black/60">
                          {formatCurrency.format(row.skuCosts)}
                        </td>
                        <td className="px-4 py-3 text-black/60">
                          {formatCurrency.format(row.advertisingCosts)}
                        </td>
                        <td className={`px-4 py-3 font-bold ${marginTone(row)}`}>
                          {formatCurrency.format(row.contributionMargin)}
                        </td>
                        <td className={`px-4 py-3 font-bold ${marginTone(row)}`}>
                          {formatPercent(row.contributionMarginRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            </>
          )}

          {activeView === "custos" && (
            <section className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
              <form
                className="rounded-lg border border-black/10 bg-white p-4 shadow-sm"
                onSubmit={addCost}
              >
                <div className="flex items-center gap-2">
                  <PackagePlus aria-hidden className="h-5 w-5 text-sea" />
                  <h2 className="text-lg font-bold">Cadastrar custo do SKU</h2>
                </div>

                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-sm font-semibold">
                    SKU
                    <select
                      className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                      onChange={(event) =>
                        setCostForm((current) => ({
                          ...current,
                          sku: event.target.value
                        }))
                      }
                      value={costForm.sku}
                    >
                      {productOptions.map((product) => (
                        <option key={product.sku} value={product.sku}>
                          {product.sku}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-normal text-black/50">
                      {supabaseStatus === "connected"
                        ? "Se o SKU ainda nao existir, ele sera criado no Supabase."
                        : "Entre para salvar este cadastro no banco."}
                    </span>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold">
                    Nome do custo
                    <input
                      className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                      onChange={(event) =>
                        setCostForm((current) => ({
                          ...current,
                          label: event.target.value
                        }))
                      }
                      placeholder="Fornecedor, embalagem, imposto"
                      value={costForm.label}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-sm font-semibold">
                      Categoria
                      <select
                        className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            category: event.target.value as SkuCost["category"]
                          }))
                        }
                        value={costForm.category}
                      >
                        {Object.entries(costCategoryLabel).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1 text-sm font-semibold">
                      Alocação
                      <select
                        className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            allocation: event.target.value as SkuCost["allocation"]
                          }))
                        }
                        value={costForm.allocation}
                      >
                        {Object.entries(allocationLabel).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-sm font-semibold">
                      Valor
                      <input
                        className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                        min="0"
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            amount: event.target.value
                          }))
                        }
                        placeholder="0,00"
                        step="0.01"
                        type="number"
                        value={costForm.amount}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold">
                      Vigencia
                      <input
                        className="h-10 rounded-lg border border-black/10 bg-paper px-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            validFrom: event.target.value
                          }))
                        }
                        type="date"
                        value={costForm.validFrom}
                      />
                    </label>
                  </div>

                  <button
                    className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-bold text-white hover:bg-black"
                    disabled={isSavingCost}
                    type="submit"
                  >
                    <PackagePlus aria-hidden className="h-4 w-4" />
                    {isSavingCost ? "Salvando" : "Adicionar custo"}
                  </button>
                </div>
              </form>

              <section className="rounded-lg border border-black/10 bg-white shadow-sm">
                <div className="border-b border-black/10 p-4">
                  <h2 className="text-lg font-bold">Custos ativos</h2>
                  <p className="text-sm text-black/60">
                    Cada lançamento entra no cálculo de margem respeitando SKU e vigência.
                  </p>
                </div>
                <div className="table-scroll overflow-x-auto">
                  <table className="min-w-[780px] w-full text-left text-sm">
                    <thead className="bg-black/[0.025] text-xs uppercase tracking-normal text-black/50">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Custo</th>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3">Alocação</th>
                        <th className="px-4 py-3">Valor</th>
                        <th className="px-4 py-3">Desde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/10">
                      {costs.map((cost) => (
                        <tr key={cost.id}>
                          <td className="px-4 py-3 font-bold">{cost.sku}</td>
                          <td className="px-4 py-3">{cost.label}</td>
                          <td className="px-4 py-3">
                            {costCategoryLabel[cost.category]}
                          </td>
                          <td className="px-4 py-3">{allocationLabel[cost.allocation]}</td>
                          <td className="px-4 py-3 font-semibold">
                            {cost.allocation === "percentage"
                              ? `${cost.amount}%`
                              : formatCurrency.format(cost.amount)}
                          </td>
                          <td className="px-4 py-3">{cost.validFrom}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}

          {activeView === "estoque" && (
            <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
              <section className="rounded-lg border border-black/10 bg-white shadow-sm">
                <div className="border-b border-black/10 p-4">
                  <h2 className="text-lg font-bold">Estoque por canal de envio</h2>
                  <p className="text-sm text-black/60">
                    Pronto para receber snapshots do Full e demais modalidades.
                  </p>
                </div>
                <div className="table-scroll overflow-x-auto">
                  <table className="min-w-[780px] w-full text-left text-sm">
                    <thead className="bg-black/[0.025] text-xs uppercase tracking-normal text-black/50">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Canal</th>
                        <th className="px-4 py-3">Disponivel</th>
                        <th className="px-4 py-3">Reservado</th>
                        <th className="px-4 py-3">Em transferencia</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/10">
                      {inventoryData.map((row) => (
                        <tr key={`${row.sku}-${row.channel}`}>
                          <td className="px-4 py-3 font-bold">{row.sku}</td>
                          <td className="px-4 py-3">{row.channel}</td>
                          <td className="px-4 py-3">{formatNumber.format(row.available)}</td>
                          <td className="px-4 py-3">{formatNumber.format(row.reserved)}</td>
                          <td className="px-4 py-3">{formatNumber.format(row.transfer)}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ring-1 ${statusClass(row.status)}`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <ClipboardList aria-hidden className="h-5 w-5 text-sea" />
                  <h2 className="text-lg font-bold">Fila de sincronização</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {["orders", "inventory", "listings", "promotions"].map((item, index) => (
                    <div
                      className="flex items-center justify-between rounded-lg border border-black/10 bg-paper px-3 py-3"
                      key={item}
                    >
                      <span className="text-sm font-semibold">{item}</span>
                      <span className="text-xs font-bold text-black/50">
                        {index === 0 ? "15 min" : "1 h"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}

          {activeView === "ads" && (
            <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
              <section className="rounded-lg border border-black/10 bg-white shadow-sm">
                <div className="border-b border-black/10 p-4">
                  <h2 className="text-lg font-bold">Publicidade por SKU</h2>
                  <p className="text-sm text-black/60">
                    Investimento e receita atribuida entram na mesma conta de margem.
                  </p>
                </div>
                <div className="table-scroll overflow-x-auto">
                  <table className="min-w-[820px] w-full text-left text-sm">
                    <thead className="bg-black/[0.025] text-xs uppercase tracking-normal text-black/50">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Investimento</th>
                        <th className="px-4 py-3">Cliques</th>
                        <th className="px-4 py-3">Impressões</th>
                        <th className="px-4 py-3">Receita atribuida</th>
                        <th className="px-4 py-3">ACOS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/10">
                      {adsData.map((row) => (
                        <tr key={row.sku}>
                          <td className="px-4 py-3 font-bold">{row.sku}</td>
                          <td className="px-4 py-3">
                            {formatCurrency.format(row.amount)}
                          </td>
                          <td className="px-4 py-3">{formatNumber.format(row.clicks)}</td>
                          <td className="px-4 py-3">
                            {formatNumber.format(row.impressions)}
                          </td>
                          <td className="px-4 py-3">
                            {formatCurrency.format(row.attributedRevenue)}
                          </td>
                          <td className="px-4 py-3 font-bold">
                            {row.attributedRevenue > 0
                              ? formatPercent(row.amount / row.attributedRevenue)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Tags aria-hidden className="h-5 w-5 text-clay" />
                  <h2 className="text-lg font-bold">Promoções ativas</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {promotionRows.map((row) => (
                    <div
                      className="rounded-lg border border-black/10 bg-paper p-3"
                      key={`${row.sku}-${row.name}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{row.name}</p>
                          <p className="text-sm text-black/60">{row.sku}</p>
                        </div>
                        <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-clay ring-1 ring-amber-100">
                          {row.discount}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span>{row.period}</span>
                        <span className="font-semibold text-black/60">{row.impact}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}

          <footer className="mt-6 flex flex-col gap-2 pb-4 text-sm text-black/50 sm:flex-row sm:items-center sm:justify-between">
            <span>Dados demonstrativos enquanto o Supabase e Mercado Livre sao conectados.</span>
            <span className="inline-flex items-center gap-2">
              <LineChart aria-hidden className="h-4 w-4" />
              Preparado para historico e conciliacao por periodo
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}
