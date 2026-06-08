/**
 * Phase 3 probe — extracts widget IDs from console rows/items structure,
 * renders each widget to get exact column definitions, then makes live
 * data-view-batch calls with the correct widget IDs and column names.
 *
 * Run: node scraper/probe-payment-type-3.mjs
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
const post = (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());

// Recursively find all widgetId values in a nested object
function findWidgetIds(obj, found = new Set()) {
  if (!obj || typeof obj !== "object") return found;
  if (Array.isArray(obj)) { obj.forEach((x) => findWidgetIds(x, found)); return found; }
  for (const [k, v] of Object.entries(obj)) {
    if ((k === "widgetId" || k === "id") && typeof v === "number" && v > 0) found.add(v);
    else findWidgetIds(v, found);
  }
  return found;
}

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

// ── Step 1: Get widget IDs from payment consoles ──────────────────────────────
console.log("═══ Step 1: Extracting widget IDs from payment consoles ═══\n");

const consoleWidgets = {}; // consoleId → [widgetIds]
for (const cid of [86, 183, 153]) {
  try {
    const detail = await get(`/console/${cid}`);
    const allIds = [...findWidgetIds(detail)];
    // Filter out the console's own ID and very small IDs likely to be enterprise/client IDs
    const widgetIds = allIds.filter((id) => id > 50 && id !== cid && id !== detail.enterpriseId && id !== detail.clientId);
    consoleWidgets[cid] = widgetIds;
    console.log(`Console ${cid} (${detail.name}): widget ID candidates = [${widgetIds.join(", ")}]`);

    // Also print the rows/items structure briefly
    if (detail.rows) {
      detail.rows.slice(0, 2).forEach((row, ri) => {
        const items = row.items || [];
        items.forEach((item) => {
          const wid = item.widgetId || item.id;
          const wname = item.name || item.widget?.name || "";
          console.log(`  Row ${ri}, item widgetId=${wid} name="${wname}"`);
        });
      });
    }
  } catch (e) {
    console.log(`Console ${cid} failed: ${e.message}`);
  }
}

// ── Step 2: Render each widget to get its DataView ID and column definitions ──
console.log("\n═══ Step 2: Rendering widgets to find DataView IDs and columns ═══\n");

// Focus on consoles 86 (Payment Types) and 183 (Fuel Payment Types)
const allWidgetIds = [...new Set([...(consoleWidgets[86] || []), ...(consoleWidgets[183] || []), ...(consoleWidgets[153] || [])])];
console.log(`Total unique widget IDs to render: ${allWidgetIds.length}`);

const widgetDataViews = {}; // widgetId → { dataViewId, columns, groupByFields }

for (const wid of allWidgetIds.slice(0, 30)) { // cap at 30 to avoid rate-limiting
  try {
    const rendered = await get(`/widget/${wid}/render`);
    const dvid = rendered.dataViewId || rendered.dataView?.id;
    if (!dvid) continue;

    let config = {};
    if (rendered.json) {
      try { config = JSON.parse(rendered.json); } catch {}
    }

    // Extract column field names from the widget config
    const cols = config.Columns || config.columns || [];
    const groupBy = config.GroupBy || config.groupBy || "";
    const name = rendered.name || rendered.overrideTitle || "";

    if ([177, 182, 361, 369, 426].includes(dvid)) {
      widgetDataViews[wid] = { dataViewId: dvid, name, groupBy, columns: cols };
      console.log(`  Widget ${wid} "${name}": DataView ${dvid}, GroupBy="${groupBy}"`);
      if (cols.length) {
        console.log(`    Columns: ${cols.map((c) => c.Label || c.Field).join(", ")}`);
      }
    }
  } catch (e) {
    // skip silently
  }
}

// ── Step 3: Live data-view-batch calls using discovered widget/column info ────
console.log("\n═══ Step 3: Live batch calls with discovered widget configs ═══\n");

// Known working GroupBy fields from probe-2 results:
//   DataView 177 → CardType
//   DataView 361 → PaymentType
//   DataView 426 → CardType
const dvGroupByMap = { 177: "CardType", 361: "PaymentType", 426: "CardType" };

for (const [wid, info] of Object.entries(widgetDataViews)) {
  const { dataViewId, name, groupBy, columns } = info;
  const paymentField = dvGroupByMap[dataViewId];
  if (!paymentField) continue;

  console.log(`\nTrying Widget ${wid} "${name}" (DataView ${dataViewId}) with GroupBy "${paymentField}"…`);

  // Build columns from the rendered widget's column list, keeping only GroupBy + metric columns
  let metricCols = columns.filter((c) => !c.FunctionType?.includes("GroupBy"));
  if (!metricCols.length) {
    // Fallback: use common metric field patterns for payment DataViews
    metricCols = [
      { Field: "sum(TransactionCount)",  Label: "TransactionCount",  Function: true },
      { Field: "sum(SalesAmount)",        Label: "SalesAmount",        Function: true },
      { Field: "sum(GallonsPumped)",      Label: "GallonsPumped",      Function: true },
    ];
  }

  const colsToSend = [
    { Field: "StoreId",      Label: "StoreId",      Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",    Label: "StoreName",     Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier", Label: "StoreIdentifier", Function: true, FunctionType: "GroupByRequired" },
    { Field: paymentField,   Label: paymentField,    Function: true, FunctionType: "GroupByRequired" },
    ...metricCols.slice(0, 8),
  ];

  const body = JSON.stringify({
    WidgetId: Number(wid),
    Columns: colsToSend,
    FilterBy: "",
    GroupBy: `StoreName, StoreId, StoreIdentifier, ${paymentField}`,
    OverrideQueryView: "",
    OrderBy: "",
    Limit: 100,
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
      console.log(`  FAIL — ${msg.slice(0, 200)}`);
    } else {
      const rows = json[0]?.value ?? [];
      console.log(`  SUCCESS — ${rows.length} rows`);
      if (rows.length > 0) {
        console.log("  Distinct payment types:", [...new Set(rows.map((r) => r[paymentField] || r.cardType || r.paymentType || "(unknown)"))].join(", "));
        console.log("  Sample row:", JSON.stringify(rows[0], null, 2));
        console.log(`\n  *** USE: DataView=${dataViewId}, Widget=${wid}, GroupByField="${paymentField}" ***\n`);
      }
    }
  } catch (e) {
    console.log(`  ERROR — ${e.message}`);
  }
}

// ── Step 4: Use filter-distinct-results to get distinct CardType/PaymentType values ─
console.log("\n═══ Step 4: Listing distinct payment type values via filter API ═══\n");

for (const [dvid, field] of Object.entries(dvGroupByMap)) {
  try {
    const res = await post("/data-view/undefined/filter-distinct-results", {
      Label: "Payment Type",
      Field: field,
      FilterType: "Options",
      DataViewId: Number(dvid),
      ExcludeThis: false,
      dataAggregationGroupId: 0,
    });
    if (Array.isArray(res)) {
      console.log(`DataView ${dvid} field "${field}" distinct values (${res.length}): ${JSON.stringify(res.slice(0, 10))}`);
    } else {
      console.log(`DataView ${dvid} field "${field}":`, JSON.stringify(res).slice(0, 200));
    }
  } catch (e) {
    console.log(`DataView ${dvid} field "${field}" filter-distinct failed: ${e.message}`);
  }
}

console.log("\nDone. Look for '*** USE: ***' lines above.");
