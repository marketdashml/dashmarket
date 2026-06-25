"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

export type MarginSnapshot = {
  period_end: string;
  sku: string;
  title: string;
  contribution_margin_percent: number;
};

type ChartPoint = {
  date: string;
  [sku: string]: string | number;
};

const LINE_COLORS = [
  "#0d9488", // teal-600
  "#65a30d", // lime-600
  "#d97706", // amber-600
  "#dc2626", // red-600
  "#7c3aed", // violet-600
  "#0284c7", // sky-600
  "#db2777"  // pink-600
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function percentLabel(value: unknown): string {
  if (typeof value !== "number") return "";
  return `${(value * 100).toFixed(1)}%`;
}

type Props = {
  snapshots: MarginSnapshot[];
};

export function MarginHistoryChart({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-sm text-black/40">
        Nenhum snapshot de margem encontrado para o período.
        <br />
        Clique em Sincronizar para gerar.
      </div>
    );
  }

  // Coleta SKUs únicos (até 7 para não poluir o gráfico).
  const skus = [...new Set(snapshots.map((s) => s.sku))].slice(0, 7);

  // Agrupa por data → { date, sku1: pct, sku2: pct, ... }
  const byDate = new Map<string, ChartPoint>();
  for (const snap of snapshots) {
    if (!skus.includes(snap.sku)) continue;
    const date = formatDate(snap.period_end);
    if (!byDate.has(date)) byDate.set(date, { date });
    byDate.get(date)![snap.sku] = snap.contribution_margin_percent;
  }

  const data: ChartPoint[] = [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  // Mapeia SKU → título curto para a legenda.
  const skuTitle: Record<string, string> = {};
  for (const snap of snapshots) {
    if (!skuTitle[snap.sku]) {
      skuTitle[snap.sku] = snap.title.length > 28
        ? snap.title.slice(0, 27) + "…"
        : snap.title;
    }
  }

  return (
    <ResponsiveContainer height={280} width="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          formatter={(value: unknown, name: unknown) => [
            percentLabel(value),
            typeof name === "string" ? (skuTitle[name] ?? name) : String(name)
          ]}
          contentStyle={{
            fontSize: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)"
          }}
        />
        <Legend
          formatter={(value) => skuTitle[value] ?? value}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        {skus.map((sku, i) => (
          <Line
            key={sku}
            dataKey={sku}
            dot={data.length <= 14}
            name={sku}
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={2}
            type="monotone"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
