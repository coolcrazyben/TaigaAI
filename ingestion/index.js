/**
 * Prince Oil — Taiga CSV Ingestion Script
 * Reads all CSVs from the downloads/ folder, cleans the data,
 * and upserts into Supabase tables: stores, transaction_summary, merchandise_summary.
 * Logs every run to ingestion_log.
 *
 * Usage:
 *   node ingestion/index.js
 *   node ingestion/index.js --dir path/to/csvs
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env" });

// ── Config ────────────────────────────────────────────────────────────────────

const DL_DIR = path.resolve(
  process.argv.includes("--dir")
    ? process.argv[process.argv.indexOf("--dir") + 1]
    : process.env.DOWNLOAD_DIR || "downloads"
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

/**
 * Strip currency symbols, commas, %, and cast to float.
 * Returns null if the value is empty / not numeric.
 */
function cleanNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/[$,%\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "n/a") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Parse filename: {store_id}__{view}__{date_range}.csv */
function parseFilename(filename) {
  const base = path.basename(filename, ".csv");
  const parts = base.split("__");
  if (parts.length < 3) return null;
  return {
    storeId:   parts[0],
    view:      parts[1],           // transaction_summary | merch_brand | merch_product
    dateRange: parts.slice(2).join("__"),  // e.g. 2026-05
  };
}

async function readCSV(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    });
  });
}

// ── Column Mapping: Transaction Summary ──────────────────────────────────────
// Maps CSV header → Supabase column name
// Taiga headers can vary slightly; we normalize them.

const TX_COLUMN_MAP = {
  "Store":                                    "store_number",
  "Store #":                                  "store_number",
  "Total Transactions":                       "total_transactions",
  "Total Transactions Change":                "total_transactions_change",
  "Inside Transactions":                      "inside_transactions",
  "Inside Transactions Change":               "inside_transactions_change",
  "Outside Transactions":                     "outside_transactions",
  "Outside Transactions Change":              "outside_transactions_change",
  "Sales Total":                              "sales_total",
  "Sales Total Change":                       "sales_total_change",
  "Net Sales Volume":                         "net_sales_volume",
  "Unit Sales":                               "unit_sales",
  "Unit Sales Change":                        "unit_sales_change",
  "Units Sold":                               "units_sold",
  "Units Sold Change":                        "units_sold_change",
  "Total Sales Tax":                          "total_sales_tax",
  "Total Sales Tax Change":                   "total_sales_tax_change",
  "Inside Sales":                             "inside_sales",
  "Inside Sales Change":                      "inside_sales_change",
  "Average Inside Sales":                     "average_inside_sales",
  "Inside Sales w/o Fuel":                   "inside_sales_wo_fuel",
  "Average Inside Sales w/o Fuel":           "average_inside_sales_wo_fuel",
  "Outside Sales":                            "outside_sales",
  "Average Transaction Value":               "average_transaction_value",
  "Average Transaction Value w/o Fuel":      "average_transaction_value_wo_fuel",
  "Sq Footage":                               "sq_footage",
  "Sales Per Sq Ft":                          "sales_per_sq_ft",
  "Inside Sales Per Sq Ft":                  "inside_sales_per_sq_ft",
  "Transaction $ Per Sq Ft":                 "transaction_per_sq_ft",
  "Item Retail":                              "item_retail",
  "Item Cost":                                "item_cost",
  "Total Margin":                             "total_margin",
  "Fuel Transactions":                        "fuel_transactions",
  "Fuel Sales":                               "fuel_sales",
  "Fuel Sales Change":                        "fuel_sales_change",
  "Only Fuel Transactions":                   "only_fuel_transactions",
  "Inside NonFuel Transactions":             "inside_nonfuel_transactions",
  "Inside Fuel Transactions Change":         "inside_fuel_transactions_change",
  "Inside Fuel w/ Items Transactions":       "inside_fuel_w_items_transactions",
  "Inside Only Fuel Transactions":           "inside_only_fuel_transactions",
  "Inside Only Fuel Transactions Change":    "inside_only_fuel_transactions_change",
  "Inside Fuel Sales":                        "inside_fuel_sales",
  "Outside Fuel Transactions":               "outside_fuel_transactions",
  "Outside Fuel Sales":                       "outside_fuel_sales",
  "Outside Only Fuel Transactions":          "outside_only_fuel_transactions",
  "Outside Only Fuel Transactions Change":   "outside_only_fuel_transactions_change",
  "Loyalty Usage %":                          "loyalty_usage_pct",
  "Loyalty Usage % Change":                  "loyalty_usage_pct_change",
  "Promotion Usage %":                        "promotion_usage_pct",
  "Loyalty Transactions":                    "loyalty_transactions",
  "Promotion Transactions":                  "promotion_transactions",
  "Total Profit":                             "total_profit",
  "Fuel Retail":                              "fuel_retail",
  "Listed Fuel Retail":                       "listed_fuel_retail",
  "Fuel Cost":                                "fuel_cost",
  "Fuel Margin":                              "fuel_margin",
  "Listed Fuel Margin":                       "listed_fuel_margin",
  "Gallons Pumped":                           "gallons_pumped",
  "Gallons Pumped Change":                    "gallons_pumped_change",
};

