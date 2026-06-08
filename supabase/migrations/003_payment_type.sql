-- Payment type summary table
-- sale_type = 'all'  → DataView 177: all transactions by tender type (fuel + inside combined)
-- sale_type = 'fuel' → DataView 426: fuel-only transactions by tender type
-- Inside/merch tender = all - fuel (calculated in application layer)

CREATE TABLE IF NOT EXISTS payment_type_summary (
  store_id          text NOT NULL REFERENCES stores(store_id),
  date_range        text NOT NULL,
  sale_type         text NOT NULL CHECK (sale_type IN ('all', 'fuel')),
  payment_type      text NOT NULL,
  taiga_store_id    integer,
  tender_amount     numeric(14,2),
  collected_amount  numeric(14,2),
  created_at        timestamptz DEFAULT now(),
  PRIMARY KEY (store_id, date_range, sale_type, payment_type)
);

CREATE INDEX IF NOT EXISTS idx_pts_store_period ON payment_type_summary (store_id, date_range);
CREATE INDEX IF NOT EXISTS idx_pts_payment_type ON payment_type_summary (payment_type);
CREATE INDEX IF NOT EXISTS idx_pts_sale_type    ON payment_type_summary (sale_type, date_range);
