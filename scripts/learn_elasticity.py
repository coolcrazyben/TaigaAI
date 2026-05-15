import os

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client


SQL = """
select
  da.store_id,
  da.product_id,
  da.category_id,
  p.brand,
  da.business_date,
  da.units,
  case when da.units = 0 then null else da.sales / da.units end as unit_price
from daily_aggregates da
join products p on p.id = da.product_id
where da.units > 0 and da.sales > 0
order by da.store_id, da.product_id, da.business_date
limit 500000
"""


def estimate(group: pd.DataFrame) -> dict | None:
    group = group.sort_values("business_date").copy()
    group["price_change"] = group["unit_price"].pct_change()
    group["unit_change"] = group["units"].pct_change()
    observations = group[(group["price_change"].abs() > 0.01) & (group["unit_change"].abs() < 3)].dropna()
    if len(observations) < 3:
        return None
    elasticity = float(np.median(observations["unit_change"] / observations["price_change"]))
    if not np.isfinite(elasticity):
        return None
    elasticity = max(min(elasticity, 0), -5)
    return {
        "store_id": group["store_id"].iloc[0],
        "product_id": group["product_id"].iloc[0],
        "category_id": group["category_id"].iloc[0],
        "brand": group["brand"].iloc[0],
        "elasticity": elasticity,
        "observation_count": int(len(observations)),
        "confidence": float(min(1, len(observations) / 12)),
        "method": "historical_price_change",
    }


def main() -> None:
    load_dotenv()
    client = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    rows = client.rpc("execute_readonly_sql", {"p_sql": SQL}).execute().data
    frame = pd.DataFrame(rows)
    if frame.empty:
        print("No aggregate rows found. Run ingestion and refresh_daily_aggregates first.")
        return

    metrics = []
    for _, group in frame.groupby(["store_id", "product_id"], dropna=False):
        row = estimate(group)
        if row:
            metrics.append(row)

    if metrics:
        client.table("elasticity_metrics").upsert(metrics, on_conflict="store_id,product_id,category_id,brand,method").execute()
    print(f"upserted elasticity metrics: {len(metrics)}")


if __name__ == "__main__":
    main()
