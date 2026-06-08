/**
 * Prince Oil — Taiga API Scraper
 * Calls api.taigadata.com directly (no browser needed).
 * Discovered via network inspection of app.taigadata.com.
 *
 * Usage:
 *   node scraper/index.js                 (current + prior month)
 *   node scraper/index.js --months 3      (last 3 months)
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import dotenv from "dotenv";
import ws from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = ws;

dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env" });

const TAIGA_API = "https://api.taigadata.com/app-api";
const EMAIL    = process.env.TAIGA_EMAIL || process.env.TAIGA_USERNAME;
const PASSWORD = process.env.TAIGA_PASSWORD;
const DL_DIR   = path.resolve(process.env.DOWNLOAD_DIR || "downloads");
const LOG_FILE = path.resolve(process.env.LOG_FILE || "scraper.log");
const MONTHS_BACK = parseInt(
  process.argv.includes("--months")
    ? process.argv[process.argv.indexOf("--months") + 1]
    : "2",
  10
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: ws } })
  : null;

if (!EMAIL || !PASSWORD) { console.error("FATAL: TAIGA_EMAIL and TAIGA_PASSWORD required"); process.exit(1); }
if (!supabase) log("WARNING: Supabase not configured — saving JSON to downloads/ only.");

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fsSync.appendFileSync(LOG_FILE, line + "\n");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let _cookie = "";
let _token  = "";

async function authenticate() {
  log("Authenticating via Playwright…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Intercept the GET /auth response that the app makes after login — it contains the real token.
  const tokenPromise = new Promise((resolve) => {
    context.on("response", async (response) => {
      if (response.url().includes("/app-api/auth") && response.request().method() === "GET") {
        const body = await response.json().catch(() => ({}));
        if (body?.token) resolve(body.token);
      }
    });
  });

  // Navigate to login and submit credentials.
  await page.goto("https://app.taigadata.com/login");
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for the intercepted token (up to 30 s).
  _token = await Promise.race([
    tokenPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Auth timeout — token not found in 30 s")), 30_000)),
  ]);

  // Pull all api.taigadata.com cookies into a Cookie header string.
  const cookies = await context.cookies("https://api.taigadata.com");
  _cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  await browser.close();
  log(`Authenticated. Cookies: ${cookies.length}, Token: ${_token.slice(0, 8)}…`);
}

function headers() {
  const h = { "Content-Type": "application/json", Accept: "application/json" };
  if (_cookie) h["Cookie"] = _cookie;
  if (_token)  h["Authorization"] = `Bearer ${_token}`;
  return h;
}

async function ensureAuth() {
  const r = await fetch(`${TAIGA_API}/auth`, { headers: headers() });
  if (!r.ok) await authenticate();
}

// ── Time ranges ───────────────────────────────────────────────────────────────

function monthRanges(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const dim = i === 0 ? "THISMONTH" : i === 1 ? "LASTMONTH" : "CUSTOM";
    const start = i > 1 ? `${y}-${String(m + 1).padStart(2, "0")}-01` : "";
    const end   = i > 1 ? new Date(y, m + 1, 0).toISOString().split("T")[0] : "";
    return {
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      dimension: dim, start, end,
    };
  });
}

function timeFilter(dimension, start = "", end = "") {
  return {
    Time_Filter: { dimension, timeZoneOffsetMinutes: 300, daysOfWeek: "", start, end, selectedComparison: "", sameStoreSales: false },
    Query_Filter: [
      { Field: "StoreName", Value: null },
      { Field: "Tags", Value: null, RequireAll: true },
      { Field: "TagGroups", Value: null, RequireAll: true },
      { Field: "SourceType", Value: null },
      { Field: "TransactionType", Value: "sql::1=1", Exclude: false, RequireAll: false },
    ],
    Filter_Options: { ConsoleWidgetDisplayOptions: [], ReportHiddenColumns: [], HiddenFilters: [], HiddenByDefault: [], IsDefault: false },
  };
}

// ── Transaction Summary body (DataView 113, Widget 269) ───────────────────────
// Exact column list captured from browser network traffic.

function txSummaryBody(filter) {
  const columns = [
    { Field: "StoreId",        Label: "StoreId",        Function: true,  FunctionType: "GroupByRequired" },
    { Field: "StoreName",      Label: "StoreName",      Function: true,  FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier",Label: "StoreIdentifier",Function: true,  FunctionType: "GroupByRequired" },
    { Field: "sum([TotalTransactions])",        Label: "TotalTransactions",        Function: true },
    { Field: "sum([GrossAmount])",              Label: "GrossAmount",              Function: true },
    { Field: "sum([NetAmount])",                Label: "NetAmount",                Function: true },
    { Field: "sum([TaxNetAmount])",             Label: "TaxNetAmount",             Function: true },
    { Field: "sum([AdjustedSalesTotal])",       Label: "AdjustedSalesTotal",       Function: true },
    { Field: "sum([AdjustedSalesTotal])-sum([TaxNetAmount])", Label: "NetSalesVolume", Function: true },
    { Field: "sum([TotalItemCost])",            Label: "TotalItemCost",            Function: true },
    { Field: "sum([TotalItemRetail])",          Label: "TotalItemRetail",          Function: true },
    { Field: "sum([GallonsPumped])",            Label: "GallonsPumped",            Function: true },
    { Field: "sum([FuelSales])",                Label: "FuelSales",                Function: true },
    { Field: "case when sum(TotalItemRetail) > 0 and sum(TotalItemCost) > 0 then (sum(TotalItemRetail) - SUM(TotalItemCost)) / sum(TotalItemRetail) else 0 end", Label: "TotalMargin", Function: true },
    { Field: "sum([AdjustedSalesTotal]) / sum([TotalTransactions])",                                    Label: "AverageTransactionValue",           Function: true },
    { Field: "(sum([AdjustedSalesTotal]) - sum([FuelSales])) / sum([TotalTransactions])",               Label: "AverageTransactionValueWithoutFuel", Function: true },
    { Field: "(isnull((avg(case when SquareFeet > 0 then CAST(SquareFeet AS BIGINT) end)), 0))",        Label: "AvgSquareFootage",                  Function: true },
    { Field: "(isnull(((sum([AdjustedSalesTotal]) / sum([TotalTransactions])) / avg(case when SquareFeet > 0 then CAST(SquareFeet AS BIGINT) end)), 0))", Label: "SalesPerSquareFootPerTransaction", Function: true },
    { Field: "sum([TotalInstoreTransactions])",     Label: "TotalInstoreTransactions",     Function: true },
    { Field: "sum([TotalFuelTransactions])",         Label: "TotalFuelTransactions",         Function: true },
    { Field: "sum([InstoreFuelTransactions])",       Label: "InstoreFuelTransactions",       Function: true },
    { Field: "sum([InstoreFuelOnlyTransactions])",   Label: "InstoreFuelOnlyTransactions",   Function: true },
    { Field: "sum([TotalInstoreFuelSales])",         Label: "TotalInstoreFuelSales",         Function: true },
    { Field: "sum([TotalFuelOnlyTransactions])",     Label: "TotalFuelOnlyTransactions",     Function: true },
    { Field: "sum([OutsideFuelOnlyTransactions])",   Label: "OutsideFuelOnlyTransactions",   Function: true },
    { Field: "sum([TotalOutsideSales])",             Label: "TotalOutsideSales",             Function: true },
    { Field: "sum([TotalOutsideTransactions])",      Label: "TotalOutsideTransactions",      Function: true },
    { Field: "sum([TotalOutsideFuelSales])",          Label: "TotalOutsideFuelSales",         Function: true },
    { Field: "sum([OutsideFuelTransactions])",        Label: "OutsideFuelTransactions",       Function: true },
    { Field: "sum([AdjustedTotalInstoreSales])",     Label: "AdjustedTotalInstoreSales",     Function: true },
    { Field: "sum([AdjustedTotalInstoreSales]) - sum([TotalInstoreFuelSales])", Label: "AdjustedTotalInstoreSalesWithoutFuel", Function: true },
    { Field: "isnull(convert(float,sum(case when LoyaltyUsed = 1 then TotalTransactions end)) / sum(isnull([TotalTransactions], 0)), 0)", Label: "LoyaltyUsedPercentage", Function: true },
    { Field: "isnull(convert(float,sum(case when PromotionUsed = 1 then TotalTransactions end)) / sum(isnull([TotalTransactions], 0)), 0)", Label: "PromotionUsedPercentage", Function: true },
    { Field: "isnull(sum(case when LoyaltyUsed = 1 then TotalTransactions end),0)",   Label: "LoyaltyTransactions",   Function: true },
    { Field: "isnull(sum(case when PromotionUsed = 1 then TotalTransactions end),0)", Label: "PromotionTransactions", Function: true },
    { Field: "sum(TotalFuelActualRetail)",  Label: "TotalFuelActualRetail",  Function: true },
    { Field: "sum(TotalFuelListedRetail)",  Label: "TotalFuelListedRetail",  Function: true },
    { Field: "sum(TotalFuelCost)",          Label: "TotalFuelCost",          Function: true },
    { Field: "case when sum(TotalFuelActualRetail) > 0 and sum(TotalFuelCost) > 0 then (sum(TotalFuelActualRetail) - SUM(TotalFuelCost) - SUM(TotalFuelTax)) / sum(GallonsPumped) else 0 end", Label: "TotalFuelActualMargin",  Function: true },
    { Field: "case when sum(TotalFuelListedRetail) > 0 and sum(TotalFuelCost) > 0 then (sum(TotalFuelListedRetail) - SUM(TotalFuelCost) - SUM(TotalFuelTax)) / sum(GallonsPumped) else 0 end", Label: "TotalFuelListedMargin", Function: true },
  ];

  return JSON.stringify({
    WidgetId: 269,
    Columns: columns,
    FilterBy: "",
    GroupBy: "StoreName, StoreId, StoreIdentifier",
    OverrideQueryView: "",
    OrderBy: "",
    Limit: 0,
    Filter: filter,
    StaticTimeDimension: "",
  });
}

// ── Transaction Daily body (DataView 113, Widget 269) ────────────────────────
// Same columns as txSummaryBody plus BusinessDate in GroupBy.

function dailyTxBody(filter) {
  const columns = [
    { Field: "StoreId",         Label: "StoreId",         Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",       Label: "StoreName",        Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier", Label: "StoreIdentifier",  Function: true, FunctionType: "GroupByRequired" },
    { Field: "FormattedDate",   Label: "FormattedDate",    Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum([TotalTransactions])",        Label: "TotalTransactions",        Function: true },
    { Field: "sum([GrossAmount])",              Label: "GrossAmount",              Function: true },
    { Field: "sum([NetAmount])",                Label: "NetAmount",                Function: true },
    { Field: "sum([TaxNetAmount])",             Label: "TaxNetAmount",             Function: true },
    { Field: "sum([AdjustedSalesTotal])",       Label: "AdjustedSalesTotal",       Function: true },
    { Field: "sum([AdjustedSalesTotal])-sum([TaxNetAmount])", Label: "NetSalesVolume", Function: true },
    { Field: "sum([TotalItemCost])",            Label: "TotalItemCost",            Function: true },
    { Field: "sum([TotalItemRetail])",          Label: "TotalItemRetail",          Function: true },
    { Field: "sum([GallonsPumped])",            Label: "GallonsPumped",            Function: true },
    { Field: "sum([FuelSales])",                Label: "FuelSales",                Function: true },
    { Field: "case when sum(TotalItemRetail) > 0 and sum(TotalItemCost) > 0 then (sum(TotalItemRetail) - SUM(TotalItemCost)) / sum(TotalItemRetail) else 0 end", Label: "TotalMargin", Function: true },
    { Field: "sum([AdjustedSalesTotal]) / sum([TotalTransactions])",                                    Label: "AverageTransactionValue",           Function: true },
    { Field: "(sum([AdjustedSalesTotal]) - sum([FuelSales])) / sum([TotalTransactions])",               Label: "AverageTransactionValueWithoutFuel", Function: true },
    { Field: "(isnull((avg(case when SquareFeet > 0 then CAST(SquareFeet AS BIGINT) end)), 0))",        Label: "AvgSquareFootage",                  Function: true },
    { Field: "(isnull(((sum([AdjustedSalesTotal]) / sum([TotalTransactions])) / avg(case when SquareFeet > 0 then CAST(SquareFeet AS BIGINT) end)), 0))", Label: "SalesPerSquareFootPerTransaction", Function: true },
    { Field: "sum([TotalInstoreTransactions])",     Label: "TotalInstoreTransactions",     Function: true },
    { Field: "sum([TotalFuelTransactions])",         Label: "TotalFuelTransactions",         Function: true },
    { Field: "sum([InstoreFuelTransactions])",       Label: "InstoreFuelTransactions",       Function: true },
    { Field: "sum([InstoreFuelOnlyTransactions])",   Label: "InstoreFuelOnlyTransactions",   Function: true },
    { Field: "sum([TotalInstoreFuelSales])",         Label: "TotalInstoreFuelSales",         Function: true },
    { Field: "sum([TotalFuelOnlyTransactions])",     Label: "TotalFuelOnlyTransactions",     Function: true },
    { Field: "sum([OutsideFuelOnlyTransactions])",   Label: "OutsideFuelOnlyTransactions",   Function: true },
    { Field: "sum([TotalOutsideSales])",             Label: "TotalOutsideSales",             Function: true },
    { Field: "sum([TotalOutsideTransactions])",      Label: "TotalOutsideTransactions",      Function: true },
    { Field: "sum([TotalOutsideFuelSales])",          Label: "TotalOutsideFuelSales",         Function: true },
    { Field: "sum([OutsideFuelTransactions])",        Label: "OutsideFuelTransactions",       Function: true },
    { Field: "sum([AdjustedTotalInstoreSales])",     Label: "AdjustedTotalInstoreSales",     Function: true },
    { Field: "sum([AdjustedTotalInstoreSales]) - sum([TotalInstoreFuelSales])", Label: "AdjustedTotalInstoreSalesWithoutFuel", Function: true },
    { Field: "isnull(convert(float,sum(case when LoyaltyUsed = 1 then TotalTransactions end)) / sum(isnull([TotalTransactions], 0)), 0)", Label: "LoyaltyUsedPercentage", Function: true },
    { Field: "isnull(convert(float,sum(case when PromotionUsed = 1 then TotalTransactions end)) / sum(isnull([TotalTransactions], 0)), 0)", Label: "PromotionUsedPercentage", Function: true },
    { Field: "isnull(sum(case when LoyaltyUsed = 1 then TotalTransactions end),0)",   Label: "LoyaltyTransactions",   Function: true },
    { Field: "isnull(sum(case when PromotionUsed = 1 then TotalTransactions end),0)", Label: "PromotionTransactions", Function: true },
    { Field: "sum(TotalFuelActualRetail)",  Label: "TotalFuelActualRetail",  Function: true },
    { Field: "sum(TotalFuelListedRetail)",  Label: "TotalFuelListedRetail",  Function: true },
    { Field: "sum(TotalFuelCost)",          Label: "TotalFuelCost",          Function: true },
    { Field: "case when sum(TotalFuelActualRetail) > 0 and sum(TotalFuelCost) > 0 then (sum(TotalFuelActualRetail) - SUM(TotalFuelCost) - SUM(TotalFuelTax)) / sum(GallonsPumped) else 0 end", Label: "TotalFuelActualMargin",  Function: true },
    { Field: "case when sum(TotalFuelListedRetail) > 0 and sum(TotalFuelCost) > 0 then (sum(TotalFuelListedRetail) - SUM(TotalFuelCost) - SUM(TotalFuelTax)) / sum(GallonsPumped) else 0 end", Label: "TotalFuelListedMargin", Function: true },
  ];

  return JSON.stringify({
    WidgetId: 269,
    Columns: columns,
    FilterBy: "",
    GroupBy: "StoreName, StoreId, StoreIdentifier, FormattedDate",
    OverrideQueryView: "",
    OrderBy: "FormattedDate asc",
    Limit: 0,
    Filter: filter,
    StaticTimeDimension: "",
  });
}

// ── Merchandise Summary body (DataView 145, Widget 695) ───────────────────────

function merchBody(filter) {
  const columns = [
    { Field: "StoreId",   Label: "StoreId",   Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName", Label: "StoreName",  Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier", Label: "StoreIdentifier", Function: true, FunctionType: "GroupByRequired" },
    { Field: "Brand",     Label: "Brand",      Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum(TotalUnitTransactions)",  Label: "TotalUnitTransactions",  Function: true },
    { Field: "sum(TotalSalesQuantity)",     Label: "TotalSalesQuantity",     Function: true },
    { Field: "sum(TotalRetail)",            Label: "TotalRetail",            Function: true },
    { Field: "sum(TotalCost)",              Label: "TotalCost",              Function: true },
    { Field: "sum(TotalItemProfit)",        Label: "TotalItemProfit",        Function: true },
    { Field: "sum(TotalSalesAmount)",       Label: "TotalSalesAmount",       Function: true },
    { Field: "Case when sum(isnull(TotalRetail, 0)) > 0 and sum(isnull(TotalCost, 0)) > 0 then ((sum(TotalRetail) - sum(TotalCost)) / sum(TotalRetail)) else 0 end", Label: "TotalMargin", Function: true },
    { Field: "sum(TotalRetail - TotalCost)", Label: "TotalMarginDollarAmount", Function: true },
    { Field: "case when sum(isnull([TotalSalesQuantity], 0)) = 0 then 0 else isnull(convert(float,sum(case when LoyaltyUsed = 1 then TotalSalesQuantity end)) / sum(isnull([TotalSalesQuantity], 0)), 0) end", Label: "LoyaltyUsedPercentage", Function: true },
    { Field: "isnull(sum(case when LoyaltyUsed = 1 then TotalSalesQuantity end),0)", Label: "LoyaltyTransactions", Function: true },
    { Field: "isnull(sum(case when PromotionUsed = 1 then TotalSalesQuantity end),0)", Label: "PromotionTransactions", Function: true },
  ];

  // Modify filter to remove store-specific filter for all-store query
  const allStoreFilter = {
    ...filter,
    Query_Filter: [
      { Field: "StoreName", Value: null },
      { Field: "SourceType", Value: null },
      { Field: "TransactionType", Value: "sql::1=1", Exclude: false, RequireAll: false },
    ],
  };

  return JSON.stringify({
    WidgetId: 695,
    Columns: columns,
    FilterBy: "",
    GroupBy: "Brand, StoreName, StoreId, StoreIdentifier",
    OverrideQueryView: "",
    OrderBy: "TotalSalesQuantity desc",
    Limit: 0,
    Filter: allStoreFilter,
    StaticTimeDimension: "",
  });
}

// ── Product/SKU Merchandise body (DataView 145, Widget 695) ──────────────────
// Same columns as merchBody but grouped by UPC/Description/Department for SKU-level data.
// Field names (UPC, Description, Department) inferred from c-store POS conventions;
// scraper will log an exception if Taiga uses different names — check and correct.

function productMerchBody(filter) {
  const columns = [
    { Field: "StoreId",         Label: "StoreId",         Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",       Label: "StoreName",        Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier", Label: "StoreIdentifier",  Function: true, FunctionType: "GroupByRequired" },
    { Field: "Upc",             Label: "Upc",              Function: true, FunctionType: "GroupByRequired" },
    { Field: "Title",           Label: "Title",            Function: true, FunctionType: "GroupByRequired" },
    { Field: "Category",        Label: "Category",         Function: true, FunctionType: "GroupByRequired" },
    { Field: "Brand",           Label: "Brand",            Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum(TotalUnitTransactions)",  Label: "TotalUnitTransactions",  Function: true },
    { Field: "sum(TotalSalesQuantity)",     Label: "TotalSalesQuantity",     Function: true },
    { Field: "sum(TotalRetail)",            Label: "TotalRetail",            Function: true },
    { Field: "sum(TotalCost)",              Label: "TotalCost",              Function: true },
    { Field: "sum(TotalItemProfit)",        Label: "TotalItemProfit",        Function: true },
    { Field: "sum(TotalSalesAmount)",       Label: "TotalSalesAmount",       Function: true },
    { Field: "Case when sum(isnull(TotalRetail, 0)) > 0 and sum(isnull(TotalCost, 0)) > 0 then ((sum(TotalRetail) - sum(TotalCost)) / sum(TotalRetail)) else 0 end", Label: "TotalMargin", Function: true },
    { Field: "sum(TotalRetail - TotalCost)", Label: "TotalMarginDollarAmount", Function: true },
    { Field: "case when sum(isnull([TotalSalesQuantity], 0)) = 0 then 0 else isnull(convert(float,sum(case when LoyaltyUsed = 1 then TotalSalesQuantity end)) / sum(isnull([TotalSalesQuantity], 0)), 0) end", Label: "LoyaltyUsedPercentage", Function: true },
    { Field: "isnull(sum(case when LoyaltyUsed = 1 then TotalSalesQuantity end),0)", Label: "LoyaltyTransactions", Function: true },
    { Field: "isnull(sum(case when PromotionUsed = 1 then TotalSalesQuantity end),0)", Label: "PromotionTransactions", Function: true },
  ];

  const allStoreFilter = {
    ...filter,
    Query_Filter: [
      { Field: "StoreName", Value: null },
      { Field: "SourceType", Value: null },
      { Field: "TransactionType", Value: "sql::1=1", Exclude: false, RequireAll: false },
    ],
  };

  return JSON.stringify({
    WidgetId: 695,
    Columns: columns,
    FilterBy: "",
    GroupBy: "Upc, Title, Category, Brand, StoreName, StoreId, StoreIdentifier",
    OverrideQueryView: "",
    OrderBy: "TotalSalesQuantity desc",
    Limit: 0,
    Filter: allStoreFilter,
    StaticTimeDimension: "",
  });
}

// ── Payment Type body (DataView 177, Widget 394 — all tenders) ───────────────
// Same shape used for DataView 426 / Widget 1113 (fuel-only tenders).

function paymentTypeBody(dataViewId, widgetId) {
  const columns = [
    { Field: "StoreId",          Label: "StoreId",          Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreName",        Label: "StoreName",        Function: true, FunctionType: "GroupByRequired" },
    { Field: "StoreIdentifier",  Label: "StoreIdentifier",  Function: true, FunctionType: "GroupByRequired" },
    { Field: "TaigaPaymentType", Label: "TaigaPaymentType", Function: true, FunctionType: "GroupByRequired" },
    { Field: "sum(TotalTenderAmount)",      Label: "TotalTenderAmount",      Function: true },
    { Field: "sum(TotalAmountOfCollected)", Label: "TotalAmountOfCollected", Function: true },
  ];
  return (filter) => JSON.stringify({
    WidgetId: widgetId,
    Columns: columns,
    FilterBy: "",
    GroupBy: "StoreName, StoreId, StoreIdentifier, TaigaPaymentType",
    OverrideQueryView: "",
    OrderBy: "sum(TotalTenderAmount) desc",
    Limit: 0,
    Filter: filter,
    StaticTimeDimension: "",
  });
}

const paymentTypeAllBody  = paymentTypeBody(177, 394);   // all transactions
const paymentTypeFuelBody = paymentTypeBody(426, 1113);  // fuel transactions only

// ── API calls ─────────────────────────────────────────────────────────────────

async function batchRequest(dataViewId, bodyStr, filterObj) {
  const payload = [{
    id: "GridResult",
    operation: "table-results",
    parameters: [
      { key: "DataViewId", value: dataViewId },
      { key: "Body", value: bodyStr },
      { key: "Filter", value: JSON.stringify(filterObj) },
    ],
  }];

  const res = await fetch(`${TAIGA_API}/data-view-batch`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const result = await res.json();
  if (result[0]?.exception) throw new Error(result[0].exception.split("\n")[0]);
  return result[0]?.value ?? [];
}

async function fetchStores() {
  const res = await fetch(`${TAIGA_API}/data-view/undefined/filter-distinct-results`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      Label: "Store", Field: "StoreName", FilterType: "Stores",
      OptionDisplayTemplate: "[##STOREIDENTIFIER##] ##STORENAME##",
      AdditionalFilterFields: [{ Field: "StoreIdentifier", FilterExact: true }],
      ExcludeThis: false, dataAggregationGroupId: 0,
    }),
  });
  if (!res.ok) throw new Error(`Store list failed: ${res.status}`);
  return await res.json();
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function upsertStores(stores) {
  if (!supabase) return;
  for (const s of stores) {
    const { error } = await supabase.from("stores").upsert(
      { store_id: slug(s.storeName), store_name: s.storeName },
      { onConflict: "store_id" }
    );
    if (error) log(`  WARN upsert store '${s.storeName}': ${error.message}`);
  }
}

async function upsertTransactionSummary(rows, dateRange) {
  if (!supabase) return 0;
  let n = 0;
  for (const r of rows) {
    if (!r.storeName) continue;
    const record = {
      store_id: slug(r.storeName), date_range: dateRange, store_number: String(r.storeIdentifier ?? ""),
      total_transactions: r.totalTransactions ?? null,
      sales_total:        r.adjustedSalesTotal ?? null,
      net_sales_volume:   r.netSalesVolume ?? null,
      total_sales_tax:    r.taxNetAmount ?? null,
      inside_sales:       r.adjustedTotalInstoreSales ?? null,
      inside_sales_wo_fuel: r.adjustedTotalInstoreSalesWithoutFuel ?? null,
      item_retail:        r.totalItemRetail ?? null,
      item_cost:          r.totalItemCost ?? null,
      total_margin:       r.totalMargin ?? null,
      fuel_sales:         r.fuelSales ?? null,
      fuel_transactions:  r.totalFuelTransactions ?? null,
      inside_transactions: r.totalInstoreTransactions ?? null,
      outside_transactions: r.totalOutsideTransactions ?? null,
      outside_sales:      r.totalOutsideSales ?? null,
      inside_nonfuel_transactions: r.totalInstoreNonFuelTransactions ?? null,
      inside_only_fuel_transactions: r.instoreFuelOnlyTransactions ?? null,
      inside_fuel_w_items_transactions: null, // derived: instoreFuel - instoreFuelOnly
      outside_fuel_transactions: r.outsideFuelTransactions ?? null,
      outside_fuel_sales: r.totalOutsideFuelSales ?? null,
      outside_only_fuel_transactions: r.outsideFuelOnlyTransactions ?? null,
      inside_fuel_sales:  r.totalInstoreFuelSales ?? null,
      gallons_pumped:     r.gallonsPumped ?? null,
      loyalty_usage_pct:  r.loyaltyUsedPercentage ?? null,
      promotion_usage_pct: r.promotionUsedPercentage ?? null,
      loyalty_transactions: r.loyaltyTransactions ?? null,
      promotion_transactions: r.promotionTransactions ?? null,
      fuel_retail:        r.totalFuelActualRetail && r.gallonsPumped ? r.totalFuelActualRetail / r.gallonsPumped : null,
      listed_fuel_retail: r.totalFuelListedRetail && r.gallonsPumped ? r.totalFuelListedRetail / r.gallonsPumped : null,
      fuel_cost:          r.totalFuelCost && r.gallonsPumped ? r.totalFuelCost / r.gallonsPumped : null,
      fuel_margin:        r.totalFuelActualMargin ?? null,
      listed_fuel_margin: r.totalFuelListedMargin ?? null,
      average_transaction_value: r.averageTransactionValue ?? null,
      average_transaction_value_wo_fuel: r.averageTransactionValueWithoutFuel ?? null,
      sq_footage: r.avgSquareFootage ?? null,
      sales_per_sq_ft: r.salesPerSquareFootPerTransaction ?? null,
      // Previously-dropped fields
      gross_amount:                 r.grossAmount ?? null,
      net_amount:                   r.netAmount ?? null,
      inside_fuel_transactions:     r.instoreFuelTransactions ?? null,
      total_fuel_only_transactions: r.totalFuelOnlyTransactions ?? null,
      total_fuel_actual_retail:     r.totalFuelActualRetail ?? null,
      total_fuel_listed_retail:     r.totalFuelListedRetail ?? null,
    };
    const { error } = await supabase.from("transaction_summary").upsert(record, { onConflict: "store_id,date_range" });
    if (error) log(`  SKIP tx [${record.store_id}/${dateRange}]: ${error.message}`);
    else n++;
  }
  return n;
}

async function upsertMerchandise(rows, dateRange) {
  if (!supabase) return 0;
  let n = 0;
  for (const r of rows) {
    if (!r.storeName || !r.brand) continue;
    const record = {
      store_id: slug(r.storeName), date_range: dateRange,
      brand: String(r.brand).trim(),
      units_sold:           r.totalSalesQuantity ?? null,
      total_sales_amount:   r.totalSalesAmount ?? r.totalRetail ?? null,
      total_margin:         r.totalMarginDollarAmount ?? null,
      // Previously-dropped fields
      total_unit_transactions: r.totalUnitTransactions ?? null,
      total_item_profit:       r.totalItemProfit ?? null,
      loyalty_usage_pct:       r.loyaltyUsedPercentage ?? null,
      loyalty_transactions:    r.loyaltyTransactions ?? null,
      promotion_transactions:  r.promotionTransactions ?? null,
    };
    const { error } = await supabase.from("merchandise_summary").upsert(record, { onConflict: "store_id,date_range,brand" });
    if (error) log(`  SKIP merch [${record.store_id}/${dateRange}/${r.brand}]: ${error.message}`);
    else n++;
  }
  return n;
}

const BATCH = 100;

async function batchUpsert(table, records, conflict) {
  if (!supabase) return 0;
  // Deduplicate by conflict key across the full array before batching.
  // Prevents "ON CONFLICT DO UPDATE command cannot affect row a second time"
  // which fires when a single INSERT batch contains duplicate conflict keys.
  const keyFields = conflict.split(",");
  const seen = new Map();
  for (const r of records) {
    seen.set(keyFields.map(f => r[f]).join("|"), r);
  }
  const deduped = [...seen.values()];
  if (deduped.length < records.length)
    log(`  dedup ${table}: ${records.length} → ${deduped.length}`);

  let n = 0;
  for (let i = 0; i < deduped.length; i += BATCH) {
    const chunk = deduped.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflict });
    if (error) log(`  WARN batch upsert ${table} [${i}-${i + chunk.length}]: ${error.message}`);
    else n += chunk.length;
  }
  return n;
}

const NUMERIC_DAILY_FIELDS = [
  "total_transactions","inside_transactions","outside_transactions","fuel_transactions",
  "inside_only_fuel_transactions","outside_only_fuel_transactions",
  "sales_total","net_sales_volume","total_sales_tax","gross_amount","net_amount",
  "inside_sales","inside_sales_wo_fuel","outside_sales","inside_fuel_sales","outside_fuel_sales",
  "item_retail","item_cost","fuel_sales","gallons_pumped",
  "total_fuel_actual_retail","total_fuel_listed_retail",
  "loyalty_transactions","promotion_transactions",
];

async function upsertTransactionDaily(rows, monthKey) {
  if (!supabase) return 0;

  // Deduplicate by store_id+business_date, summing numeric fields.
  // Taiga CUSTOM queries may return sub-daily rows (e.g. per-shift/register)
  // that share the same FormattedDate after .slice(0,10).
  const map = new Map();
  for (const r of rows) {
    if (!r.storeName || !r.formattedDate) continue;
    const bizDate = String(r.formattedDate).slice(0, 10);
    const key = `${slug(r.storeName)}|${bizDate}`;
    if (!map.has(key)) {
      map.set(key, {
        store_id: slug(r.storeName), business_date: bizDate, store_number: String(r.storeIdentifier ?? ""),
        total_transactions:   r.totalTransactions ?? 0,
        inside_transactions:  r.totalInstoreTransactions ?? 0,
        outside_transactions: r.totalOutsideTransactions ?? 0,
        fuel_transactions:    r.totalFuelTransactions ?? 0,
        inside_only_fuel_transactions:  r.instoreFuelOnlyTransactions ?? 0,
        outside_only_fuel_transactions: r.outsideFuelOnlyTransactions ?? 0,
        sales_total:          r.adjustedSalesTotal ?? 0,
        net_sales_volume:     r.netSalesVolume ?? 0,
        total_sales_tax:      r.taxNetAmount ?? 0,
        gross_amount:         r.grossAmount ?? 0,
        net_amount:           r.netAmount ?? 0,
        inside_sales:         r.adjustedTotalInstoreSales ?? 0,
        inside_sales_wo_fuel: r.adjustedTotalInstoreSalesWithoutFuel ?? 0,
        outside_sales:        r.totalOutsideSales ?? 0,
        inside_fuel_sales:    r.totalInstoreFuelSales ?? 0,
        outside_fuel_sales:   r.totalOutsideFuelSales ?? 0,
        item_retail:          r.totalItemRetail ?? 0,
        item_cost:            r.totalItemCost ?? 0,
        total_margin:         r.totalMargin ?? null,  // ratio — take last, not sum
        fuel_sales:           r.fuelSales ?? 0,
        gallons_pumped:       r.gallonsPumped ?? 0,
        fuel_margin:          r.totalFuelActualMargin ?? null,
        total_fuel_actual_retail: r.totalFuelActualRetail ?? 0,
        total_fuel_listed_retail: r.totalFuelListedRetail ?? 0,
        average_transaction_value:        r.averageTransactionValue ?? null,
        average_transaction_value_wo_fuel: r.averageTransactionValueWithoutFuel ?? null,
        sq_footage:           r.avgSquareFootage ?? null,
        sales_per_sq_ft:      r.salesPerSquareFootPerTransaction ?? null,
        loyalty_usage_pct:    r.loyaltyUsedPercentage ?? null,
        loyalty_transactions: r.loyaltyTransactions ?? 0,
        promotion_usage_pct:  r.promotionUsedPercentage ?? null,
        promotion_transactions: r.promotionTransactions ?? 0,
        _gallons_raw: r.gallonsPumped ?? 0,
        _fuel_actual_raw: r.totalFuelActualRetail ?? 0,
        _fuel_cost_raw: r.totalFuelCost ?? 0,
      });
    } else {
      const e = map.get(key);
      for (const f of NUMERIC_DAILY_FIELDS) e[f] = (e[f] ?? 0) + (r[f] ?? 0);
      e._gallons_raw     += (r.gallonsPumped ?? 0);
      e._fuel_actual_raw += (r.totalFuelActualRetail ?? 0);
      e._fuel_cost_raw   += (r.totalFuelCost ?? 0);
    }
  }

  const records = [...map.values()].map((e) => {
    const g = e._gallons_raw;
    const rec = { ...e };
    rec.fuel_retail = g > 0 ? e._fuel_actual_raw / g : null;
    rec.fuel_cost   = g > 0 ? e._fuel_cost_raw / g : null;
    delete rec._gallons_raw; delete rec._fuel_actual_raw; delete rec._fuel_cost_raw;
    return rec;
  });

  log(`  daily deduped: ${rows.length} → ${records.length} rows`);
  return batchUpsert("transaction_daily", records, "store_id,business_date");
}

async function upsertMerchandiseProduct(rows, dateRange) {
  if (!supabase) return 0;
  const records = [];
  for (const r of rows) {
    if (!r.storeName || !r.upc) continue;
    records.push({
      store_id:     slug(r.storeName),
      date_range:   dateRange,
      sku:          String(r.upc).trim(),
      product_name: r.title ? String(r.title).trim() : null,
      brand:        r.brand ? String(r.brand).trim() : null,
      category:     r.category ? String(r.category).trim() : null,
      units_sold:          r.totalSalesQuantity ?? null,
      total_sales_amount:  r.totalSalesAmount ?? null,
      total_cost:          r.totalCost ?? null,
      total_retail:        r.totalRetail ?? null,
      total_margin:        r.totalMargin ?? null,
      total_margin_dollars: r.totalMarginDollarAmount ?? null,
      loyalty_usage_pct:   r.loyaltyUsedPercentage ?? null,
      loyalty_transactions: r.loyaltyTransactions ?? null,
      promotion_transactions: r.promotionTransactions ?? null,
    });
  }
  return batchUpsert("merchandise_product", records, "store_id,date_range,sku");
}

async function upsertPaymentType(rows, dateRange, saleType) {
  if (!supabase) return 0;
  let n = 0;
  for (const r of rows) {
    if (!r.storeName || !r.taigaPaymentType) continue;
    const record = {
      store_id:        slug(r.storeName),
      date_range:      dateRange,
      sale_type:       saleType,
      payment_type:    String(r.taigaPaymentType).trim(),
      taiga_store_id:  r.storeId ?? null,
      tender_amount:   r.totalTenderAmount ?? null,
      collected_amount: r.totalAmountOfCollected ?? null,
    };
    const { error } = await supabase
      .from("payment_type_summary")
      .upsert(record, { onConflict: "store_id,date_range,sale_type,payment_type" });
    if (error) log(`  SKIP payment [${record.store_id}/${dateRange}/${saleType}/${record.payment_type}]: ${error.message}`);
    else n++;
  }
  return n;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const t0 = Date.now();
  await fs.mkdir(DL_DIR, { recursive: true });
  log("═══ Prince Oil Taiga Scraper — Start ═══");

  await authenticate();

  // Store list
  const stores = await fetchStores();
  log(`Stores (${stores.length}): ${stores.map((s) => s.storeName).join(", ")}`);
  await upsertStores(stores);
  await fs.writeFile(path.join(DL_DIR, "stores.json"), JSON.stringify(stores, null, 2));

  const ranges  = monthRanges(MONTHS_BACK);
  let txTotal = 0, dailyTotal = 0, merchTotal = 0, productTotal = 0, paymentTotal = 0;
  const errors = [];

  for (const range of ranges) {
    log(`\n── ${range.key} (${range.dimension}) ──`);
    await ensureAuth();

    const filter = timeFilter(range.dimension, range.start, range.end);

    // Transaction summary — monthly, all stores
    try {
      const rows = await batchRequest(113, txSummaryBody(filter), filter);
      log(`  tx rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `tx_summary__${range.key}.json`), JSON.stringify(rows, null, 2));
      txTotal += await upsertTransactionSummary(rows, range.key);
    } catch (e) {
      const msg = `tx [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }

    // Transaction daily — day-by-day, all stores
    try {
      const rows = await batchRequest(113, dailyTxBody(filter), filter);
      log(`  daily rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `tx_daily__${range.key}.json`), JSON.stringify(rows, null, 2));
      dailyTotal += await upsertTransactionDaily(rows, range.key);
    } catch (e) {
      const msg = `daily [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }

    // Merchandise summary — monthly, all stores × brand
    try {
      const rows = await batchRequest(145, merchBody(filter), filter);
      log(`  merch rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `merch__${range.key}.json`), JSON.stringify(rows, null, 2));
      merchTotal += await upsertMerchandise(rows, range.key);
    } catch (e) {
      const msg = `merch [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }

    // Merchandise product — monthly, all stores × SKU
    try {
      const rows = await batchRequest(145, productMerchBody(filter), filter);
      log(`  product rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `merch_product__${range.key}.json`), JSON.stringify(rows, null, 2));
      productTotal += await upsertMerchandiseProduct(rows, range.key);
    } catch (e) {
      const msg = `product [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }

    // Payment type summary — monthly, all transactions by tender type
    try {
      const rows = await batchRequest(177, paymentTypeAllBody(filter), filter);
      log(`  payment_all rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `payment_all__${range.key}.json`), JSON.stringify(rows, null, 2));
      paymentTotal += await upsertPaymentType(rows, range.key, "all");
    } catch (e) {
      const msg = `payment_all [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }

    // Payment type summary — monthly, fuel transactions only
    try {
      const rows = await batchRequest(426, paymentTypeFuelBody(filter), filter);
      log(`  payment_fuel rows: ${rows.length}`);
      await fs.writeFile(path.join(DL_DIR, `payment_fuel__${range.key}.json`), JSON.stringify(rows, null, 2));
      paymentTotal += await upsertPaymentType(rows, range.key, "fuel");
    } catch (e) {
      const msg = `payment_fuel [${range.key}]: ${e.message}`;
      log(`  ERROR: ${msg}`); errors.push(msg);
    }
  }

  if (supabase) {
    const { error: logErr } = await supabase.from("ingestion_log").insert({
      files_processed: ranges.length * 6,
      rows_inserted: txTotal + dailyTotal + merchTotal + productTotal + paymentTotal,
      rows_skipped: errors.length, errors: errors.join("\n") || null, duration_ms: Date.now() - t0,
    });
    if (logErr) log(`WARN ingestion_log: ${logErr.message}`);
  }

  log(`\n═══ Done — tx:${txTotal} daily:${dailyTotal} merch:${merchTotal} product:${productTotal} payment:${paymentTotal} errors:${errors.length} ═══`);
  if (errors.length) process.exitCode = 1;
}

run();
