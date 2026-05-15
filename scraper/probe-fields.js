/**
 * Probe script — finds correct Taiga SQL column names for daily date and product fields.
 * Run: node scraper/probe-fields.js
 */
import { chromium } from "playwright";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env" });

const EMAIL    = process.env.TAIGA_EMAIL || process.env.TAIGA_USERNAME;
const PASSWORD = process.env.TAIGA_PASSWORD;
const TAIGA_API = "https://api.taigadata.com/app-api";

// ── Auth ──────────────────────────────────────────────────────────────────────
let _token = "";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page    = await context.newPage();
const tokenPromise = new Promise((resolve) => {
  context.on("response", async (res) => {
    if (res.url().includes("/app-api/auth") && res.request().method() === "GET") {
      const body = await res.json().catch(() => ({}));
      if (body?.token) resolve(body.token);
    }
  });
});
await page.goto("https://app.taigadata.com/login");
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
_token = await Promise.race([
  tokenPromise,
  new Promise((_,r) => setTimeout(() => r(new Error("auth timeout")), 30_000)),
]);
await browser.close();
console.log(`Authenticated. Token: ${_token.slice(0,8)}…\n`);

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: `Bearer ${_token}`,
};

const filter = {
  Time_Filter: { dimension: "THISMONTH", timeZoneOffsetMinutes: 300, daysOfWeek: "", start: "", end: "", selectedComparison: "", sameStoreSales: false },
  Query_Filter: [
    { Field: "StoreName", Value: null },
    { Field: "SourceType", Value: null },
    { Field: "TransactionType", Value: "sql::1=1", Exclude: false, RequireAll: false },
  ],
  Filter_Options: { ConsoleWidgetDisplayOptions: [], ReportHiddenColumns: [], HiddenFilters: [], HiddenByDefault: [], IsDefault: false },
};

async function probe(dataViewId, widgetId, groupByFields, extraColumns = []) {
  const columns = groupByFields.map(f => ({ Field: f, Label: f, Function: true, FunctionType: "GroupByRequired" }));
  columns.push(...extraColumns);
  const body = JSON.stringify({
    WidgetId: widgetId,
    Columns: columns,
    FilterBy: "", GroupBy: groupByFields.join(", "), OverrideQueryView: "", OrderBy: "", Limit: 3,
    Filter: filter, StaticTimeDimension: "",
  });
  const payload = [{ id: "GridResult", operation: "table-results", parameters: [
    { key: "DataViewId", value: dataViewId },
    { key: "Body", value: body },
    { key: "Filter", value: JSON.stringify(filter) },
  ]}];
  const res = await fetch(`${TAIGA_API}/data-view-batch`, { method: "POST", headers, body: JSON.stringify(payload) });
  const result = await res.json();
  const exc = result[0]?.exception;
  if (exc) return { ok: false, error: exc.split("\n")[0] };
  return { ok: true, rows: result[0]?.value ?? [] };
}

// ── 1. Probe daily date field ──────────────────────────────────────────────────
console.log("=== Daily date field candidates (DataView 113) ===");
for (const dateField of ["Date", "TransactionDate", "LocalDate", "SaleDate", "BusinessDay", "PeriodDate"]) {
  const r = await probe(113, 269,
    ["StoreId", dateField],
    [{ Field: "sum([TotalTransactions])", Label: "TotalTransactions", Function: true }]
  );
  if (r.ok) {
    console.log(`  ✓ ${dateField} — ${r.rows.length} rows, sample keys: ${Object.keys(r.rows[0]||{}).join(", ")}`);
    console.log(`    Sample row:`, JSON.stringify(r.rows[0]));
  } else {
    console.log(`  ✗ ${dateField}: ${r.error}`);
  }
}

// ── 2. Probe product field combinations ───────────────────────────────────────
console.log("\n=== Product field candidates (DataView 145) ===");
const combos = [
  ["UPC", "ItemDescription", "Dept"],
  ["UPC", "ItemDescription", "DepartmentName"],
  ["UPC", "ItemDescription", "Department"],
  ["UPC", "ItemDescription", "Category"],
  ["UPC", "Desc", "Dept"],
  ["UPC", "Desc", "DepartmentName"],
  ["UPC", "Name", "Dept"],
  ["PLU", "Description", "Dept"],
  ["PLU", "ItemDescription", "Dept"],
  ["ItemCode", "ItemDescription", "Category"],
  ["Barcode", "ItemDescription", "Dept"],
];
for (const [upc, desc, dept] of combos) {
  const r = await probe(145, 695,
    ["StoreId", upc, desc, dept],
    [{ Field: "sum(TotalSalesQuantity)", Label: "TotalSalesQuantity", Function: true }]
  );
  if (r.ok) {
    console.log(`  ✓ [${upc}, ${desc}, ${dept}] — ${r.rows.length} rows`);
    console.log(`    Sample keys: ${Object.keys(r.rows[0]||{}).join(", ")}`);
    console.log(`    Sample row:`, JSON.stringify(r.rows[0]));
  } else {
    console.log(`  ✗ [${upc}, ${desc}, ${dept}]: ${r.error}`);
  }
}
