create extension if not exists pgcrypto;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  region text,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  parent_id uuid references categories(id),
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  product_name text not null,
  normalized_name text not null,
  brand text,
  category_id uuid references categories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid not null default gen_random_uuid(),
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  business_date date not null,
  transaction_id text,
  quantity numeric(14, 4) not null,
  unit_price numeric(14, 4),
  unit_cost numeric(14, 4),
  sales_amount numeric(14, 4) not null,
  cost_amount numeric(14, 4),
  margin_amount numeric(14, 4) generated always as (sales_amount - coalesce(cost_amount, 0)) stored,
  source_file text,
  created_at timestamptz not null default now(),
  primary key (id, business_date)
) partition by range (business_date);

create table if not exists transactions_default partition of transactions default;

create table if not exists daily_aggregates (
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  category_id uuid references categories(id),
  business_date date not null,
  units numeric(14, 4) not null default 0,
  sales numeric(14, 4) not null default 0,
  cost numeric(14, 4) not null default 0,
  margin numeric(14, 4) not null default 0,
  transaction_count integer not null default 0,
  primary key (store_id, product_id, business_date)
);

create table if not exists pricing_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  effective_date date not null,
  unit_price numeric(14, 4) not null,
  unit_cost numeric(14, 4),
  source text not null default 'taiga',
  created_at timestamptz not null default now(),
  unique (store_id, product_id, effective_date, unit_price)
);

create table if not exists elasticity_metrics (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id),
  product_id uuid references products(id),
  category_id uuid references categories(id),
  brand text,
  elasticity numeric(10, 4) not null,
  observation_count integer not null default 0,
  confidence numeric(10, 4) not null default 0,
  method text not null default 'historical_price_change',
  computed_at timestamptz not null default now(),
  unique (store_id, product_id, category_id, brand, method)
);

create table if not exists ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_file text,
  status text not null default 'running',
  inserted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_transactions_store_date on transactions (store_id, business_date);
create index if not exists idx_transactions_product_date on transactions (product_id, business_date);
create index if not exists idx_transactions_transaction_id on transactions (transaction_id);
create index if not exists idx_daily_date_store on daily_aggregates (business_date, store_id);
create index if not exists idx_daily_category_date on daily_aggregates (category_id, business_date);
create index if not exists idx_products_category on products (category_id);
create index if not exists idx_products_brand on products (brand);
create index if not exists idx_pricing_lookup on pricing_history (store_id, product_id, effective_date desc);
create index if not exists idx_elasticity_lookup on elasticity_metrics (store_id, product_id, category_id, brand);

