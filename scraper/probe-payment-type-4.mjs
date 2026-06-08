/**
 * Phase 4 probe — renders ALL discovered widget IDs without DataView filtering,
 * logs their actual DataView IDs and column definitions, then does live
 * data-view-batch calls using each widget's OWN DataView ID.
 *
 * Run: node scraper/probe-payment-type-4.mjs
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

// All widget IDs found across the three payment consoles
const ALL_WIDGET_IDS = [
  // Console 183 — Fuel Payment Types
  1113, 1122, 1123, 1124,
  // Console 86 — Payment Types
  1137, 394, 396, 402, 900,
  // Console 153 — Item Sales By Payment Type
  927,
];

// ── Step 1: Render every widget, log its DataView ID and column config ─────────
console.log("═══ Step 1: Rendering all payment console widgets ═══\n");

const widgetInfos = [];

for (const wid of ALL_WIDGET_IDS) {
  try {
    const r = await get(`/widget/${wid}/render`);
    const dvid = r.dataViewId || r.dataView?.id || null;
    const name = r.name || r.overrideTitle || "(unnamed)";
    let config = null;
    if (r.json) { try { config = JSON.parse(r.json); } catch {} }

    const cols = config?.Columns || config?.columns || [];
    const groupBy = config?.GroupBy || config?.groupBy || "";

    console.log(`Widget ${wid}: DataView=${dvid}  name="${name}"`);
    console.log(`  GroupBy: "${groupBy}"`);
    if (cols.length) {
      console.log(`  Columns (${cols.length}):`);
      cols.forEach((c) => console.log(`    Field="${c.Field}"  Label="${c.Label}"  FunctionType="${c.FunctionType || ""}"`));
    } else {
      console.log(`  No Columns in config. Full json: ${r.json?.slice(0, 400) || "(none)"}`);
    }
    console.log();

    widgetInfos.push({ wid, dvid, name, groupBy, cols, rawJson: r.json });
  } catch (e) {
    console.log(`Widget ${wid}: ERROR — ${e.message}\n`);
  }
}

// ── Step 2: Live data-view-batch using each widget's own config ────────────────
console.log("\n═══ Step 2: Live data-view-batch using each widget's own columns ═══\n");

for (const { wid, dvid, name, groupBy, cols } of widgetInfos) {
  if (!dvid || !cols.length) {
    console.log(`Widget ${wid} "${name}": skipping (dvid=${dvid}, cols=${cols.length})`);
    continue;
  }

  // Use the widget's exact columns verbatim — just as Taiga designed them
  const body = JSON.stringify({
    WidgetId: wid,
    Columns: cols,
    FilterBy: "",
    GroupBy: groupBy,
    OverrideQueryView: "",
    OrderBy: "",
    Limit: 200,
    Filter: timeFilter,
    StaticTimeDimension: "",
  });

  const payload = [{
    id: "GridResult",
    operation: "table-results",
    parameters: [
      { key: "DataViewId", value: dvid },
      { key: "Body", value: body },
      { key: "Filter", value: JSON.stringify(timeFilter) },
    ],
  }];

  try {
    const res = await fetch(`${BASE}/data-view-batch`, { method: "POST", headers, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json[0]?.exception) {
      const msg = json[0].exception.split("\n")[0];
      console.log(`Widget ${wid} "${name}" (DV ${dvid}): FAIL — ${msg.slice(0, 180)}`);
    } else {
      const rows = json[0]?.value ?? [];
      console.log(`Widget ${wid} "${name}" (DV ${dvid}): SUCCESS — ${rows.length} rows`);
      if (rows.length > 0) {
        console.log("  Keys in row:", Object.keys(rows[0]).join(", "));
        console.log("  Sample (first 2):", JSON.stringify(rows.slice(0, 2), null, 2));
      }
    }
  } catch (e) {
    console.log(`Widget ${wid} "${name}" (DV ${dvid}): ERROR — ${e.message}`);
  }
  console.log();
}

console.log("Done.");
