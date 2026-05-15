"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, DollarSign, Package, Percent, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { compactNumber, formatCurrency, formatPercent } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/analytics";

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "emerald",
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: "emerald" | "amber" | "red";
}) {
  const color = tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : "text-emerald-400";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
        <Icon className={color} size={24} />
      </CardContent>
    </Card>
  );
}

export function Dashboard({ summary }: { summary: DashboardSummary }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">Convenience retail intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Store performance dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Analyze Taiga transaction exports through normalized SQL, aggregate tables, and AI-assisted retail diagnostics.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 md:text-right">
          <span>Store filter: All stores</span>
          <span>Date range: Loaded history</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total sales" value={formatCurrency(summary.kpis.total_sales)} icon={DollarSign} />
        <KpiCard label="Total margin" value={formatCurrency(summary.kpis.total_margin)} icon={ReceiptText} />
        <KpiCard label="Margin %" value={formatPercent(summary.kpis.margin_pct)} icon={Percent} />
        <KpiCard label="Units sold" value={compactNumber(summary.kpis.unit_count)} icon={Package} />
        <KpiCard label="Negative margin SKUs" value={`${summary.kpis.negative_margin_skus}`} icon={AlertTriangle} tone="red" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Sales and margin trend</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.salesTrend}>
                  <defs>
                    <linearGradient id="sales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="business_date" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={compactNumber} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                  <Area dataKey="sales" stroke="#22c55e" fill="url(#sales)" strokeWidth={2} />
                  <Area dataKey="margin" stroke="#38bdf8" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Store comparison</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.storeComparison} layout="vertical">
                  <CartesianGrid stroke="#1f2937" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={compactNumber} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="store_name" width={110} tick={{ fill: "#cbd5e1", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                  <Bar dataKey="sales" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="margin" fill="#38bdf8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TableCard title="Top products" rows={summary.topProducts} />
        <TableCard title="Category performance" rows={summary.categoryPerformance} />
        <TableCard title="Negative-margin SKUs" rows={summary.negativeMarginSkus} danger />
      </div>
    </div>
  );
}

function TableCard({ title, rows, danger = false }: { title: string; rows: Record<string, string | number>[]; danger?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-100">
                    {row.product_name ?? row.category_name ?? row.store_name}
                  </div>
                  <div className="text-xs text-slate-500">{row.sku ?? `${formatPercent(Number(row.margin_pct ?? 0))} margin`}</div>
                </div>
                <div className={danger ? "text-right text-sm text-red-400" : "text-right text-sm text-emerald-400"}>
                  {formatCurrency(Number(row.margin ?? 0))}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-400">Sales {formatCurrency(Number(row.sales ?? 0))}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