create or replace function normalize_key(value text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function ingest_taiga_rows(p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  row jsonb;
  v_store_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_inserted integer := 0;
  v_rejected integer := 0;
begin
  for row in select * from jsonb_array_elements(p_rows)
  loop
    begin
      insert into stores (name, normalized_name)
      values (trim(row->>'store_name'), normalize_key(row->>'store_name'))
      on conflict (normalized_name) do update set name = excluded.name
      returning id into v_store_id;

      insert into categories (name, normalized_name)
      values (coalesce(nullif(trim(row->>'category'), ''), 'Uncategorized'), normalize_key(coalesce(nullif(row->>'category', ''), 'Uncategorized')))
      on conflict (normalized_name) do update set name = excluded.name
      returning id into v_category_id;

      insert into products (sku, product_name, normalized_name, brand, category_id, updated_at)
      values (
        trim(row->>'sku'),
        trim(row->>'product_name'),
        normalize_key(row->>'product_name'),
        nullif(trim(coalesce(row->>'brand', '')), ''),
        v_category_id,
        now()
      )
      on conflict (sku) do update set
        product_name = excluded.product_name,
        normalized_name = excluded.normalized_name,
        brand = coalesce(excluded.brand, products.brand),
        category_id = excluded.category_id,
        updated_at = now()
      returning id into v_product_id;

      insert into transactions (
        store_id, product_id, business_date, transaction_id, quantity, unit_price, unit_cost, sales_amount, cost_amount
      )
      values (
        v_store_id,
        v_product_id,
        (row->>'business_date')::date,
        nullif(row->>'transaction_id', ''),
        (row->>'quantity')::numeric,
        nullif(row->>'unit_price', '')::numeric,
        nullif(row->>'unit_cost', '')::numeric,
        (row->>'sales_amount')::numeric,
        nullif(row->>'cost_amount', '')::numeric
      );

      if row ? 'unit_price' and nullif(row->>'unit_price', '') is not null then
        insert into pricing_history (store_id, product_id, effective_date, unit_price, unit_cost)
        values (
          v_store_id,
          v_product_id,
          (row->>'business_date')::date,
          (row->>'unit_price')::numeric,
          nullif(row->>'unit_cost', '')::numeric
        )
        on conflict do nothing;
      end if;

      v_inserted := v_inserted + 1;
    exception when others then
      v_rejected := v_rejected + 1;
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'rejected', v_rejected);
end;
$$;

create or replace function refresh_daily_aggregates()
returns void
language sql
security definer
as $$
  insert into daily_aggregates (store_id, product_id, category_id, business_date, units, sales, cost, margin, transaction_count)
  select
    t.store_id,
    t.product_id,
    p.category_id,
    t.business_date,
    sum(t.quantity),
    sum(t.sales_amount),
    sum(coalesce(t.cost_amount, 0)),
    sum(t.margin_amount),
    count(*)
  from transactions t
  join products p on p.id = t.product_id
  group by t.store_id, t.product_id, p.category_id, t.business_date
  on conflict (store_id, product_id, business_date) do update set
    category_id = excluded.category_id,
    units = excluded.units,
    sales = excluded.sales,
    cost = excluded.cost,
    margin = excluded.margin,
    transaction_count = excluded.transaction_count;
$$;

create or replace function dashboard_summary(p_store_id uuid default null, p_start_date date default null, p_end_date date default null)
returns jsonb
language sql
stable
security definer
as $$
with base as (
  select da.*, s.name store_name, p.sku, p.product_name, c.name category_name
  from daily_aggregates da
  join stores s on s.id = da.store_id
  join products p on p.id = da.product_id
  left join categories c on c.id = da.category_id
  where (p_store_id is null or da.store_id = p_store_id)
    and (p_start_date is null or da.business_date >= p_start_date)
    and (p_end_date is null or da.business_date <= p_end_date)
),
kpis as (
  select
    coalesce(sum(sales), 0) total_sales,
    coalesce(sum(margin), 0) total_margin,
    case when sum(sales) = 0 then 0 else sum(margin) / sum(sales) * 100 end margin_pct,
    coalesce(sum(transaction_count), 0) transaction_count,
    coalesce(sum(units), 0) unit_count,
    count(distinct product_id) filter (where margin < 0) negative_margin_skus
  from base
)
select jsonb_build_object(
  'kpis', (select to_jsonb(kpis) from kpis),
  'salesTrend', coalesce((select jsonb_agg(to_jsonb(x) order by x.business_date) from (
    select business_date, sum(sales) sales, sum(margin) margin from base group by business_date order by business_date desc limit 120
  ) x), '[]'::jsonb),
  'topProducts', coalesce((select jsonb_agg(to_jsonb(x)) from (
    select sku, product_name, sum(sales) sales, sum(margin) margin, sum(units) units from base group by sku, product_name order by sales desc limit 10
  ) x), '[]'::jsonb),
  'categoryPerformance', coalesce((select jsonb_agg(to_jsonb(x)) from (
    select coalesce(category_name, 'Uncategorized') category_name, sum(sales) sales, sum(margin) margin,
      case when sum(sales) = 0 then 0 else sum(margin) / sum(sales) * 100 end margin_pct
    from base group by category_name order by sales desc limit 10
  ) x), '[]'::jsonb),
  'storeComparison', coalesce((select jsonb_agg(to_jsonb(x)) from (
    select store_name, sum(sales) sales, sum(margin) margin,
      case when sum(sales) = 0 then 0 else sum(margin) / sum(sales) * 100 end margin_pct
    from base group by store_name order by sales desc limit 20
  ) x), '[]'::jsonb),
  'negativeMarginSkus', coalesce((select jsonb_agg(to_jsonb(x)) from (
    select sku, product_name, sum(sales) sales, sum(margin) margin,
      case when sum(sales) = 0 then 0 else sum(margin) / sum(sales) * 100 end margin_pct
    from base group by sku, product_name having sum(margin) < 0 order by margin asc limit 20
  ) x), '[]'::jsonb)
);
$$;

create or replace function execute_readonly_sql(p_sql text)
returns jsonb
language plpgsql
security definer
as $$
declare
  normalized text := lower(trim(regexp_replace(p_sql, ';+\s*$', '')));
  result jsonb;
begin
  if normalized !~ '^select\b' or normalized ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call)\b' then
    raise exception 'Only read-only SELECT statements are allowed';
  end if;

  execute format('select coalesce(jsonb_agg(row_to_json(q)), ''[]''::jsonb) from (%s) q', p_sql) into result;
  return result;
