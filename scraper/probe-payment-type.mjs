/**
 * Probe script to discover Taiga's payment type / tender type DataView and field names.
 *
 * Run: node scraper/probe-payment-type.mjs
 *
 * What it does:
 *  1. Authenticates via Playwright (same as the main scraper)
 *  2. Lists all consoles to find any payment/tender dashboard
 *  3. Tries DataView 113 / Widget 269 with various GroupBy field names
 *     (TenderType, PaymentType, PaymentMethod, CreditCardType, etc.)
 *  4. Lists all DataViews to find a dedicated payment type view
 *
 * Read the output to find which DataView ID, Widget ID, and field name to use
 * when adding paymentTypeSummaryBody() to scraper/index.js.
 */

import { chromium } from "playwright";
import dotenv from "dotenv";
dotenv.config({ path: "G:/TaigaAI/.env.local", override: true });

const EMAIL = process.env.TAIGA_EMAIL || process.env.TAIGA_USERNAME;
const PASSWORD = process.env.TAIGA_PASSWORD;
const BASE = "https://api.taigadata.com/app-api";

// ── Auth ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let token = "";
let cookieStr = "";
context.on("response", async (res) => {
  if (res.url().includes("/app-api/auth") && res.request().method() === "GET") {
    const b = await res.json().catch(() => ({}));
    if (b?.token) token = b.token;
  }
});

console.log("Authenticating...");
await page.goto("https://app.taigadata.com/login");
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await new Promise((r) => setTimeout(r, 4000));

const cookies = await context.cookies("https://api.taigadata.com");
cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();

if (!token) { console.error("Auth failed — no token captured"); process.exit(1); }
console.log("Auth OK. Token:", token.slice(0, 8) + "…\n");

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: "Bearer " + token,
  Cookie: cookieStr,
};

function get(path) {
  return fetch(`${BASE}${path}`, { headers }).then((r) => r.json());
}

// ── 1. List all console dashboards — look for payment/tender ─────────────────
console.log("═══ Step 1: Scanning consoles for payment/tender dashboards ═══");
try {
  const consoles = await get("/console");
  if (Array.isArray(consoles)) {
    const paymentConsoles = consoles.filter((c) =>
      /payment|tender|credit|card/i.test(JSON.stringify(c))
    );
    console.log(`Total consoles: ${consoles.length}`);
    if (paymentConsoles.length) {
      console.log("Payment-related consoles found:");
      paymentConsoles.forEach((c) => console.log(" ", JSON.stringify({ id: c.id, name: c.name })));
    } else {
      console.log("No payment-related consoles found by keyword scan.");
      console.log("All console names:", consoles.map((c) => `[${c.id}] ${c.name}`).join(", "));
    }
  } else {
    console.log("Console list response:", JSON.stringify(consoles).slice(0, 400));
  }
} catch (e) {
  console.log("Console list failed:", e.message);
}

// ── 2. List all DataViews ─────────────────────────────────────────────────────
console.log("\n═══ Step 2: Scanning DataViews for payment/tender ═══");
try {
  const views = await get("/data-view");
  if (Array.isArray(views)) {
    const paymentViews = views.filter((v) =>
      /payment|tender|credit|card/i.test(JSON.stringify(v))
    );
    console.log(`Total DataViews: ${views.length}`);
    if (paymentViews.length) {
      console.log("Payment-related DataViews:");
      paymentViews.forEach((v) => console.log(" ", JSON.stringify({ id: v.id, name: v.name, description: v.description })));
    } else {
      console.log("No payment-related DataViews by keyword. All DataViews:");
      views.forEach((v) => console.log(`  [${v.id}] ${v.name || v.description || "(unnamed)"}`));
    }
  } else {
    console.log("DataView list response:", JSON.stringify(views).slice(0, 600));
  }
} catch (e) {
  console.log("DataView list failed:", e.message);
}

// ── 3. Try DataView 113 / Widget 269 with candidate GroupBy field names ───────
console.log("\n═══ Step 3: Probing DataView 113 with payment field candidates ═══");

const timeFilter = {
  Time_Filter: { dimension: "LASTMONTH", timeZoneOffsetMinutes: 300, daysOfWeek: "", start: "", end: "", selectedComparison: "", sameStoreSales: false },
  Query_Filter: [
    { Field: "StoreName", Value: null },
    { Field: "Tags", Value: null, RequireAll: true },
    { Field: "TagGroups", Value: null, RequireAll: true },
    { Field: "SourceType", Value: null },
    { Field: "TransactionType", Value: "sql::1=1", Exclude: false, RequireAll: false },
  ],
  Filter_Options: { ConsoleWidgetDisplayOptions: [], ReportHiddenColumns: [], HiddenFilters: [], HiddenByDefault: [], IsDefault: false },
};

const candidateFields = [
  "TenderType",
  "TenderTypeDescription",
  "TenderDescription",
  "PaymentType",
  "PaymentMethod",
  "PaymentTypeDescription",
  "CreditCardType",
  "CardType",
  "IsCredit",
  "FuelTenderType",
  "TenderCategory",
];

for (const field of candidateFields) {
  const columns = [
    { Field: "StoreId",    Label: "StoreId",    Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",  Label: "StoreName",  Function: true, FunctionType: "GroupByRequired" },
    { Field: field,        Label: field,        Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum([TotalTransactions])",    Label: "TotalTransactions",    Function: true },
    { Field: "sum([TotalFuelTransactions])", Label: "TotalFuelTransactions", Function: true },
    { Field: "sum([AdjustedSalesTotal])",   Label: "AdjustedSalesTotal",   Function: true },
  ];

  const body = JSON.stringify({
    WidgetId: 269,
    Columns: columns,
    FilterBy: "",
    GroupBy: `StoreName, StoreId, ${field}`,
    OverrideQueryView: "",
    OrderBy: "",
    Limit: 0,
    Filter: timeFilter,
    StaticTimeDimension: "",
  });

  const payload = [{
    id: "GridResult",
    operation: "table-results",
    parameters: [
      { key: "DataViewId", value: 113 },
      { key: "Body", value: body },
      { key: "Filter", value: JSON.stringify(timeFilter) },
    ],
  }];

  try {
    const res = await fetch(`${BASE}/data-view-batch`, { method: "POST", headers, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json[0]?.exception) {
      const msg = json[0].exception.split("\n")[0];
      console.log(`  ${field}: FAIL — ${msg.slice(0, 120)}`);
    } else {
      const rows = json[0]?.value ?? [];
      console.log(`  ${field}: SUCCESS — ${rows.length} rows`);
      if (rows.length > 0) {
        console.log("  Sample row:", JSON.stringify(rows[0], null, 2));
        console.log(`\n  *** FOUND IT: use field "${field}" in GroupBy ***\n`);
      }
    }
  } catch (e) {
    console.log(`  ${field}: ERROR — ${e.message}`);
  }
}

// ── 4. Fetch the sales-tracking console to inspect all filter options ─────────
console.log("\n═══ Step 4: Inspect sales-tracking console filter options ═══");
try {
  const st = await get("/console/sales-tracking");
  const filters = JSON.parse(st.filter || "{}");
  console.log("Available query filters:");
  (filters.Query_Filters || []).forEach((f) =>
    console.log(`  Field=${f.Field} Label=${f.Label} FilterType=${f.FilterType}`)
  );
} catch (e) {
  console.log("sales-tracking fetch failed:", e.message);
}

console.log("\nDone. Check output above for which field name succeeded in Step 3.");
