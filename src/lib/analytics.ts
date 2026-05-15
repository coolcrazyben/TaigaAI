import { demoSummary } from "@/lib/mock-data";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardFilters = {
  storeId?: string;
  startDate?: string;
  endDate?: string;
};

export type DashboardSummary = typeof demoSummary;

export async function getDashboardSummary(filters: DashboardFilters = {}): Promise<DashboardSummary> {
  if (!hasSupabaseAdminEnv()) {
    return demoSummary;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("dashboard_summary", {
    p_store_id: filters.storeId || null,
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
  });

  if (error) {
    console.error("dashboard_summary failed", error);
    return demoSummary;
  }

  return data as DashboardSummary;
}
