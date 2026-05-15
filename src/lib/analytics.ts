import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardSummary = {
  kpis: {
    total_sales: number;
    total_margin: number;
    margin_pct: number;
    transaction_count: number;
    unit_count: number;
    negative_margin_skus: number;
  };
  salesTrend: { business_date: string; sales: number; margin: number }[];
  topProducts: { sku: string; product_name: string; sales: number; margin: number; units: number }[];
  categoryPerformance: { category_name: string; sales: number; margin: number; margin_pct: number }[];
  storeComparison: { store_name: string; sales: number; margin: number; margin_pct: number }[];
  negativeMarginSkus: { sku: string; product_name: string; sales: number; margin: number; margin_pct: number }[];
};

export type DashboardFilters = {
  storeId?: string;
  startDate?: string;
  endDate?: string;
};

export async function getDashboardSummary(filters: DashboardFilters = {}): Promise<DashboardSummary> {
  if (!hasSupabaseAdminEnv()) {
    throw new Error("Database not configured. Set SUPABASE_SERVICE_ROLE_KEY to connect.");
  }

  const supabase = createAdminClient();

  // KPIs — aggregate from transaction_summary (most recent period per store)
  let tsQuery = supabase
    .from("transaction_summary")
    .select("sales_total, total_margin, total_transactions, units_sold")
    .order("date_range", { ascending: false })
    .limit(11);
  if (filters.storeId) tsQuery = tsQuery.eq("store_id", filters.storeId);
  const { data: tsData, error: tsError } = await tsQuery;
  if (tsError) throw new Error(`KPI query failed: ${tsError.message}`);

  const totalSales = (tsData ?? []).reduce((s, r) => s + Number(r.sales_total ?? 0), 0);
  const totalMargin = (tsData ?? []).reduce((s, r) => s + Number(r.total_margin ?? 0), 0);

  // Sales trend from transaction_daily
  let trendQuery = supabase
    .from("transaction_daily")
    .select("business_date, sales_total, total_margin")
    .order("business_date", { ascending: false })
    .limit(30);
  if (filters.storeId) trendQuery = trendQuery.eq("store_id", filters.storeId);
  if (filters.startDate) trendQuery = trendQuery.gte("business_date", filters.startDate);
  if (filters.endDate) trendQuery = trendQuery.lte("business_date", filters.endDate);
  const { data: trendData } = await trendQuery;
  const salesTrend = (trendData ?? []).reverse().map((r) => ({
    business_date: r.business_date,
    sales: Number(r.sales_total ?? 0),
    margin: Number(r.total_margin ?? 0),
  }));

  // Top products from merchandise_product
  let mpQuery = supabase
    .from("merchandise_product")
    .select("sku, product_name, store_id, total_sales_amount, total_margin_dollars, units_sold")
    .order("total_sales_amount", { ascending: false })
    .limit(10);
  if (filters.storeId) mpQuery = mpQuery.eq("store_id", filters.storeId);
  const { data: mpData } = await mpQuery;
  const topProducts = (mpData ?? []).map((r) => ({
    sku: r.sku,
    product_name: r.product_name ?? r.sku,
    sales: Number(r.total_sales_amount ?? 0),
    margin: Number(r.total_margin_dollars ?? 0),
    units: Number(r.units_sold ?? 0),
  }));

  // Category performance — fetch and aggregate in JS (no GROUP BY in client)
  let catQuery = supabase
    .from("merchandise_product")
    .select("category, total_sales_amount, total_margin_dollars")
    .limit(500);
  if (filters.storeId) catQuery = catQuery.eq("store_id", filters.storeId);
  const { data: catData } = await catQuery;
  const catMap: Record<string, { sales: number; margin: number }> = {};
  for (const r of catData ?? []) {
    const cat = r.category ?? "Uncategorized";
    if (!catMap[cat]) catMap[cat] = { sales: 0, margin: 0 };
    catMap[cat].sales += Number(r.total_sales_amount ?? 0);
    catMap[cat].margin += Number(r.total_margin_dollars ?? 0);
  }
  const categoryPerformance = Object.entries(catMap)
    .map(([category_name, { sales, margin }]) => ({
      category_name,
      sales,
      margin,
      margin_pct: sales > 0 ? Math.round((margin / sales) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  // Store comparison from transaction_summary
  const { data: storeData } = await supabase
    .from("transaction_summary")
    .select("store_id, sales_total, total_margin")
    .order("sales_total", { ascending: false })
    .limit(11);
  const storeComparison = (storeData ?? []).map((r) => ({
    store_name: r.store_id,
    sales: Number(r.sales_total ?? 0),
    margin: Number(r.total_margin ?? 0),
    margin_pct:
      Number(r.sales_total) > 0
        ? Math.round((Number(r.total_margin) / Number(r.sales_total)) * 10000) / 100
        : 0,
  }));

  // Negative margin SKU count
  const { count: negCount } = await supabase
    .from("merchandise_product")
    .select("sku", { count: "exact", head: true })
    .lt("total_margin_dollars", 0);

  // Negative margin SKU list
  let negQuery = supabase
    .from("merchandise_product")
    .select("sku, product_name, total_sales_amount, total_margin_dollars, total_margin")
    .lt("total_margin_dollars", 0)
    .order("total_margin_dollars", { ascending: true })
    .limit(25);
  if (filters.storeId) negQuery = negQuery.eq("store_id", filters.storeId);
  const { data: negData } = await negQuery;
  const negativeMarginSkus = (negData ?? []).map((r) => ({
    sku: r.sku,
    product_name: r.product_name ?? r.sku,
    sales: Number(r.total_sales_amount ?? 0),
    margin: Number(r.total_margin_dollars ?? 0),
    margin_pct: Number(r.total_margin ?? 0),
  }));

  return {
    kpis: {
      total_sales: totalSales,
      total_margin: totalMargin,
      margin_pct: totalSales > 0 ? Math.round((totalMargin / totalSales) * 10000) / 100 : 0,
      transaction_count: (tsData ?? []).reduce((s, r) => s + Number(r.total_transactions ?? 0), 0),
      unit_count: (tsData ?? []).reduce((s, r) => s + Number(r.units_sold ?? 0), 0),
      negative_margin_skus: negCount ?? 0,
    },
    salesTrend,
    topProducts,
    categoryPerformance,
    storeComparison,
    negativeMarginSkus,
  };
}
