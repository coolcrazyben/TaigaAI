/**
 * Phase 2 probe — fetches console configs for payment type dashboards,
 * discovers Widget IDs and field names for DataViews 177, 361, and 426.
 *
 * Run: node scraper/probe-payment-type-2.mjs
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

if (!token) { console.error("Auth failed"); process.exit(1); }
console.log("Auth OK\n");

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: "Bearer " + token,
  Cookie: cookieStr,
};
const get = (path) => fetch(`${BASE}${path}`, { headers }).then((r) => r.json());

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

async function probeDataView(dataViewId, widgetId, label, candidateGroupByFields) {
  console.log(`\n─── Probing DataView ${dataViewId} (${label}), Widget ${widgetId} ───`);

  for (const groupByField of candidateGroupByFields) {
    // Minimal request — just group by store + the candidate field and sum transactions
    const columns = [
      { Field: "StoreId",    Label: "StoreId",    Function: true, FunctionType: "GroupByRequired" },
      { Field: "StoreName",  Label: "StoreName",  Function: true, FunctionType: "GroupByRequired" },
      { Field: groupByField, Label: groupByField, Function: true, FunctionType: "GroupByRequired" },
      { Field: "sum([TotalTransactions])", Label: "TotalTransactions", Function: true },
    ];

    const body = JSON.stringify({
      WidgetId: widgetId,
      Columns: columns,
      FilterBy: "",
      GroupBy: `StoreName, StoreId, ${groupByField}`,
      OverrideQueryView: "",
      OrderBy: "",
      Limit: 50,
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

    try {
      const res = await fetch(`${BASE}/data-view-batch`, { method: "POST", headers, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json[0]?.exception) {
        const msg = json[0].exception.split("\n")[0];
        console.log(`  GroupBy "${groupByField}": FAIL — ${msg.slice(0, 150)}`);
      } else {
        const rows = json[0]?.value ?? [];
        console.log(`  GroupBy "${groupByField}": OK — ${rows.length} rows`);
        if (rows.length > 0) {
          console.log("  Sample:", JSON.stringify(rows.slice(0, 3), null, 2));
          // Once we find a working field, try to get all useful columns
          console.log(`\n  *** "${groupByField}" works on DataView ${dataViewId} / Widget ${widgetId} ***`);
        }
        break; // found a working field — stop trying candidates for this DataView
      }
    } catch (e) {
      console.log(`  GroupBy "${groupByField}": ERROR — ${e.message}`);
    }
  }
}

// ── Step 1: Fetch console configs to extract Widget IDs ───────────────────────
console.log("═══ Step 1: Fetching console configs for payment dashboards ═══");

const consoleIds = { 86: "Payment Types", 183: "Fuel Payment Types", 153: "Item Sales By Payment Type" };
const widgetMap = {}; // dataViewId → widgetId

for (const [cid, cname] of Object.entries(consoleIds)) {
  try {
    const detail = await get(`/console/${cid}`);
    console.log(`\nConsole ${cid} (${cname}):`);
    const widgets = detail.consoleWidgets || detail.widgets || [];
    if (widgets.length) {
      widgets.forEach((w) => {
        const wid = w.widgetId || w.id;
        const dvid = w.dataViewId || w.widget?.dataViewId;
        const wname = w.name || w.widget?.name || "(unnamed)";
        console.log(`  Widget ${wid}: "${wname}" DataView=${dvid}`);
        if (dvid) widgetMap[dvid] = wid;
      });
    } else {
      // Console may embed widget info differently — print keys
      console.log("  Keys:", Object.keys(detail).join(", "));
      console.log("  Raw (truncated):", JSON.stringify(detail).slice(0, 600));
    }
  } catch (e) {
    console.log(`  Console ${cid} failed: ${e.message}`);
  }
}

console.log("\nDiscovered DataView→Widget map:", widgetMap);

// ── Step 2: Try each target DataView with candidate GroupBy fields ─────────────
// Common tender field names in c-store POS / Taiga schemas
const tenderCandidates = [
  "TenderType", "TenderTypeDescription", "TenderDescription",
  "PaymentType", "PaymentTypeDescription", "PaymentDescription",
  "TenderCategory", "TenderCategoryDescription",
  "AccountType", "AccountTypeDescription",
  "CardType", "CardTypeDescription",
  "FuelTenderType", "FuelTenderDescription",
  "TenderCode",
];

// DataView 177: "Tender Type from Summarized"
const dv177Widget = widgetMap[177] || 0;
if (dv177Widget) {
  await probeDataView(177, dv177Widget, "Tender Type from Summarized", tenderCandidates);
} else {
  // Try without a widget ID (some DataViews accept widgetId=0)
  console.log("\nDataView 177 widget not found in console scan — trying widgetId=0");
  await probeDataView(177, 0, "Tender Type from Summarized", tenderCandidates);
}

// DataView 426: "Fuel Payment Types - Tender by Fuel Grade"
const dv426Widget = widgetMap[426] || 0;
await probeDataView(426, dv426Widget, "Fuel Payment Types", tenderCandidates);

// DataView 361: "Summarized Item Sales W/ Tender from Live Data"
const dv361Widget = widgetMap[361] || 0;
await probeDataView(361, dv361Widget, "Summarized Item Sales W/ Tender", tenderCandidates);

// ── Step 3: Render the Payment Types widget to see its default column config ──
console.log("\n═══ Step 3: Rendering console 86 widgets for column reference ═══");
try {
  const consoleFull = await get("/console/86");
  const widgets = consoleFull.consoleWidgets || consoleFull.widgets || [];
  for (const w of widgets.slice(0, 3)) {
    const wid = w.widgetId || w.id;
    if (!wid) continue;
    try {
      const rendered = await get(`/widget/${wid}/render`);
      console.log(`\nWidget ${wid} "${rendered.name || ""}":`);
      // Print the json field which contains column definitions
      if (rendered.json) {
        const parsed = JSON.parse(rendered.json).catch?.() ?? (() => { try { return JSON.parse(rendered.json); } catch { return rendered.json; } })();
        console.log("  Config:", JSON.stringify(parsed).slice(0, 800));
      }
    } catch (e) {
      console.log(`  Widget ${wid} render failed: ${e.message}`);
    }
  }
} catch (e) {
  console.log("Console 86 full fetch failed:", e.message);
}

console.log("\nDone. Look for '*** works ***' lines above to identify the correct DataView/Widget/field names.");
