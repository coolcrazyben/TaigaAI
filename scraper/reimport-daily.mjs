/**
 * Re-imports transaction_daily from already-downloaded JSON files in downloads/.
 * Use after a scrape run that failed daily upserts due to duplicate rows.
 *
 * Usage:
 *   node scraper/reimport-daily.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env" });

const DL_DIR = path.resolve(process.env.DOWNLOAD_DIR || "downloads");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("FATAL: Supabase env vars missing"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const NUMERIC_FIELDS = [
  "total_transactions","inside_transactions","outside_transactions","fuel_transactions",
  "inside_only_fuel_transactions","outside_only_fuel_transactions",
  "sales_total","net_sales_volume","total_sales_tax","gross_amount","net_amount",
  "inside_sales","inside_sales_wo_fuel","outside_sales","inside_fuel_sales","outside_fuel_sales",
  "item_retail","item_cost","fuel_sales","gallons_pumped",
  "total_fuel_actual_retail","total_fuel_listed_retail",
  "loyalty_transactions","promotion_transactions",
];

function buildRecords(rows) {
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
        total_margin:         r.totalMargin ?? null,
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
      for (const f of NUMERIC_FIELDS) e[f] = (e[f] ?? 0) + (r[f] ?? 0);
      e._gallons_raw     += (r.gallonsPumped ?? 0);
      e._fuel_actual_raw += (r.totalFuelActualRetail ?? 0);
      e._fuel_cost_raw   += (r.totalFuelCost ?? 0);
    }
  }
  return [...map.values()].map((e) => {
    const g = e._gallons_raw;
    const rec = { ...e };
    rec.fuel_retail = g > 0 ? e._fuel_actual_raw / g : null;
    rec.fuel_cost   = g > 0 ? e._fuel_cost_raw / g : null;
    delete rec._gallons_raw; delete rec._fuel_actual_raw; delete rec._fuel_cost_raw;
    return rec;
  });
}

async function batchUpsert(records) {
  const BATCH = 100;
  let n = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await supabase.from("transaction_daily").upsert(chunk, { onConflict: "store_id,business_date" });
    if (error) console.error(`  WARN [${i}-${i+chunk.length}]: ${error.message}`);
    else n += chunk.length;
  }
  return n;
}

async function run() {
  const files = (await fs.readdir(DL_DIR))
    .filter((f) => f.startsWith("tx_daily__") && f.endsWith(".json"))
    .sort();

  if (files.length === 0) { console.error("No tx_daily__*.json files found in", DL_DIR); process.exit(1); }

  console.log(`Found ${files.length} daily files: ${files.join(", ")}`);
  let total = 0;

  for (const file of files) {
    const monthKey = file.replace("tx_daily__", "").replace(".json", "");
    const raw = JSON.parse(await fs.readFile(path.join(DL_DIR, file), "utf8"));
    const records = buildRecords(raw);
    console.log(`${monthKey}: ${raw.length} raw → ${records.length} deduped rows`);
    const n = await batchUpsert(records);
    console.log(`  upserted: ${n}`);
    total += n;
  }

  console.log(`\nDone — total upserted: ${total}`);
}

run();
