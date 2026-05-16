-- Prince Oil Analytics Platform — Supabase Schema
-- Run this entire file in the Supabase SQL Editor before using the platform.
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.

-- ─────────────────────────────────────────────
-- 1. Stores
-- ─────────────────────────────────────────────
create table if not exists stores (
  store_id   text primary key,   -- e.g. "newton_junction"
  store_name text not null unique
);

-- ─────────────────────────────────────────────
-- 2. Transaction Summary  (one row per store × date range)
-- Matches the Taiga "Transaction Summary" CSV export column-for-column.
-- All dollar/count/pct fields are numeric so math works in SQL.
-- ─────────────────────────────────────────────
create table if not exists transaction_summary (
  id                                        bigserial primary key,
  store_id                                  text        not null references stores(store_id),
  date_range                                text        not null,   -- e.g. "2026-05-01 to 2026-05-31"
  -- Identity
  store_number                              text,
  -- Transaction counts
  total_transactions                        numeric(14,2),
  total_transactions_change                 numeric(14,4),
  inside_transactions                       numeric(14,2),
  inside_transactions_change                numeric(14,4),
  outside_transactions                      numeric(14,2),
  outside_transactions_change               numeric(14,4),
  -- Sales totals
  sales_total                               numeric(14,2),
  sales_total_change                        numeric(14,4),
  net_sales_volume                          numeric(14,2),
  unit_sales                                numeric(14,2),
  unit_sales_change                         numeric(14,4),
  units_sold                                numeric(14,2),
  units_sold_change                         numeric(14,4),
  total_sales_tax                           numeric(14,2),
  total_sales_tax_change                    numeric(14,4),
  -- Inside sales
  inside_sales                              numeric(14,2),
  inside_sales_change                       numeric(14,4),
  average_inside_sales                      numeric(14,4),
  inside_sales_wo_fuel                      numeric(14,2),
  average_inside_sales_wo_fuel              numeric(14,4),
  -- Outside sales
  outside_sales                             numeric(14,2),
  average_transaction_value                 numeric(14,4),
  average_transaction_value_wo_fuel         numeric(14,4),
  -- Sq footage
  sq_footage                                numeric(14,2),
  sales_per_sq_ft                           numeric(14,4),
  inside_sales_per_sq_ft                    numeric(14,4),
  transaction_per_sq_ft                     numeric(14,4),
  -- Margin
  item_retail                               numeric(14,2),
  item_cost                                 numeric(14,2),
  total_margin                              numeric(14,2),
  -- Fuel — general
  fuel_transactions                         numeric(14,2),
  fuel_sales                                numeric(14,2),
  fuel_sales_change                         numeric(14,4),
  only_fuel_transactions                    numeric(14,2),
  -- Inside fuel
  inside_nonfuel_transactions               numeric(14,2),
  inside_fuel_transactions_change           numeric(14,4),
  inside_fuel_w_items_transactions          numeric(14,2),
  inside_only_fuel_transactions             numeric(14,2),
  inside_only_fuel_transactions_change      numeric(14,4),
  inside_fuel_sales                         numeric(14,2),
  -- Outside fuel
  outside_fuel_transactions                 numeric(14,2),
  outside_fuel_sales                        numeric(14,2),
  outside_only_fuel_transactions            numeric(14,2),
  outside_only_fuel_transactions_change     numeric(14,4),
  -- Loyalty / Promotion
  loyalty_usage_pct                         numeric(8,4),
  loyalty_usage_pct_change                  numeric(8,4),
  promotion_usage_pct                       numeric(8,4),
  loyalty_transactions                      numeric(14,2),
  promotion_transactions                    numeric(14,2),
  -- Fuel pricing
  total_profit                              numeric(14,2),
  fuel_retail                               numeric(10,4),
  listed_fuel_retail                        numeric(10,4),
  fuel_cost                                 numeric(10,4),
  fuel_margin                               numeric(10,4),
  listed_fuel_margin                        numeric(10,4),
  gallons_pumped                            numeric(14,2),
  gallons_pumped_change                     numeric(14,4),
  -- Audit
  ingested_at                               timestamptz not null default now(),
  source_file                               text,

  unique (store_id, date_range)
);

-- ─────────────────────────────────────────────
-- 3. Merchandise Summary  (one row per store × date range × brand)
-- ─────────────────────────────────────────────
create table if not exists merchandise_summary (
  id                          bigserial primary key,
  store_id                    text        not null references stores(store_id),
  date_range                  text        not null,
  brand                       text        not null,
  units_sold                  numeric(14,2),
  units_sold_change           numeric(14,4),
  total_sales_amount          numeric(14,2),
  total_sales_amount_change   numeric(14,4),
  total_margin                numeric(14,2),
  -- Audit
  ingested_at                 timestamptz not null default now(),
  source_file                 text,

  unique (store_id, date_range, brand)
);

