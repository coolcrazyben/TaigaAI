import { NextResponse } from "next/server";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { getProductDashboardData } from "@/lib/analytics";
import type { ProductDashboardData } from "@/lib/analytics";

const MOCK_DASHBOARD: ProductDashboardData = {
  period: "2026-01",
  availablePeriods: ["2026-01", "2025-12", "2025-11"],
  categories: [
    { name: "Candy", count: 45 },
    { name: "Other Tobacco/Nicotine Products", count: 38 },
    { name: "Foodservice Prepared Onsite", count: 22 },
    { name: "Health & Beauty Care", count: 18 },
    { name: "Snacks", count: 31 },
  ],
  products: [
    { sku: "4200000734", product_name: "SNICKERS BAR 1.86OZ", category: "Candy", brand: "MARS", min_price: 1.49, max_price: 2.29, spread: 0.80, avg_price: 1.89, store_count: 7, total_units_sold: 842 },
    { sku: "4200000201", product_name: "MARLBORO RED BOX", category: "Other Tobacco/Nicotine Products", brand: "MARLBORO", min_price: 7.99, max_price: 9.49, spread: 1.50, avg_price: 8.74, store_count: 9, total_units_sold: 2310 },
    { sku: "6900000112", product_name: "MONSTER ENERGY 16OZ", category: "Beverages", brand: "MONSTER", min_price: 2.49, max_price: 3.29, spread: 0.80, avg_price: 2.89, store_count: 11, total_units_sold: 1450 },
    { sku: "4200000412", product_name: "REESES PEANUT BUTTER CUP", category: "Candy", brand: "HERSHEY", min_price: 1.29, max_price: 1.79, spread: 0.50, avg_price: 1.54, store_count: 6, total_units_sold: 612 },
    { sku: "5200000089", product_name: "DORITOS NACHO 2.75OZ", category: "Snacks", brand: "FRITO LAY", min_price: 1.69, max_price: 2.19, spread: 0.50, avg_price: 1.94, store_count: 8, total_units_sold: 980 },
  ],
};

export async function GET(request: Request) {
  const period = (new URL(request.url).searchParams.get("period") ?? "").trim();
  if (!hasSupabaseAdminEnv()) return NextResponse.json(MOCK_DASHBOARD);
  try {
    const data = await getProductDashboardData(period);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
