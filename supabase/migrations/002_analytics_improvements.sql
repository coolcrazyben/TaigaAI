-- Migration 002: Analytics Improvements
-- Adds: period_start date column, implied price columns, new indexes,
--       sku_price_history view, and updated network_averages view.
-- Guiding rule: ADDITIVE ONLY — no column drops, no constraint changes, no data loss.
-- Safe to re-run: all statements use IF NOT EXISTS / CREATE OR REPLACE.

-- ─────────────────────────────────────────────
-- Step 1 — Add period_start date column (enables proper range queries)
-- ─────────────────────────────────────────────

ALTER TABLE merchandise_product
  ADD COLUMN IF NOT EXISTS period_start date;

ALTER TABLE transaction_summary
  ADD COLUMN IF NOT EXISTS period_start date;

-- Backfill: handle both "YYYY-MM" and "YYYY-MM-DD to YYYY-MM-DD" formats
-- Format 1: "YYYY-MM" → append "-01" to get first of month
UPDATE merchandise_product
  SET period_start = (date_range || '-01')::date
  WHERE period_start IS NULL AND date_range ~ '^\d{4}-\d{2}$';

UPDATE transaction_summary
  SET period_start = (date_range || '-01')::date
  WHERE period_start IS NULL AND date_range ~ '^\d{4}-\d{2}$';

-- Format 2: "YYYY-MM-DD to YYYY-MM-DD" → first token is the start date
UPDATE merchandise_product
  SET period_start = (split_part(date_range, ' ', 1))::date
  WHERE period_start IS NULL AND date_range ~ '^\d{4}-\d{2}-\d{2}';

UPDATE transaction_summary
  SET period_start = (split_part(date_range, ' ', 1))::date
  WHERE period_start IS NULL AND date_range ~ '^\d{4}-\d{2}-\d{2}';

-- ─────────────────────────────────────────────
-- Step 2 — Add implied price columns to merchandise_product
-- ─────────────────────────────────────────────

ALTER TABLE merchandise_product
  ADD COLUMN IF NOT EXISTS implied_unit_retail  numeric(10,4),
  ADD COLUMN IF NOT EXISTS implied_unit_cost    numeric(10,4);

-- Backfill existing rows
UPDATE merchandise_product SET
  implied_unit_retail = CASE WHEN units_sold > 0
    THEN ROUND(total_sales_amount / units_sold, 4) END,
  implied_unit_cost = CASE WHEN units_sold > 0
    THEN ROUND((total_sales_amount - total_margin_dollars) / units_sold, 4) END
WHERE implied_unit_retail IS NULL;

-- Trigger function: auto-compute implied prices on future inserts/updates
CREATE OR REPLACE FUNCTION compute_implied_prices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.implied_unit_retail := CASE WHEN NEW.units_sold > 0
    THEN ROUND(NEW.total_sales_amount / NEW.units_sold, 4) END;
  NEW.implied_unit_cost := CASE WHEN NEW.units_sold > 0
    THEN ROUND((NEW.total_sales_amount - NEW.total_margin_dollars) / NEW.units_sold, 4) END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_merch_implied_prices
  BEFORE INSERT OR UPDATE ON merchandise_product
  FOR EACH ROW EXECUTE FUNCTION compute_implied_prices();

-- ─────────────────────────────────────────────
-- Step 3 — Add missing indexes
-- ─────────────────────────────────────────────

-- Enables category-filtered queries
CREATE INDEX IF NOT EXISTS idx_mp_category
  ON merchandise_product (category);

-- Enables efficient store + period range queries
CREATE INDEX IF NOT EXISTS idx_mp_store_period
  ON merchandise_product (store_id, period_start);

-- Enables SKU history per store (time-series)
CREATE INDEX IF NOT EXISTS idx_mp_sku_period
  ON merchandise_product (sku, period_start);

-- Enables cross-store comparisons on transaction_summary
CREATE INDEX IF NOT EXISTS idx_ts_store_period
  ON transaction_summary (store_id, period_start);

-- Enables daily queries scoped to store + date window
CREATE INDEX IF NOT EXISTS idx_td_store_bdate
  ON transaction_daily (store_id, business_date);

-- ─────────────────────────────────────────────
-- Step 4 — Add sku_price_history view
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW sku_price_history
  WITH (security_invoker = true)
AS
SELECT
  sku,
  product_name,
  brand,
  category,
  store_id,
  date_range,
  period_start,
  units_sold,
  total_sales_amount,
  implied_unit_retail,
  implied_unit_cost,
  LAG(implied_unit_retail) OVER w  AS prev_retail,
  implied_unit_retail
    - LAG(implied_unit_retail) OVER w AS retail_change,
  implied_unit_cost
    - LAG(implied_unit_cost) OVER w  AS cost_change
FROM merchandise_product
WHERE units_sold > 0
  AND implied_unit_retail IS NOT NULL
WINDOW w AS (PARTITION BY sku, store_id ORDER BY period_start);

-- ─────────────────────────────────────────────
-- Step 5 — Expose period_start in network_averages
-- ─────────────────────────────────────────────

DROP VIEW IF EXISTS network_averages;
CREATE VIEW network_averages
  WITH (security_invoker = true)
AS
SELECT
  date_range,
  period_start,
  avg(total_transactions)         AS avg_total_transactions,
  avg(sales_total)                AS avg_sales_total,
  avg(total_margin)               AS avg_total_margin,
  round(avg(total_margin)*100,2)  AS avg_margin_pct,
  avg(inside_sales)               AS avg_inside_sales,
  avg(inside_sales_wo_fuel)       AS avg_inside_sales_wo_fuel,
  avg(outside_sales)              AS avg_outside_sales,
  avg(fuel_margin)                AS avg_fuel_margin,
  avg(gallons_pumped)             AS avg_gallons_pumped,
  avg(loyalty_usage_pct)          AS avg_loyalty_usage_pct,
  avg(promotion_usage_pct)        AS avg_promotion_usage_pct,
  count(*)                        AS store_count
FROM transaction_summary
GROUP BY date_range, period_start;