-- ─────────────────────────────────────────────
-- 4. Ingestion Log
-- ─────────────────────────────────────────────
create table if not exists ingestion_log (
  id              bigserial primary key,
  run_at          timestamptz not null default now(),
  files_processed integer     not null default 0,
  rows_inserted   integer     not null default 0,
  rows_skipped    integer     not null default 0,
  errors          text,
  duration_ms     integer
);

-- ─────────────────────────────────────────────
-- 5. Alter existing tables — add previously-dropped fields (idempotent)
-- ─────────────────────────────────────────────
alter table transaction_summary
  add column if not exists gross_amount                numeric(14,2),
  add column if not exists net_amount                  numeric(14,2),
  add column if not exists inside_fuel_transactions    numeric(14,2),
  add column if not exists total_fuel_only_transactions numeric(14,2),
  add column if not exists total_fuel_actual_retail    numeric(14,2),
  add column if not exists total_fuel_listed_retail    numeric(14,2);

alter table merchandise_summary
  add column if not exists total_unit_transactions  numeric(14,2),
  add column if not exists total_item_profit        numeric(14,2),
  add column if not exists loyalty_usage_pct        numeric(8,4),
  add column if not exists loyalty_transactions     numeric(14,2),
  add column if not exists promotion_transactions   numeric(14,2);

-- ─────────────────────────────────────────────
-- 6. Transaction Daily  (one row per store × business date)
-- ─────────────────────────────────────────────
create table if not exists transaction_daily (
  id                            bigserial primary key,
  store_id                      text        not null references stores(store_id),
  business_date                 date        not null,
  store_number                  text,
  -- Transaction counts
  total_transactions            numeric(14,2),
  inside_transactions           numeric(14,2),
  outside_transactions          numeric(14,2),
  fuel_transactions             numeric(14,2),
  inside_only_fuel_transactions numeric(14,2),
  outside_only_fuel_transactions numeric(14,2),
  -- Sales totals
  sales_total                   numeric(14,2),
  net_sales_volume              numeric(14,2),
  total_sales_tax               numeric(14,2),
  gross_amount                  numeric(14,2),
  net_amount                    numeric(14,2),
  -- Inside / outside sales
  inside_sales                  numeric(14,2),
  inside_sales_wo_fuel          numeric(14,2),
  outside_sales                 numeric(14,2),
  inside_fuel_sales             numeric(14,2),
  outside_fuel_sales            numeric(14,2),
  -- Margin / cost
  item_retail                   numeric(14,2),
  item_cost                     numeric(14,2),
  total_margin                  numeric(14,4),
  total_profit                  numeric(14,2),
  -- Fuel
  fuel_sales                    numeric(14,2),
  gallons_pumped                numeric(14,2),
  fuel_retail                   numeric(10,4),
  fuel_cost                     numeric(10,4),
  fuel_margin                   numeric(10,4),
  total_fuel_actual_retail      numeric(14,2),
  total_fuel_listed_retail      numeric(14,2),
  -- Value / sq footage
  average_transaction_value     numeric(14,4),
  average_transaction_value_wo_fuel numeric(14,4),
  sq_footage                    numeric(14,2),
  sales_per_sq_ft               numeric(14,4),
  -- Loyalty / Promotion
  loyalty_usage_pct             numeric(8,4),
  loyalty_transactions          numeric(14,2),
  promotion_usage_pct           numeric(8,4),
  promotion_transactions        numeric(14,2),
  -- Audit
  ingested_at                   timestamptz not null default now(),
  source_file                   text,

  unique (store_id, business_date)
);

-- ─────────────────────────────────────────────
-- 7. Merchandise Product  (one row per store × date_range × SKU)
-- ─────────────────────────────────────────────
create table if not exists merchandise_product (
  id                    bigserial primary key,
  store_id              text        not null references stores(store_id),
  date_range            text        not null,
  sku                   text        not null,
  product_name          text,
  brand                 text,
  category              text,
  units_sold            numeric(14,2),
  total_sales_amount    numeric(14,2),
  total_cost            numeric(14,2),
  total_retail          numeric(14,2),
  total_margin          numeric(14,4),
  total_margin_dollars  numeric(14,2),
  loyalty_usage_pct     numeric(8,4),
  loyalty_transactions  numeric(14,2),
  promotion_transactions numeric(14,2),
  -- Audit
  ingested_at           timestamptz not null default now(),
  source_file           text,

  unique (store_id, date_range, sku)
);

