import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDashboardSummary } from "@/lib/analytics";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_DB = {
  content: [{ type: "text" as const, text: "Error: Database not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY." }],
  isError: true,
};

function dbError(msg: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

export function registerAllTools(server: McpServer) {
  // 1. list_stores
  server.tool("list_stores", "List all Prince Oil stores with their IDs and names", async () => {
    if (!hasSupabaseAdminEnv()) return NO_DB;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("stores")
      .select("store_id, store_name")
      .order("store_name");

    if (error) return dbError(error.message);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // 2. get_dashboard_summary
  server.tool(
    "get_dashboard_summary",
    "Get KPIs, sales trends, top products, and category performance for one or all stores",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    },
    async ({ storeId, startDate, endDate }) => {
      try {
        const summary = await getDashboardSummary({ storeId, startDate, endDate });
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (e) {
        return dbError((e as Error).message);
      }
    }
  );

  // 3. get_top_products
  server.tool(
    "get_top_products",
    "Get top products ranked by sales or margin",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      limit: z.number().int().min(1).max(50).optional().describe("Number of products to return (default 10)"),
      orderBy: z.enum(["sales", "margin", "units"]).optional().describe("Sort order (default: sales)"),
      dateRange: z.string().optional().describe("Month key e.g. '2026-05' or full range '2026-05-01 to 2026-05-31'. Omit for all-time data."),
    },
    async ({ storeId, limit = 10, orderBy = "sales", dateRange }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const colMap: Record<string, string> = {
        sales: "total_sales_amount",
        margin: "total_margin_dollars",
        units: "units_sold",
      };

      const supabase = createAdminClient();
      let query = supabase
        .from("merchandise_product")
        .select("sku, product_name, store_id, date_range, total_sales_amount, total_margin_dollars, units_sold")
        .order(colMap[orderBy], { ascending: false })
        .limit(limit);

      if (storeId) query = query.eq("store_id", storeId);
      if (dateRange) query = query.ilike("date_range", `${dateRange}%`);

      const { data, error } = await query;
      if (error) return dbError(error.message);

      const ranges = [...new Set((data ?? []).map((r) => (r as Record<string, unknown>).date_range).filter(Boolean))].sort();
      const meta = {
        data_covers: ranges.length > 0 ? `${ranges[0]} to ${ranges[ranges.length - 1]}` : "unknown",
        date_ranges_included: ranges,
      };
      return { content: [{ type: "text", text: JSON.stringify({ meta, data }, null, 2) }] };
    }
  );

  // 4. get_category_performance
  server.tool(
    "get_category_performance",
    "Get sales and margin breakdown by product category",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      dateRange: z.string().optional().describe("Month key e.g. '2026-05' or full range '2026-05-01 to 2026-05-31'. Omit for all-time data."),
    },
    async ({ storeId, dateRange }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("merchandise_product")
        .select("category, date_range, total_sales_amount, total_margin_dollars")
        .limit(500);

      if (storeId) query = query.eq("store_id", storeId);
      if (dateRange) query = query.ilike("date_range", `${dateRange}%`);

      const { data, error } = await query;
      if (error) return dbError(error.message);

      // Aggregate by category in JS (no GROUP BY in Supabase JS client)
      const catMap: Record<string, { sales: number; margin: number }> = {};
      const allRanges = new Set<string>();
      for (const r of data ?? []) {
        const cat = (r as Record<string, unknown>).category as string ?? "Uncategorized";
        if (!catMap[cat]) catMap[cat] = { sales: 0, margin: 0 };
        catMap[cat].sales += Number((r as Record<string, unknown>).total_sales_amount ?? 0);
        catMap[cat].margin += Number((r as Record<string, unknown>).total_margin_dollars ?? 0);
        const dr = (r as Record<string, unknown>).date_range as string;
        if (dr) allRanges.add(dr);
      }
      const result = Object.entries(catMap)
        .map(([category_name, { sales, margin }]) => ({
          category_name,
          sales,
          margin,
          margin_pct: sales > 0 ? Math.round((margin / sales) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.sales - a.sales);

      const ranges = [...allRanges].sort();
      const meta = {
        data_covers: ranges.length > 0 ? `${ranges[0]} to ${ranges[ranges.length - 1]}` : "unknown",
        date_ranges_included: ranges,
      };
      return { content: [{ type: "text", text: JSON.stringify({ meta, result }, null, 2) }] };
    }
  );

  // 5. get_negative_margin_items
  server.tool(
    "get_negative_margin_items",
    "Get products that are losing money (negative margin) — potential pricing fixes",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      limit: z.number().int().min(1).max(100).optional().describe("Max items to return (default 25)"),
      dateRange: z.string().optional().describe("Month key e.g. '2026-05' or full range '2026-05-01 to 2026-05-31'. Omit for all-time data."),
    },
    async ({ storeId, limit = 25, dateRange }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("merchandise_product")
        .select("sku, product_name, store_id, date_range, total_sales_amount, total_margin_dollars, total_margin")
        .lt("total_margin_dollars", 0)
        .order("total_margin_dollars", { ascending: true })
        .limit(limit);

      if (storeId) query = query.eq("store_id", storeId);
      if (dateRange) query = query.ilike("date_range", `${dateRange}%`);

      const { data, error } = await query;
      if (error) return dbError(error.message);

      const ranges = [...new Set((data ?? []).map((r) => (r as Record<string, unknown>).date_range).filter(Boolean))].sort() as string[];
      const meta = {
        data_covers: ranges.length > 0 ? `${ranges[0]} to ${ranges[ranges.length - 1]}` : "unknown",
        date_ranges_included: ranges,
      };
      return { content: [{ type: "text", text: JSON.stringify({ meta, data }, null, 2) }] };
    }
  );

  // 6. get_data_info
  server.tool(
    "get_data_info",
    "Get metadata about what data is available: date ranges, stores, and coverage. Call this first if you don't know what period the data covers.",
    {},
    async () => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();

      const [txResult, dailyResult, merchResult] = await Promise.all([
        supabase.from("transaction_summary").select("date_range").order("date_range", { ascending: true }),
        supabase.from("transaction_daily").select("business_date").order("business_date", { ascending: true }),
        supabase.from("merchandise_product").select("date_range").order("date_range", { ascending: true }),
      ]);

      const txRanges = [...new Set((txResult.data ?? []).map((r) => r.date_range).filter(Boolean))].sort() as string[];
      const dailyDates = (dailyResult.data ?? []).map((r) => r.business_date).filter(Boolean).sort() as string[];
      const merchRanges = [...new Set((merchResult.data ?? []).map((r) => (r as Record<string, unknown>).date_range).filter(Boolean))].sort() as string[];

      const summary = {
        transaction_summary: {
          earliest: txRanges[0] ?? null,
          latest: txRanges[txRanges.length - 1] ?? null,
          total_months: txRanges.length,
          all_date_ranges: txRanges,
        },
        transaction_daily: {
          earliest_date: dailyDates[0] ?? null,
          latest_date: dailyDates[dailyDates.length - 1] ?? null,
          total_days: dailyDates.length,
        },
        merchandise_product: {
          earliest: merchRanges[0] ?? null,
          latest: merchRanges[merchRanges.length - 1] ?? null,
          total_months: merchRanges.length,
          all_date_ranges: merchRanges,
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // 7. get_network_averages — queries the network_averages VIEW (not an RPC)
  server.tool(
    "get_network_averages",
    "Get network-wide benchmark averages across all Prince Oil stores",
    {
      dateRange: z.string().optional().describe("Date range string to filter e.g. '2026-05-01 to 2026-05-31'"),
    },
    async ({ dateRange }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase.from("network_averages").select("*").limit(12);
      if (dateRange) query = query.eq("date_range", dateRange);

      const { data, error } = await query;
      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // 8. get_fuel_summary
  server.tool(
    "get_fuel_summary",
    "Get fuel sales KPIs per store: gallons pumped, fuel sales dollars, fuel transactions, fuel margin, and fuel retail/cost per gallon",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      dateRange: z.string().optional().describe("Month key e.g. '2026-05' or full range '2026-05-01 to 2026-05-31'"),
    },
    async ({ storeId, dateRange }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("transaction_summary")
        .select(
          "store_id, date_range, gallons_pumped, fuel_sales, fuel_transactions, " +
          "fuel_retail, listed_fuel_retail, fuel_cost, fuel_margin, listed_fuel_margin, " +
          "inside_fuel_sales, outside_fuel_sales, inside_fuel_transactions, " +
          "outside_fuel_transactions, inside_only_fuel_transactions, outside_only_fuel_transactions, " +
          "total_fuel_actual_retail, total_fuel_listed_retail"
        )
        .order("date_range", { ascending: false })
        .limit(50);

      if (storeId) query = query.eq("store_id", storeId);
      if (dateRange) query = query.ilike("date_range", `${dateRange}%`);

      const { data, error } = await query;
      if (error) return dbError(error.message);

      // Compute cents-per-gallon labels where data is available
      const enriched = (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>;
        return {
          ...row,
          fuel_margin_cpp: row.fuel_margin ? `$${Number(row.fuel_margin).toFixed(4)}/gal` : null,
          fuel_retail_cpp: row.fuel_retail ? `$${Number(row.fuel_retail).toFixed(4)}/gal` : null,
          fuel_cost_cpp: row.fuel_cost ? `$${Number(row.fuel_cost).toFixed(4)}/gal` : null,
        };
      });

      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  // 9. get_fuel_daily_trend
  server.tool(
    "get_fuel_daily_trend",
    "Get daily fuel volume and sales trends across stores — useful for spotting day-of-week patterns or traffic drops",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD"),
      limit: z.number().int().min(1).max(365).optional().describe("Number of days to return (default 30)"),
    },
    async ({ storeId, startDate, endDate, limit = 30 }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("transaction_daily")
        .select(
          "store_id, business_date, gallons_pumped, fuel_sales, fuel_transactions, " +
          "fuel_retail, fuel_cost, fuel_margin, inside_fuel_sales, outside_fuel_sales"
        )
        .order("business_date", { ascending: false })
        .limit(limit);

      if (storeId) query = query.eq("store_id", storeId);
      if (startDate) query = query.gte("business_date", startDate);
      if (endDate) query = query.lte("business_date", endDate);

      const { data, error } = await query;
      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
    }
  );

  // 10. get_sku_price_history
  server.tool(
    "get_sku_price_history",
    "Get month-over-month implied unit price and cost history for a SKU, with period-over-period change deltas. Useful for tracking price trends and detecting price changes.",
    {
      sku: z.string().describe("The SKU to look up"),
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
    },
    async ({ sku, storeId }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("sku_price_history")
        .select(
          "sku, product_name, brand, category, store_id, date_range, period_start, " +
          "units_sold, total_sales_amount, implied_unit_retail, implied_unit_cost, " +
          "prev_retail, retail_change, cost_change"
        )
        .eq("sku", sku)
        .order("period_start", { ascending: true })
        .order("store_id", { ascending: true });

      if (storeId) query = query.eq("store_id", storeId);

      const { data, error } = await query;
      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
    }
  );

  // 11. simulate_price_change
  server.tool(
    "simulate_price_change",
    "Simulate the impact of a price change on a product — forecasts unit volume, sales, and margin using price elasticity",
    {
      store: z.string().describe("Store name or ID"),
      product: z.string().describe("Product name or SKU"),
      priceIncrease: z.number().describe("Price increase in dollars (use negative for decrease)"),
    },
    async ({ store, product, priceIncrease }) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/simulate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store, product, priceIncrease }),
        }
      );

      if (!res.ok) {
        return dbError(`Simulation request failed: ${res.statusText}`);
      }

      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
