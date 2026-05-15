import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv


def auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {}

    bearer = os.getenv("TAIGA_BEARER_TOKEN")
    api_key = os.getenv("TAIGA_API_KEY")
    api_key_header = os.getenv("TAIGA_API_KEY_HEADER", "X-API-Key")

    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if api_key:
        headers[api_key_header] = api_key

    return headers


def basic_auth() -> tuple[str, str] | None:
    username = os.getenv("TAIGA_USERNAME")
    password = os.getenv("TAIGA_PASSWORD")
    if username and password:
        return username, password
    return None


def filename_for(url: str, index: int) -> str:
    parsed = urlparse(url)
    source_name = Path(parsed.path).name or f"taiga-export-{index}.csv"
    if not source_name.lower().endswith(".csv"):
        source_name = f"{source_name}.csv"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{Path(source_name).stem}-{stamp}.csv"


def download_export(url: str, target: Path, index: int) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    output = target / filename_for(url, index)

    response = requests.get(
        url,
        headers=auth_headers(),
        auth=basic_auth(),
        timeout=int(os.getenv("TAIGA_PULL_TIMEOUT_SECONDS", "900")),
        stream=True,
    )
    response.raise_for_status()

    content_type = response.headers.get("content-type", "")
    if "text/csv" not in content_type and "application/octet-stream" not in content_type and not url.lower().endswith(".csv"):
        print(f"warning: unexpected content type for {url}: {content_type}", file=sys.stderr)

    with output.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                handle.write(chunk)

    return output


def ingest_file(csv_path: Path, refresh: bool) -> None:
    command = [sys.executable, "scripts/ingest_taiga_csv.py", str(csv_path)]
    if refresh:
        command.append("--refresh-aggregates")
    subprocess.run(command, check=True)


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Pull Taiga CSV exports from configured URLs and ingest them.")
    parser.add_argument("--output-folder", default=os.getenv("TAIGA_INCOMING_FOLDER", "data/taiga-incoming"))
    parser.add_argument("--ingest", action="store_true", default=os.getenv("TAIGA_PULL_AND_INGEST", "true").lower() == "true")
    parser.add_argument("--refresh-aggregates", action="store_true", default=True)
    args = parser.parse_args()

    urls = [value.strip() for value in os.getenv("TAIGA_EXPORT_URLS", "").split(",") if value.strip()]
    if not urls:
        raise SystemExit("Set TAIGA_EXPORT_URLS to one or more authenticated Taiga CSV export URLs.")

    output_folder = Path(args.output_folder)
    downloaded: list[Path] = []

    for index, url in enumerate(urls, start=1):
        csv_path = download_export(url, output_folder, index)
        downloaded.append(csv_path)
        print(f"downloaded {csv_path}")

        if args.ingest:
            ingest_file(csv_path, args.refresh_aggregates)

    if args.ingest:
        subprocess.run([sys.executable, "scripts/learn_elasticity.py"], check=False)

    print(f"completed exports={len(downloaded)} ingest={args.ingest}")


if __name__ == "__main__":
    main()