-- ─────────────────────────────────────────────
-- 8. Indexes for common analytics queries
-- ─────────────────────────────────────────────
create index if not exists idx_ts_store        on transaction_summary (store_id);
create index if not exists idx_ts_date         on transaction_summary (date_range);
create index if not exists idx_ms_store        on merchandise_summary (store_id);
create index if not exists idx_ms_date         on merchandise_summary (date_range);
create index if not exists idx_ms_brand        on merchandise_summary (brand);
create index if not exists idx_td_store        on transaction_daily (store_id);
create index if not exists idx_td_date         on transaction_daily (business_date);
create index if not exists idx_mp_store        on merchandise_product (store_id);
create index if not exists idx_mp_date         on merchandise_product (date_range);
create index if not exists idx_mp_sku          on merchandise_product (sku);
-- Analytics improvement indexes (migration 002)
create index if not exists idx_mp_category     on merchandise_product (category);
create index if not exists idx_mp_store_period on merchandise_product (store_id, period_start);
create index if not exists idx_mp_sku_period   on merchandise_product (sku, period_start);
create index if not exists idx_ts_store_period on transaction_summary (store_id, period_start);
create index if not exists idx_td_store_bdate  on transaction_daily (store_id, business_date);

-- ─────────────────────────────────────────────
-- 9. Analytics improvements — additive columns (migration 002)
-- ─────────────────────────────────────────────

-- period_start: enables proper date range queries (parsed from date_range text)
alter table merchandise_product
  add column if not exists period_start        date,
  add column if not exists implied_unit_retail numeric(10,4),
  add column if not exists implied_unit_cost   numeric(10,4);

alter table transaction_summary
  add column if not exists period_start date;

-- Backfill period_start — handle both "YYYY-MM" and "YYYY-MM-DD to YYYY-MM-DD" formats
-- Format 1: "YYYY-MM" → append "-01" to get first of month
update merchandise_product
  set period_start = (date_range || '-01')::date
  where period_start is null and date_range ~ '^\d{4}-\d{2}$';

update transaction_summary
  set period_start = (date_range || '-01')::date
  where period_start is null and date_range ~ '^\d{4}-\d{2}$';

-- Format 2: "YYYY-MM-DD to YYYY-MM-DD" → first token is the start date
update merchandise_product
  set period_start = (split_part(date_range, ' ', 1))::date
  where period_start is null and date_range ~ '^\d{4}-\d{2}-\d{2}';

update transaction_summary
  set period_start = (split_part(date_range, ' ', 1))::date
  where period_start is null and date_range ~ '^\d{4}-\d{2}-\d{2}';

-- Backfill implied prices from existing aggregates
update merchandise_product set
  implied_unit_retail = case when units_sold > 0
    then round(total_sales_amount / units_sold, 4) end,
  implied_unit_cost = case when units_sold > 0
    then round((total_sales_amount - total_margin_dollars) / units_sold, 4) end
where implied_unit_retail is null;

-- Trigger: auto-compute implied prices on future inserts/updates
create or replace function compute_implied_prices()
returns trigger language plpgsql as $$
begin
  new.implied_unit_retail := case when new.units_sold > 0
    then round(new.total_sales_amount / new.units_sold, 4) end;
  new.implied_unit_cost := case when new.units_sold > 0
    then round((new.total_sales_amount - new.total_margin_dollars) / new.units_sold, 4) end;
  return new;
end;
$$;

create or replace trigger trg_merch_implied_prices
  before insert or update on merchandise_product
  for each row execute function compute_implied_prices();

-- ─────────────────────────────────────────────
-- 10. Views
-- ─────────────────────────────────────────────

-- SKU price history: month-over-month implied price deltas per SKU per store
create or replace view sku_price_history
  with (security_invoker = true)
as
select
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
  lag(implied_unit_retail) over w  as prev_retail,
  implied_unit_retail
    - lag(implied_unit_retail) over w as retail_change,
  implied_unit_cost
    - lag(implied_unit_cost) over w  as cost_change
from merchandise_product
where units_sold > 0
  and implied_unit_retail is not null
window w as (partition by sku, store_id order by period_start);

-- Network averages: benchmark KPIs across all stores per period
drop view if exists network_averages;
create view network_averages
  with (security_invoker = true)
as
select
  date_range,
  period_start,
  avg(total_transactions)         as avg_total_transactions,
  avg(sales_total)                as avg_sales_total,
  avg(total_margin)               as avg_total_margin,
  round(avg(total_margin) * 100, 2) as avg_margin_pct,
  avg(inside_sales)               as avg_inside_sales,
  avg(inside_sales_wo_fuel)       as avg_inside_sales_wo_fuel,
  avg(outside_sales)              as avg_outside_sales,
  avg(fuel_margin)                as avg_fuel_margin,
  avg(gallons_pumped)             as avg_gallons_pumped,
  avg(loyalty_usage_pct)          as avg_loyalty_usage_pct,
  avg(promotion_usage_pct)        as avg_promotion_usage_pct,
  count(*)                        as store_count
from transaction_summary
group by date_range, period_start;
