/**
 * Phase 5 probe — confirms TaigaPaymentType + metric columns work live
 * against DataViews 177 and 426. Also discovers transaction count field.
 *
 * Run: node scraper/probe-payment-type-5.mjs
 */

import { chromium } from "playwright";
import dotenv from "dotenv";
dotenv.config({ path: "G:/TaigaAI/.env.local", override: true });

const EMAIL = process.env.TAIGA_EMAIL || process.env.TAIGA_USERNAME;
const PASSWORD = process.env.TAIGA_PASSWORD;
const BASE = "https://api.taigadata.com/app-api";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let token = "", cookieStr = "";
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

if (!token) { console.error("Auth failed"); process.exit(1); }
console.log("Auth OK\n");

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: "Bearer " + token,
  Cookie: cookieStr,
};

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

async function tryRequest(label, dataViewId, widgetId, columns, groupBy) {
  const body = JSON.stringify({
    WidgetId: widgetId,
    Columns: columns,
    FilterBy: "",
    GroupBy: groupBy,
    OverrideQueryView: "",
    OrderBy: "sum(TotalTenderAmount) desc",
    Limit: 200,
    Filter: timeFilter,
    StaticTimeDimension: "",
  });

  const payload = [{
    id: "GridResult",
    operation: "table-results",
    parameters: [
      { key: "DataViewId", value: dataViewId },
      { key: "Body", value: body },
      { key: "Filter", value: JSON.stringify(timeFilter) },
    ],
  }];

  const res = await fetch(`${BASE}/data-view-batch`, { method: "POST", headers, body: JSON.stringify(payload) });
  const json = await res.json();
  if (json[0]?.exception) {
    const msg = json[0].exception.split("\n")[0];
    console.log(`${label}: FAIL — ${msg.slice(0, 200)}`);
    return null;
  }
  const rows = json[0]?.value ?? [];
  console.log(`${label}: SUCCESS — ${rows.length} rows`);
  if (rows.length > 0) {
    console.log("  Keys:", Object.keys(rows[0]).join(", "));
    console.log("  Sample (first 3):", JSON.stringify(rows.slice(0, 3), null, 2));
  }
  return rows;
}

const groupByFields = [
  { Field: "StoreId",          Label: "StoreId",          Function: true, FunctionType: "GroupByRequired" },
  { Field: "StoreName",        Label: "StoreName",        Function: true, FunctionType: "GroupByRequired" },
  { Field: "StoreIdentifier",  Label: "StoreIdentifier",  Function: true, FunctionType: "GroupByRequired" },
  { Field: "TaigaPaymentType", Label: "TaigaPaymentType", Function: true, FunctionType: "GroupByRequired" },
];

// ── Test 1: DataView 177 with TaigaPaymentType + known metric columns ──────────
console.log("═══ Test 1: DataView 177 (All Payment Types), Widget 394 ═══\n");

const candidateMetrics177 = [
  { Field: "sum(TotalTenderAmount)",      Label: "TotalTenderAmount",      Function: true },
  { Field: "sum(TotalAmountOfCollected)", Label: "TotalAmountOfCollected", Function: true },
];

await tryRequest(
  "DV177 basic",
  177, 394,
  [...groupByFields, ...candidateMetrics177],
  "StoreName, StoreId, StoreIdentifier, TaigaPaymentType"
);

// Now try adding transaction count candidates
const txCountCandidates = [
  "TotalTransactions", "TransactionCount", "TotalTransactionCount",
  "TenderCount", "TotalTenderCount", "TransactionTotal",
];

console.log("\n── Finding transaction count column for DV177 ──");
for (const field of txCountCandidates) {
  await tryRequest(
    `DV177 + ${field}`,
    177, 394,
    [...groupByFields, ...candidateMetrics177, { Field: `sum(${field})`, Label: field, Function: true }],
    "StoreName, StoreId, StoreIdentifier, TaigaPaymentType"
  );
}

// ── Test 2: DataView 426 (Fuel Payment Types), Widget 1113 ────────────────────
console.log("\n═══ Test 2: DataView 426 (Fuel Payment Types), Widget 1113 ═══\n");

await tryRequest(
  "DV426 basic",
  426, 1113,
  [...groupByFields, ...candidateMetrics177],
  "StoreName, StoreId, StoreIdentifier, TaigaPaymentType"
);

// ── Test 3: DataView 361 (Item Sales w/ Tender), Widget 927 ──────────────────
// Try adding TaigaPaymentType to the GroupBy for item sales
console.log("\n═══ Test 3: DataView 361 (Item Sales w/ Tender), Widget 927 ═══\n");

await tryRequest(
  "DV361 by payment type",
  361, 927,
  [
    { Field: "StoreId",          Label: "StoreId",          Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",        Label: "StoreName",        Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier",  Label: "StoreIdentifier",  Function: true, FunctionType: "GroupByRequired" },
    { Field: "TaigaPaymentType", Label: "TaigaPaymentType", Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum(TotalSalesAmount)",       Label: "TotalSalesAmount",       Function: true },
    { Field: "sum(TotalUnitTransactions)",  Label: "TotalUnitTransactions",  Function: true },
    { Field: "sum(TotalSalesQuantity)",     Label: "TotalSalesQuantity",     Function: true },
    { Field: "sum(TotalRetail)",            Label: "TotalRetail",            Function: true },
    { Field: "sum(TotalCost)",              Label: "TotalCost",              Function: true },
    { Field: "sum(TotalRetail - TotalCost)", Label: "TotalMarginDollarAmount", Function: true },
  ],
  "StoreName, StoreId, StoreIdentifier, TaigaPaymentType"
);

// ── Test 4: Also try the CASE GroupBy expression exactly as widget 394 uses it ─
console.log("\n═══ Test 4: DV177 with exact CASE GroupBy from widget config ═══\n");
const caseField = "case when TaigaPaymentTypeId = 1 or TaigaPaymentTypeId = 15 then 'Cash' else TaigaPaymentType end";
await tryRequest(
  "DV177 CASE groupBy",
  177, 394,
  [
    { Field: "StoreId",     Label: "StoreId",     Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",   Label: "StoreName",   Function: true, FunctionType: "GroupByRequired" },
    { Field: caseField,     Label: "PaymentType", Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum(TotalTenderAmount)",      Label: "TotalTenderAmount",      Function: true },
    { Field: "sum(TotalAmountOfCollected)", Label: "TotalAmountOfCollected", Function: true },
  ],
  `StoreName, StoreId, ${caseField}`
);

console.log("\nDone.");
