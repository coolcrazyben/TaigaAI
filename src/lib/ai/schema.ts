export const analyticalSchema = `
Tables:
- stores(id uuid, name text, normalized_name text, region text)
- categories(id uuid, name text, normalized_name text, parent_id uuid)
- products(id uuid, sku text, product_name text, normalized_name text, brand text, category_id uuid)
- transactions(id uuid, store_id uuid, product_id uuid, business_date date, transaction_id text, quantity numeric, unit_price numeric, unit_cost numeric, sales_amount numeric, cost_amount numeric, margin_amount numeric)
- daily_aggregates(store_id uuid, product_id uuid, category_id uuid, business_date date, units numeric, sales numeric, cost numeric, margin numeric, transaction_count int)
- pricing_history(store_id uuid, product_id uuid, effective_date date, unit_price numeric, unit_cost numeric, source text)
- elasticity_metrics(store_id uuid, product_id uuid, category_id uuid, brand text, elasticity numeric, observation_count int, confidence numeric)

Use daily_aggregates for most dashboard and trend questions. Use transactions only when transaction-level detail is required.
Only write SELECT queries. Never mutate data. Always limit large result sets.
`;

export function sqlSystemPrompt() {
  return `You are an expert convenience-store retail analyst. Generate one PostgreSQL SELECT query that answers the user question using the schema below.

Rules:
- Return JSON with keys sql and explanation.
- sql must be a single read-only SELECT statement.
- Prefer aggregate tables for speed.
- Include store, product, category, brand names through joins when useful.
- Never invent columns, tables, or data.
- Use LIMIT 100 unless a smaller result is better.

${analyticalSchema}`;
}
