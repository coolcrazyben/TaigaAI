import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  store: z.string().min(1),
  product: z.string().min(1),
  priceIncrease: z.number().finite(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid simulation request" }, { status: 400 });

  if (!hasSupabaseAdminEnv()) {
    const currentUnits = 47180;
    const currentPrice = 3.86;
    const currentCost = 3.01;
    const elasticity = -0.8;
    const pctChange = parsed.data.priceIncrease / currentPrice;
    const projectedUnitDeclinePct = Math.abs(elasticity * pctChange * 100);
    const projectedUnits = currentUnits * (1 - projectedUnitDeclinePct / 100);
    const projectedSales = projectedUnits * (currentPrice + parsed.data.priceIncrease);
    const projectedMargin = projectedUnits * (currentPrice + parsed.data.priceIncrease - currentCost);

    return NextResponse.json({
      product: parsed.data.product,
      store: parsed.data.store,
      current_units: currentUnits,
      current_sales: currentUnits * currentPrice,
      current_margin: currentUnits * (currentPrice - currentCost),
      current_margin_pct: ((currentPrice - currentCost) / currentPrice) * 100,
      projected_units: projectedUnits,
      projected_sales: projectedSales,
      projected_margin: projectedMargin,
      projected_margin_pct: (projectedMargin / projectedSales) * 100,
      elasticity,
      projected_unit_decline_pct: projectedUnitDeclinePct,
    });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("simulate_price_change", {
    p_store: parsed.data.store,
    p_product: parsed.data.product,
    p_price_increase: parsed.data.priceIncrease,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
