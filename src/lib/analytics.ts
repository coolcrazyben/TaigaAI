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
  const { data, error } = await supabase.rpc("dashboard_summary", {
    p_store_id: filters.storeId || null,
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
  });

  if (error) {
    console.error("dashboard_summary RPC failed", error);
    throw new Error(`Dashboard query failed: ${error.message}`);
  }

  return data as DashboardSummary;
}
