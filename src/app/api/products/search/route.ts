import { NextResponse } from "next/server";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { searchProducts } from "@/lib/analytics";
import type { ProductSearchResult } from "@/lib/analytics";

const MOCK_PRODUCTS: ProductSearchResult[] = [
  { sku: "4200000734", product_name: "SNICKERS BAR 1.86OZ", brand: "MARS", category: "Candy" },
  { sku: "4200000735", product_name: "SNICKERS KING SIZE 3.29OZ", brand: "MARS", category: "Candy" },
  { sku: "4200000736", product_name: "SNICKERS ALMOND 1.76OZ", brand: "MARS", category: "Candy" },
];

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json([]);
  if (!hasSupabaseAdminEnv()) return NextResponse.json(MOCK_PRODUCTS);
  try {
    const results = await searchProducts(q);
    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
