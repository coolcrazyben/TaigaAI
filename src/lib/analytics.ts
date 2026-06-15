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

export type ProductSearchResult = {
  sku: string;
  product_name: string | null;
  brand: string | null;
  category: string | null;
};

export async function searchProducts(q: string): Promise<ProductSearchResult[]> {
  if (q.trim().length < 2) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("merchandise_product")
    .select("sku, product_name, brand, category")
    .or(`product_name.ilike.%${q}%,sku.ilike.%${q}%`)
    .order("product_name", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Product search failed: ${error.message}`);
  const seen = new Map<string, ProductSearchResult>();
  for (const r of data ?? []) {
    if (!seen.has(r.sku)) seen.set(r.sku, { sku: r.sku, product_name: r.product_name, brand: r.brand, category: r.category });
  }
  return Array.from(seen.values()).slice(0, 25);
}

export type StoreComparisonRow = {
  store_id: string;
  store_name: string | null;
  sku: string;
  product_name: string | null;
  date_range: string;
  implied_unit_retail: number | null;
  implied_unit_cost: number | null;
  total_margin: number | null;
  total_margin_dollars: number | null;
  units_sold: number | null;
};

export type ProductStoreComparison = {
  rows: StoreComparisonRow[];
  availablePeriods: string[];
};

export async function getProductStoreComparison(sku: string, period: string): Promise<ProductStoreComparison> {
  const supabase = createAdminClient();
  const [rowsResult, periodsResult, storesResult] = await Promise.all([
    supabase
      .from("merchandise_product")
      .select("store_id, sku, product_name, date_range, implied_unit_retail, implied_unit_cost, total_margin, total_margin_dollars, units_sold")
      .eq("sku", sku)
      .eq("date_range", period)
      .order("store_id", { ascending: true }),
    supabase
      .from("merchandise_product")
      .select("date_range, period_start")
      .eq("sku", sku)
      .order("period_start", { ascending: false })
      .limit(36),
    supabase.from("stores").select("store_id, store_name"),
  ]);

  if (rowsResult.error) throw new Error(`Store comparison failed: ${rowsResult.error.message}`);

  const storeMap = new Map<string, string>();
  for (const s of storesResult.data ?? []) storeMap.set(s.store_id, s.store_name);

  const rows: StoreComparisonRow[] = (rowsResult.data ?? []).map((r) => ({
    store_id: r.store_id,
    store_name: storeMap.get(r.store_id) ?? r.store_id,
    sku: r.sku,
    product_name: r.product_name,
    date_range: r.date_range,
    implied_unit_retail: r.implied_unit_retail !== null ? Number(r.implied_unit_retail) : null,
    implied_unit_cost: r.implied_unit_cost !== null ? Number(r.implied_unit_cost) : null,
    total_margin: r.total_margin !== null ? Number(r.total_margin) : null,
    total_margin_dollars: r.total_margin_dollars !== null ? Number(r.total_margin_dollars) : null,
    units_sold: r.units_sold !== null ? Number(r.units_sold) : null,
  }));

  const seenPeriods = new Map<string, boolean>();
  const availablePeriods: string[] = [];
  for (const p of periodsResult.data ?? []) {
    if (!seenPeriods.has(p.date_range)) {
      seenPeriods.set(p.date_range, true);
      availablePeriods.push(p.date_range);
    }
  }

  return { rows, availablePeriods };
}

export type ProductDashboardRow = {
  sku: string;
  product_name: string | null;
  category: string | null;
  brand: string | null;
  min_price: number;
  max_price: number;
  spread: number;
  avg_price: number;
  store_count: number;
  total_units_sold: number;
};

export type ProductDashboardData = {
  products: ProductDashboardRow[];
  categories: { name: string; count: number }[];
  availablePeriods: string[];
  period: string;
};

export async function getProductDashboardData(period: string): Promise<ProductDashboardData> {
  const supabase = createAdminClient();

  // Fetch available periods first so we can auto-select most recent if needed
  const { data: periodsRaw } = await supabase
    .from("merchandise_product")
    .select("date_range, period_start")
    .order("period_start", { ascending: false })
    .limit(36);

  const seenPeriods = new Map<string, boolean>();
  const availablePeriods: string[] = [];
  for (const p of periodsRaw ?? []) {
    if (!seenPeriods.has(p.date_range)) {
      seenPeriods.set(p.date_range, true);
      availablePeriods.push(p.date_range);
    }
  }

  const activePeriod = period || availablePeriods[0] || "";

  if (!activePeriod) return { products: [], categories: [], availablePeriods, period: "" };

  const { data: rows, error } = await supabase
    .from("merchandise_product")
    .select("sku, product_name, category, brand, implied_unit_retail, units_sold")
    .eq("date_range", activePeriod)
    .not("implied_unit_retail", "is", null)
    .gt("units_sold", 0)
    .limit(10000);

  if (error) throw new Error(`Dashboard query failed: ${error.message}`);

  type Acc = {
    product_name: string | null;
    category: string | null;
    brand: string | null;
    prices: number[];
    total_units: number;
  };

  const bysku = new Map<string, Acc>();
  for (const r of rows ?? []) {
    if (!bysku.has(r.sku)) {
      bysku.set(r.sku, { product_name: r.product_name, category: r.category, brand: r.brand, prices: [], total_units: 0 });
    }
    const entry = bysku.get(r.sku)!;
    if (r.implied_unit_retail !== null) entry.prices.push(Number(r.implied_unit_retail));
    entry.total_units += Number(r.units_sold ?? 0);
  }

  const products: ProductDashboardRow[] = [];
  for (const [sku, e] of bysku) {
    if (e.prices.length === 0) continue;
    const min_price = Math.min(...e.prices);
    const max_price = Math.max(...e.prices);
    const spread = Math.round((max_price - min_price) * 100) / 100;
    const avg_price = Math.round((e.prices.reduce((s, p) => s + p, 0) / e.prices.length) * 100) / 100;
    products.push({
      sku,
      product_name: e.product_name,
      category: e.category,
      brand: e.brand,
      min_price,
      max_price,
      spread,
      avg_price,
      store_count: e.prices.length,
      total_units_sold: e.total_units,
    });
  }

  products.sort((a, b) => b.spread - a.spread);

  const catMap = new Map<string, number>();
  for (const p of products) {
    const cat = p.category ?? "Uncategorized";
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
  }
  const categories = Array.from(catMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { products, categories, availablePeriods, period: activePeriod };
}
