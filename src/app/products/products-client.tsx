"use client";

import { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProductDashboardData, ProductDashboardRow, StoreComparisonRow } from "@/lib/analytics";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, prefix = "") {
  return prefix + n.toFixed(2);
}

function fmtPct(n: number | null) {
  if (n === null) return "—";
  const pct = n > 1 ? n : n * 100;
  return pct.toFixed(1) + "%";
}

function spreadClass(spread: number) {
  if (spread >= 1.0) return "text-red-400 font-semibold";
  if (spread >= 0.25) return "text-amber-400 font-semibold";
  return "text-slate-400";
}

// ─── inline per-store breakdown ─────────────────────────────────────────────

function StoreBreakdown({ sku, period }: { sku: string; period: string }) {
  const [rows, setRows] = useState<StoreComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/products/${encodeURIComponent(sku)}/stores?period=${encodeURIComponent(period)}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [sku, period]);

  if (loading) return <div className="px-6 py-4 text-sm text-slate-400">Loading store data…</div>;
  if (error) return <div className="px-6 py-4 text-sm text-red-400">{error}</div>;

  const prices = rows.map((r) => r.implied_unit_retail).filter((p): p is number => p !== null);
  const minP = prices.length > 1 ? Math.min(...prices) : null;
  const maxP = prices.length > 1 ? Math.max(...prices) : null;

  return (
    <div className="overflow-x-auto border-t border-slate-800/60 bg-slate-900/30">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="py-2 pl-10 pr-4 text-left font-medium uppercase tracking-wide text-slate-500">Store</th>
            <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-slate-500">Unit Price</th>
            <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-slate-500">Unit Cost</th>
            <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-slate-500">Margin %</th>
            <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-slate-500">Units Sold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/40">
          {rows.map((r) => {
            const isMin = r.implied_unit_retail !== null && r.implied_unit_retail === minP;
            const isMax = r.implied_unit_retail !== null && r.implied_unit_retail === maxP;
            return (
              <tr key={r.store_id} className="hover:bg-slate-800/20">
                <td className="py-2 pl-10 pr-4 text-slate-300">{r.store_name ?? r.store_id}</td>
                <td className={`px-4 py-2 text-right ${isMin ? "text-emerald-400 font-semibold" : isMax ? "text-amber-400 font-semibold" : "text-slate-300"}`}>
                  {r.implied_unit_retail !== null ? fmt(r.implied_unit_retail, "$") : "—"}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">{r.implied_unit_cost !== null ? fmt(r.implied_unit_cost, "$") : "—"}</td>
                <td className="px-4 py-2 text-right text-slate-400">{fmtPct(r.total_margin)}</td>
                <td className="px-4 py-2 text-right text-slate-400">{r.units_sold?.toLocaleString() ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {prices.length > 1 && (
        <div className="flex gap-4 border-t border-slate-800/40 px-10 py-2 text-xs text-slate-500">
          <span><span className="text-emerald-400">■</span> Lowest</span>
          <span><span className="text-amber-400">■</span> Highest</span>
        </div>
      )}
    </div>
  );
}

// ─── product row with inline expansion ──────────────────────────────────────

function ProductRow({ product, period, expanded, onToggle }: {
  product: ProductDashboardRow;
  period: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown size={13} className="flex-shrink-0 text-slate-500" />
              : <ChevronRight size={13} className="flex-shrink-0 text-slate-600" />}
            <div>
              <div className="text-sm text-slate-200">{product.product_name ?? product.sku}</div>
              <div className="text-xs text-slate-500">{product.sku}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-slate-400">{product.category ?? "—"}</td>
        <td className="px-4 py-3 text-right text-sm text-slate-300">{fmt(product.min_price, "$")}</td>
        <td className="px-4 py-3 text-right text-sm text-slate-300">{fmt(product.max_price, "$")}</td>
        <td className={`px-4 py-3 text-right text-sm ${spreadClass(product.spread)}`}>
          {product.spread > 0 ? fmt(product.spread, "+$") : "—"}
        </td>
        <td className="px-4 py-3 text-right text-xs text-slate-500">{product.store_count}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <StoreBreakdown sku={product.sku} period={period} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── main dashboard ──────────────────────────────────────────────────────────

export function ProductsClient() {
  const [data, setData] = useState<ProductDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const initialLoad = useRef(true);

  async function fetchDashboard(period = "") {
    setLoading(true);
    setError(null);
    setExpandedSku(null);
    try {
      const res = await fetch(`/api/products/dashboard${period ? `?period=${encodeURIComponent(period)}` : ""}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json as ProductDashboardData);
      if (initialLoad.current) {
        setSelectedPeriod(json.period ?? "");
        initialLoad.current = false;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDashboard(); }, []);

  function handlePeriodChange(p: string) {
    setSelectedPeriod(p);
    setSelectedCategory("");
    setSearchQuery("");
    fetchDashboard(p);
  }

  function toggleRow(sku: string) {
    setExpandedSku((prev) => (prev === sku ? null : sku));
  }

  // client-side filter
  const allProducts = data?.products ?? [];
  const filtered = allProducts.filter((p) => {
    const matchCat = !selectedCategory || (p.category ?? "Uncategorized") === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchQ = !q || (p.product_name ?? "").toLowerCase().includes(q) || p.sku.includes(q);
    return matchCat && matchQ;
  });

  const leaderboard = allProducts.filter((p) => p.spread > 0 && p.store_count >= 2).slice(0, 15);

  const totalProducts = allProducts.length;

  return (
    <AppShell>
      <div className="space-y-6 p-4 lg:p-8">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">Products</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">Price intelligence</h1>
            <p className="mt-1 text-sm text-slate-400">Spot pricing inconsistencies and browse products across all stores.</p>
          </div>
          {data && data.availablePeriods.length > 0 && (
            <select
              value={selectedPeriod}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {data.availablePeriods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {loading && (
          <div className="py-20 text-center text-sm text-slate-500">Loading product data…</div>
        )}

        {!loading && data && (
          <>
            {/* Biggest Price Gaps Leaderboard */}
            {leaderboard.length > 0 && (
              <Card className="bg-slate-950 border-slate-800">
                <CardHeader className="pb-0">
                  <CardTitle className="flex items-center justify-between">
                    <span>Biggest Price Gaps</span>
                    <span className="text-xs font-normal text-slate-500">Same product, different store prices</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 pt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800">
                          <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Product</th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Category</th>
                          <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Low</th>
                          <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500">High</th>
                          <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Gap</th>
                          <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Stores</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {leaderboard.map((p) => (
                          <tr
                            key={p.sku}
                            className="cursor-pointer hover:bg-slate-900/40 transition-colors"
                            onClick={() => {
                              setSelectedCategory(p.category ?? "");
                              setSearchQuery(p.product_name ?? p.sku);
                              setExpandedSku(p.sku);
                              document.getElementById("browse-section")?.scrollIntoView({ behavior: "smooth" });
                            }}
                          >
                            <td className="px-5 py-3">
                              <div className="text-slate-200">{p.product_name ?? p.sku}</div>
                              <div className="text-xs text-slate-500">{p.sku}</div>
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-400">{p.category ?? "—"}</td>
                            <td className="px-5 py-3 text-right text-emerald-400">{fmt(p.min_price, "$")}</td>
                            <td className="px-5 py-3 text-right text-amber-400">{fmt(p.max_price, "$")}</td>
                            <td className={`px-5 py-3 text-right ${spreadClass(p.spread)}`}>{fmt(p.spread, "+$")}</td>
                            <td className="px-5 py-3 text-right text-slate-500">{p.store_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Browse section */}
            <div id="browse-section" className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Browse by category</p>
              </div>

              {/* Category chips */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setSelectedCategory(""); setSearchQuery(""); }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    selectedCategory === ""
                      ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                  }`}
                >
                  All ({totalProducts.toLocaleString()})
                </button>
                {data.categories.map((cat) => (
                  <button
                    key={cat.name}
                    onClick={() => { setSelectedCategory(cat.name); setSearchQuery(""); setExpandedSku(null); }}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selectedCategory === cat.name
                        ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                        : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                    }`}
                  >
                    {cat.name} ({cat.count.toLocaleString()})
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-8"
                  placeholder="Search product name or SKU…"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setExpandedSku(null); }}
                />
              </div>

              {/* Product table */}
              <Card className="bg-slate-950 border-slate-800">
                <CardContent className="p-0">
                  {filtered.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-slate-500">No products found.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-800">
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Product</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Category</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Min Price</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Max Price</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Spread</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Stores</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((p) => (
                            <ProductRow
                              key={p.sku}
                              product={p}
                              period={selectedPeriod}
                              expanded={expandedSku === p.sku}
                              onToggle={() => toggleRow(p.sku)}
                            />
                          ))}
                        </tbody>
                      </table>
                      <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-600">
                        {filtered.length.toLocaleString()} product{filtered.length !== 1 ? "s" : ""}
                        {selectedCategory || searchQuery ? ` (filtered from ${totalProducts.toLocaleString()})` : ""}
                        {" · "}click any row to see per-store breakdown
                        {" · "}
                        <span className="text-red-400">red</span> = $1+ gap,{" "}
                        <span className="text-amber-400">amber</span> = $0.25–$1 gap
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
