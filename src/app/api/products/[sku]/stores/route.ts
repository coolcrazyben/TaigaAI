import { NextResponse } from "next/server";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { getProductStoreComparison } from "@/lib/analytics";
import type { ProductStoreComparison } from "@/lib/analytics";

const MOCK_COMPARISON: ProductStoreComparison = {
  rows: [
    { store_id: "newton_junction", store_name: "Newton Junction", sku: "4200000734", product_name: "SNICKERS BAR 1.86OZ", date_range: "2026-01", implied_unit_retail: 1.99, implied_unit_cost: 1.12, total_margin: 0.4372, total_margin_dollars: 0.87, units_sold: 142 },
    { store_id: "main_street_junction", store_name: "Main Street Junction", sku: "4200000734", product_name: "SNICKERS BAR 1.86OZ", date_range: "2026-01", implied_unit_retail: 2.09, implied_unit_cost: 1.12, total_margin: 0.4641, total_margin_dollars: 0.97, units_sold: 98 },
    { store_id: "scooba_junction", store_name: "Scooba Junction", sku: "4200000734", product_name: "SNICKERS BAR 1.86OZ", date_range: "2026-01", implied_unit_retail: 1.89, implied_unit_cost: 1.12, total_margin: 0.4074, total_margin_dollars: 0.77, units_sold: 203 },
  ],
  availablePeriods: ["2026-01", "2025-12", "2025-11", "2025-10"],
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sku: string }> }
) {
  const { sku } = await params;
  const period = (new URL(request.url).searchParams.get("period") ?? "").trim();
  if (!sku || !period) {
    return NextResponse.json({ error: "sku and period are required" }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) return NextResponse.json(MOCK_COMPARISON);
  try {
    const data = await getProductStoreComparison(sku, period);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
