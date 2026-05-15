import { AppShell } from "@/components/app-shell";
import Link from "next/link";

const SERVER_URL =
  process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp`
    : "https://your-app.vercel.app/api/mcp";

const tools = [
  { name: "list_stores", description: "All Prince Oil locations with IDs" },
  { name: "get_dashboard_summary", description: "KPIs, trends, and category breakdown (filter by store/date)" },
  { name: "get_top_products", description: "Best-selling or highest-margin products" },
  { name: "get_category_performance", description: "Sales and margin by category" },
  { name: "get_negative_margin_items", description: "Products losing money — pricing opportunities" },
  { name: "get_network_averages", description: "Network-wide benchmark averages" },
  { name: "get_fuel_summary", description: "Fuel KPIs per store: gallons pumped, fuel sales, margin, retail/cost per gallon" },
  { name: "get_fuel_daily_trend", description: "Daily fuel volume and sales trends — spot day-of-week patterns" },
  { name: "simulate_price_change", description: "Forecast impact of a price change using elasticity" },
];

const examplePrompts = [
  "What stores do you have data on?",
  "Which store had the highest margin last month?",
  "Show me our top 5 products by sales.",
  "Are there any products losing money across the network?",
  "How many gallons did Newton Junction pump this month?",
  "Which store has the best fuel margin per gallon?",
  "What would happen if I raised Newport Special prices by $0.25?",
];

export default function Home() {
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Prince Oil Analytics MCP Server</h1>
          <p className="mt-2 text-green-200/70 text-sm leading-relaxed">
            Connect your Claude Desktop (or any MCP client) to this server to query store analytics,
            top products, margins, and pricing simulations — directly in your AI chat.
          </p>
        </div>

        {/* Step 1 */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-500">Step 1 — Server URL</h2>
          <div className="rounded-lg bg-[#0a1a0e] border border-green-900 px-4 py-3 font-mono text-sm text-green-300 select-all break-all">
            {SERVER_URL}
          </div>
        </section>

        {/* Step 2 */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-500">Step 2 — Claude Desktop Config</h2>
          <p className="text-xs text-green-200/60">
            Open <code className="text-green-300">claude_desktop_config.json</code> and add:
          </p>
          <pre className="rounded-lg bg-[#0a1a0e] border border-green-900 px-4 py-3 font-mono text-xs text-green-200 overflow-x-auto whitespace-pre-wrap">{`{
  "mcpServers": {
    "prince-oil": {
      "type": "http",
      "url": "${SERVER_URL}"
    }
  }
}`}</pre>
          <p className="text-xs text-green-200/50">
            Config file location:{" "}
            <span className="text-green-300">~/Library/Application Support/Claude/claude_desktop_config.json</span>{" "}
            (macOS) or{" "}
            <span className="text-green-300">%APPDATA%\Claude\claude_desktop_config.json</span> (Windows)
          </p>
        </section>

        {/* Step 3 */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-500">Step 3 — Ask Questions</h2>
          <p className="text-xs text-green-200/60">Restart Claude Desktop, then try:</p>
          <ul className="space-y-1">
            {examplePrompts.map((p) => (
              <li key={p} className="text-xs text-green-200/80 pl-3 border-l border-green-800">
                "{p}"
              </li>
            ))}
          </ul>
        </section>

        {/* Available tools */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-500">Available Tools</h2>
          <div className="divide-y divide-green-950 rounded-lg border border-green-900 overflow-hidden">
            {tools.map((t) => (
              <div key={t.name} className="px-4 py-2.5 bg-[#0a1a0e] flex gap-3">
                <code className="text-xs text-green-400 font-mono shrink-0 pt-0.5">{t.name}</code>
                <span className="text-xs text-green-200/60">{t.description}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Test with Inspector */}
        <section className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-500">Test Locally</h2>
          <pre className="rounded-lg bg-[#0a1a0e] border border-green-900 px-4 py-3 font-mono text-xs text-green-200">
            npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp
          </pre>
        </section>

        {/* Footer link */}
        <div className="pt-2 text-xs text-green-800">
          Need to ingest data?{" "}
          <Link href="/upload" className="text-green-600 hover:text-green-400 underline">
            Upload a CSV
          </Link>
          {" · "}
          <Link href="/data" className="text-green-600 hover:text-green-400 underline">
            View raw data
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
