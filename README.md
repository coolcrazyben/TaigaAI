# Prince Oil Analytics Platform

AI-powered analytics for Prince Oil's 10 gas stations in Mississippi. Store managers can ask plain-English questions about performance, fuel margins, inside sales, and merchandise — powered by Claude AI and real data scraped nightly from Taiga Data.

## How It Works

```
Taiga Data (SaaS) → Playwright Scraper → CSV files → Ingestion Script → Supabase → Claude AI → Chat Interface
```

1. A Playwright script logs into Taiga, exports Transaction Summary and Merchandise CSVs for each store.
2. An ingestion script cleans the CSVs and loads them into Supabase.
3. Store managers open the chat at `/chat` and ask questions in plain English.
4. Claude AI reads the relevant data and answers with specific numbers and a recommended action.
5. GitHub Actions runs the scraper + ingestion every night at 3 AM CT.

---

## Quick Start (Local Development)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your Supabase project settings
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings → API → service_role key
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `TAIGA_EMAIL` and `TAIGA_PASSWORD` — your Taiga Data login credentials
- `TAIGA_BASE_URL` — usually `https://app.taigadata.com`

### 3. Set up the Supabase database

1. Go to your Supabase project → SQL Editor
2. Paste the entire contents of `supabase/schema.sql` and click Run
3. The tables `stores`, `transaction_summary`, `merchandise_summary`, and `ingestion_log` will be created

### 4. Start the app

```bash
npm run dev
```

Open http://localhost:3000. The chat at `/chat` works in demo mode until you load data.

---

## Loading Real Data

### Step 1 — Run the scraper

The scraper logs into Taiga, selects each store, and downloads CSVs to the `downloads/` folder.

```bash
npm run taiga:scrape
```

Watch it in action (headed mode):

```bash
node scraper/index.js --headless false
```

**If the scraper can't find elements:** The selectors depend on Taiga's HTML structure. Run the discovery tool to see what Taiga's UI looks like:

```bash
npm run taiga:discover
```

That opens a browser, logs in, and records all network activity. Navigate around Store Performance and Merchandise pages, then press Enter in the terminal. Look at `data/taiga-network-discovery.json` to find usable API endpoints, or inspect the page HTML in DevTools to find the correct CSS selectors.

Update the selectors in `scraper/index.js` (the `SEL` object near the top) or override them with environment variables in `.env.local` (see the `SEL_*` variables in `.env.example`).

### Step 2 — Run ingestion

```bash
npm run taiga:ingest
```

This reads all CSVs from `downloads/`, cleans the numbers, and upserts them into Supabase. Each run is logged to the `ingestion_log` table.

### Step 3 — Ask questions

Open http://localhost:3000/chat and ask anything:
- "Which store has the best fuel margin?"
- "How does Newton Junction compare to the network average?"
- "Which brand sells the most merchandise?"

---

## Nightly Automation (GitHub Actions)

The workflow at `.github/workflows/nightly-scrape.yml` runs at 3 AM CT every night.

### Set up GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `TAIGA_EMAIL` | Your Taiga login email |
| `TAIGA_PASSWORD` | Your Taiga password |
| `TAIGA_BASE_URL` | `https://app.taigadata.com` |
| `TAIGA_REPORT_URL` | URL of the Store Performance page |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase service role key |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

The workflow will:
1. Run the Playwright scraper
2. Run the ingestion script
3. Commit the scraper log back to the repo (so you have a history of runs)
4. Upload the downloaded CSVs as artifacts (kept 7 days)

You can also trigger it manually from GitHub → Actions → "Nightly Taiga Scrape + Ingest" → Run workflow.

---

## Project Structure

```
/
├── scraper/
│   └── index.js          Playwright scraper — logs into Taiga, downloads CSVs
├── ingestion/
│   └── index.js          Reads CSVs, cleans data, upserts into Supabase
├── src/
│   ├── app/
│   │   ├── chat/         Prince Oil AI chat interface
│   │   ├── api/
│   │   │   ├── chat/     Claude AI endpoint (prince-oil branded)
│   │   │   └── ai/query/ Legacy SQL-based AI endpoint (OpenAI)
│   │   ├── upload/       Browser CSV upload (for manual use)
│   │   └── ...
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── prince-oil-prompt.ts   Claude system prompt + schema
│   │   │   └── schema.ts              Legacy SQL schema prompt
│   │   └── ...
├── supabase/
│   ├── schema.sql         Simple summary tables (run this in Supabase SQL Editor)
│   └── migrations/        Advanced transaction-level schema (optional)
├── scripts/
│   ├── discover_taiga_network.mjs   Browser discovery tool
│   └── ...                          Legacy Python ingestion scripts
├── downloads/             CSVs downloaded by the scraper
├── data/                  Saved browser session, discovery output
└── .github/workflows/
    └── nightly-scrape.yml  GitHub Actions nightly cron
```

---

## CSV File Naming Convention

The scraper saves files as:

```
{store_id}__{view}__{date_range}.csv
```

Examples:
```
newton_junction__transaction_summary__2026-05.csv
newton_junction__merch_brand__2026-05.csv
oak_street_fuel__transaction_summary__2026-04.csv
```

The ingestion script uses this naming to know which table to load data into.

---

## Troubleshooting

**Scraper can't find the store dropdown**
Run `npm run taiga:discover` (headed mode), navigate to Store Performance, then check `data/taiga-network-discovery.json` for API calls or use DevTools to inspect the dropdown HTML.

**Authentication keeps failing**
Delete `data/taiga-storage-state.json` and let the scraper re-login from scratch.

**Claude returns "Demo mode"**
Check that `ANTHROPIC_API_KEY` is set in `.env.local` and that Supabase credentials are correct.

**Ingestion says "No CSV files found"**
Run the scraper first (`npm run taiga:scrape`) or place manually-exported Taiga CSVs in the `downloads/` folder.

**Selector overrides**
All CSS selectors used by the scraper can be overridden via environment variables (see the `SEL_*` section in `.env.example`).
