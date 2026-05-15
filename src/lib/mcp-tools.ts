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
      .select("id, name, store_identifier, region")
      .order("name");

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
    },
    async ({ storeId, limit = 10, orderBy = "sales" }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("merchandise_summary")
        .select("sku, product_name, store_id, sales, margin, units")
        .order(orderBy, { ascending: false })
        .limit(limit);

      if (storeId) query = query.eq("store_id", storeId);

      const { data, error } = await query;
      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // 4. get_category_performance
  server.tool(
    "get_category_performance",
    "Get sales and margin breakdown by product category",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    },
    async ({ storeId, startDate, endDate }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      const { data, error } = await supabase.rpc("category_performance", {
        p_store_id: storeId || null,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      });

      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // 5. get_negative_margin_items
  server.tool(
    "get_negative_margin_items",
    "Get products that are losing money (negative margin) — potential pricing fixes",
    {
      storeId: z.string().optional().describe("Store ID to filter (omit for all stores)"),
      limit: z.number().int().min(1).max(100).optional().describe("Max items to return (default 25)"),
    },
    async ({ storeId, limit = 25 }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      let query = supabase
        .from("merchandise_summary")
        .select("sku, product_name, store_id, sales, margin, margin_pct")
        .lt("margin", 0)
        .order("margin", { ascending: true })
        .limit(limit);

      if (storeId) query = query.eq("store_id", storeId);

      const { data, error } = await query;
      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // 6. get_network_averages
  server.tool(
    "get_network_averages",
    "Get network-wide benchmark averages across all Prince Oil stores",
    {
      startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    },
    async ({ startDate, endDate }) => {
      if (!hasSupabaseAdminEnv()) return NO_DB;

      const supabase = createAdminClient();
      const { data, error } = await supabase.rpc("network_averages", {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      });

      if (error) return dbError(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // 7. simulate_price_change
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
