"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

type SimulationResult = {
  product: string;
  store: string;
  current_units: number;
  current_sales: number;
  current_margin: number;
  current_margin_pct: number;
  projected_units: number;
  projected_sales: number;
  projected_margin: number;
  projected_margin_pct: number;
  elasticity: number;
  projected_unit_decline_pct: number;
};

export default function SimulatePage() {
  const [store, setStore] = useState("Newton Junction");
  const [product, setProduct] = useState("Newport Special");
  const [increase, setIncrease] = useState("0.20");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, product, priceIncrease: Number(increase) }),
    });
    setResult(await response.json());
    setLoading(false);
  }

  return (
    <AppShell>
      <div className="space-y-5 p-4 lg:p-8">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">Price simulation</p>
          <h1 className="mt-2 text-3xl font-semibold">Model retail price changes</h1>
        </div>

        <Card>
          <CardContent className="p-5">
            <form onSubmit={run} className="grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]">
              <Input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Store name" />
              <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product or SKU" />
              <Input value={increase} onChange={(e) => setIncrease(e.target.value)} type="number" step="0.01" />
              <Button disabled={loading}><Calculator size={16} /> Simulate</Button>
            </form>
          </CardContent>
        </Card>

        {result ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="Current sales" value={formatCurrency(result.current_sales)} />
            <Metric title="Projected sales" value={formatCurrency(result.projected_sales)} />
            <Metric title="Current margin" value={formatCurrency(result.current_margin)} />
            <Metric title="Projected margin" value={formatCurrency(result.projected_margin)} />
            <Metric title="Current margin %" value={formatPercent(result.current_margin_pct)} />
            <Metric title="Projected margin %" value={formatPercent(result.projected_margin_pct)} />
            <Metric title="Elasticity" value={result.elasticity.toFixed(2)} />
            <Metric title="Projected unit decline" value={formatPercent(result.projected_unit_decline_pct)} />
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wide text-slate-500">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
