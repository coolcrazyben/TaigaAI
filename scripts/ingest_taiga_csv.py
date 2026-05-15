import argparse
import csv
import os
from decimal import Decimal, InvalidOperation
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

ALIASES = {
    "store_name": ["store", "store name", "location", "site"],
    "business_date": ["date", "business date", "transaction date", "sale date"],
    "transaction_id": ["transaction id", "ticket", "receipt", "invoice"],
    "sku": ["sku", "item", "item code", "plu", "upc"],
    "product_name": ["description", "product", "product name", "item description"],
    "brand": ["brand", "vendor brand"],
    "category": ["category", "department", "major category"],
    "quantity": ["qty", "quantity", "units"],
    "unit_price": ["price", "unit price", "retail"],
    "unit_cost": ["cost", "unit cost"],
    "sales_amount": ["sales", "sales amount", "extended retail", "net sales"],
    "cost_amount": ["cost amount", "extended cost"],
}


def normalize_header(value: str) -> str:
    return " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())


def decimal_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(Decimal(str(value).replace(",", "").replace("$", "").strip()))
    except (InvalidOperation, ValueError):
        return None


def map_row(row: dict[str, Any]) -> dict[str, Any] | None:
    normalized = {normalize_header(key): value for key, value in row.items()}
    mapped: dict[str, Any] = {}
    for field, names in ALIASES.items():
        for name in names:
            if name in normalized:
                mapped[field] = normalized[name]
                break

    for required in ["store_name", "business_date", "sku", "product_name", "quantity"]:
        if not str(mapped.get(required, "")).strip():
            return None

    quantity = decimal_or_none(mapped.get("quantity"))
    unit_price = decimal_or_none(mapped.get("unit_price"))
    unit_cost = decimal_or_none(mapped.get("unit_cost"))
    sales_amount = decimal_or_none(mapped.get("sales_amount"))
    cost_amount = decimal_or_none(mapped.get("cost_amount"))

    if quantity is None:
        return None
    if sales_amount is None and unit_price is not None:
        sales_amount = quantity * unit_price
    if cost_amount is None and unit_cost is not None:
        cost_amount = quantity * unit_cost
    if sales_amount is None:
        return None

    return {
        "store_name": str(mapped["store_name"]).strip(),
        "business_date": str(mapped["business_date"]).strip(),
        "transaction_id": str(mapped.get("transaction_id") or "").strip(),
        "sku": str(mapped["sku"]).strip(),
        "product_name": str(mapped["product_name"]).strip(),
        "brand": str(mapped.get("brand") or "").strip(),
        "category": str(mapped.get("category") or "Uncategorized").strip(),
        "quantity": quantity,
        "unit_price": unit_price,
        "unit_cost": unit_cost,
        "sales_amount": sales_amount,
        "cost_amount": cost_amount,
    }


def flush(client, rows: list[dict[str, Any]]) -> tuple[int, int]:
    if not rows:
        return 0, 0
    result = client.rpc("ingest_taiga_rows", {"p_rows": rows}).execute()
    payload = result.data or {}
    return int(payload.get("inserted", 0)), int(payload.get("rejected", 0))


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest a Taiga CSV export into Supabase.")
    parser.add_argument("csv_path")
    parser.add_argument("--batch-size", type=int, default=2000)
    parser.add_argument("--refresh-aggregates", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client = create_client(url, key)

    inserted = rejected = 0
    batch: list[dict[str, Any]] = []
    with open(args.csv_path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            mapped = map_row(raw)
            if mapped is None:
                rejected += 1
                continue
            batch.append(mapped)
            if len(batch) >= args.batch_size:
                ok, bad = flush(client, batch)
                inserted += ok
                rejected += bad
                batch.clear()
                print(f"inserted={inserted} rejected={rejected}")

    ok, bad = flush(client, batch)
    inserted += ok
    rejected += bad

    if args.refresh_aggregates:
        client.rpc("refresh_daily_aggregates").execute()

    print(f"done inserted={inserted} rejected={rejected}")


if __name__ == "__main__":
    main()