end;
$$;

create or replace function simulate_price_change(p_store text, p_product text, p_price_increase numeric)
returns jsonb
language sql
stable
security definer
as $$
with target as (
  select s.id store_id, s.name store_name, p.id product_id, p.product_name, p.sku, c.id category_id
  from stores s
  join daily_aggregates da on da.store_id = s.id
  join products p on p.id = da.product_id
  left join categories c on c.id = p.category_id
  where normalize_key(s.name) = normalize_key(p_store)
    and (normalize_key(p.product_name) like '%' || normalize_key(p_product) || '%' or normalize_key(p.sku) = normalize_key(p_product))
  limit 1
),
metrics as (
  select
    t.store_name,
    t.product_name,
    sum(da.units) current_units,
    sum(da.sales) current_sales,
    sum(da.margin) current_margin,
    case when sum(da.units) = 0 then 0 else sum(da.sales) / sum(da.units) end current_price,
    case when sum(da.units) = 0 then 0 else sum(da.cost) / sum(da.units) end current_cost,
    coalesce((
      select em.elasticity from elasticity_metrics em
      where (em.store_id = t.store_id or em.store_id is null)
        and (em.product_id = t.product_id or em.product_id is null)
        and (em.category_id = t.category_id or em.category_id is null)
      order by em.product_id nulls last, em.store_id nulls last, em.confidence desc
      limit 1
    ), case
      when lower(t.product_name) like '%cig%' then -0.45
      else -0.8
    end) elasticity
  from target t
  join daily_aggregates da on da.store_id = t.store_id and da.product_id = t.product_id
  group by t.store_id, t.product_id, t.category_id, t.store_name, t.product_name
),
projection as (
  select *,
    abs(elasticity * (p_price_increase / nullif(current_price, 0)) * 100) projected_unit_decline_pct
  from metrics
)
select to_jsonb(x) from (
  select
    product_name product,
    store_name store,
    current_units,
    current_sales,
    current_margin,
    case when current_sales = 0 then 0 else current_margin / current_sales * 100 end current_margin_pct,
    current_units * greatest(0, 1 - projected_unit_decline_pct / 100) projected_units,
    current_units * greatest(0, 1 - projected_unit_decline_pct / 100) * (current_price + p_price_increase) projected_sales,
    current_units * greatest(0, 1 - projected_unit_decline_pct / 100) * (current_price + p_price_increase - current_cost) projected_margin,
    case
      when current_units = 0 then 0
      else ((current_price + p_price_increase - current_cost) / nullif(current_price + p_price_increase, 0)) * 100
    end projected_margin_pct,
    elasticity,
    projected_unit_decline_pct
  from projection
) x;
$$;