// Columns that hold percentage-change values (often stored as decimals like 0.05 for 5%)
const CHANGE_COLS = new Set([
  "total_transactions_change", "inside_transactions_change", "outside_transactions_change",
  "sales_total_change", "unit_sales_change", "units_sold_change", "total_sales_tax_change",
  "inside_sales_change", "fuel_sales_change", "inside_fuel_transactions_change",
  "inside_only_fuel_transactions_change", "outside_only_fuel_transactions_change",
  "loyalty_usage_pct_change", "gallons_pumped_change",
]);

// ── Upsert: stores ────────────────────────────────────────────────────────────

async function upsertStore(storeName) {
  const storeId = slug(storeName);
  const { error } = await supabase.from("stores").upsert(
    { store_id: storeId, store_name: storeName },
    { onConflict: "store_id" }
  );
  if (error) throw new Error(`upsert store '${storeName}': ${error.message}`);
  return storeId;
}

// ── Ingest: Transaction Summary ───────────────────────────────────────────────

async function ingestTransactionSummary(rows, storeId, dateRange, sourceFile) {
  if (rows.length === 0) return 0;
  // Transaction Summary may have one row per store, but sometimes has a summary row at top
  let inserted = 0;

  for (const row of rows) {
    // Determine store name from row (first column is usually store name)
    const rowStoreName = row["Store Name"] || row["Store"] || "";
    const rowStoreId   = rowStoreName ? slug(rowStoreName) : storeId;

    // Build the record
    const record = {
      store_id:   rowStoreId,
      date_range: dateRange,
      source_file: sourceFile,
    };

    for (const [csvHeader, dbCol] of Object.entries(TX_COLUMN_MAP)) {
      const raw = row[csvHeader];
      if (raw !== undefined) {
        record[dbCol] = cleanNum(raw);
      }
    }

    // Ensure the store exists
    const sName = rowStoreName || storeId;
    await upsertStore(sName || storeId).catch(() => {});

    const { error } = await supabase.from("transaction_summary").upsert(record, {
      onConflict: "store_id,date_range",
    });

    if (error) {
      log(`  SKIP row [${rowStoreId}/${dateRange}]: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return inserted;
}

// ── Ingest: Merchandise Summary ───────────────────────────────────────────────

async function ingestMerchandiseSummary(rows, storeId, dateRange, sourceFile) {
  if (rows.length === 0) return 0;
  let inserted = 0;

  for (const row of rows) {
    // Brand column — Taiga may call it "Brand", "Brand Name", "Category", etc.
    const brand =
      row["Brand"] || row["Brand Name"] || row["Category"] || row["brand"] || "Unknown";

    const record = {
      store_id:                 storeId,
      date_range:               dateRange,
      brand:                    String(brand).trim(),
      units_sold:               cleanNum(row["Units Sold"] || row["Unit Sales"] || row["Qty"]),
      units_sold_change:        cleanNum(row["Units Sold Change"] || row["Unit Sales Change"]),
      total_sales_amount:       cleanNum(row["Total Sales"] || row["Sales"] || row["Sales Amount"] || row["Total Sales Amount"]),
      total_sales_amount_change:cleanNum(row["Total Sales Change"] || row["Sales Change"]),
      total_margin:             cleanNum(row["Total Margin"] || row["Margin"]),
      source_file:              sourceFile,
    };

    const { error } = await supabase.from("merchandise_summary").upsert(record, {
      onConflict: "store_id,date_range,brand",
    });

    if (error) {
      log(`  SKIP merch row [${storeId}/${dateRange}/${brand}]: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return inserted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const startMs = Date.now();
  log("═══ Prince Oil Taiga Ingestion — Start ═══");
  log(`Reading CSVs from: ${DL_DIR}`);

  let files;
  try {
    files = (await fs.readdir(DL_DIR)).filter((f) => f.toLowerCase().endsWith(".csv"));
  } catch {
    log(`ERROR: Download directory not found: ${DL_DIR}. Run the scraper first.`);
    process.exit(1);
  }

  if (files.length === 0) {
    log("No CSV files found. Run the scraper first or place CSVs in downloads/.");
    return;
  }

  log(`Found ${files.length} CSV file(s).`);

  let totalInserted = 0;
  let totalSkipped  = 0;
  const errors = [];

  for (const filename of files) {
    const filePath = path.join(DL_DIR, filename);
    const meta = parseFilename(filename);

    if (!meta) {
      log(`SKIP ${filename} — unexpected filename format. Expected: storeid__view__daterange.csv`);
      totalSkipped++;
      continue;
    }

    log(`\nProcessing: ${filename}`);
    log(`  Store: ${meta.storeId} | View: ${meta.view} | Period: ${meta.dateRange}`);

    let rows;
    try {
      rows = await readCSV(filePath);
      log(`  Parsed ${rows.length} row(s).`);
    } catch (err) {
      const msg = `  ERROR reading ${filename}: ${err.message}`;
      log(msg);
      errors.push(msg);
      totalSkipped++;
      continue;
    }

    try {
      let inserted = 0;

      if (meta.view === "transaction_summary") {
        // Ensure store exists — store name comes from the CSV or filename
        const storeName = rows[0]?.["Store Name"] || rows[0]?.["Store"] || meta.storeId;
        await upsertStore(storeName || meta.storeId);
        inserted = await ingestTransactionSummary(rows, meta.storeId, meta.dateRange, filename);
      } else if (meta.view === "merch_brand" || meta.view === "merch_product") {
        const storeName = rows[0]?.["Store Name"] || rows[0]?.["Store"] || meta.storeId;
        await upsertStore(storeName || meta.storeId);
        inserted = await ingestMerchandiseSummary(rows, meta.storeId, meta.dateRange, filename);
      } else {
        log(`  SKIP — unknown view type: ${meta.view}`);
        totalSkipped++;
        continue;
      }

      log(`  Inserted/updated ${inserted} row(s).`);
      totalInserted += inserted;
    } catch (err) {
      const msg = `  ERROR ingesting ${filename}: ${err.message}`;
      log(msg);
      errors.push(msg);
      totalSkipped++;
    }
  }

  const durationMs = Date.now() - startMs;

  // ── Write ingestion_log ────────────────────────────────────────────────────
  const { error: logError } = await supabase.from("ingestion_log").insert({
    files_processed: files.length,
    rows_inserted:   totalInserted,
    rows_skipped:    totalSkipped,
    errors:          errors.length > 0 ? errors.join("\n") : null,
    duration_ms:     durationMs,
  });

  if (logError) log(`WARNING: Could not write ingestion_log: ${logError.message}`);

  log(`\n═══ Ingestion complete ═══`);
  log(`  Files: ${files.length} | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Duration: ${durationMs}ms`);
  if (errors.length > 0) {
    log(`  Errors (${errors.length}):`);
    errors.forEach((e) => log(`    ${e}`));
    process.exitCode = 1;
  }
}

run();
