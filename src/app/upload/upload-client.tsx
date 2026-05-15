"use client";

import Papa from "papaparse";
import { useState } from "react";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mapTaigaRow, type TaigaRow } from "@/lib/taiga";

type IngestionState = {
  parsed: number;
  inserted: number;
  rejected: number;
  errors: string[];
  running: boolean;
};

export function UploadClient() {
  const [state, setState] = useState<IngestionState>({ parsed: 0, inserted: 0, rejected: 0, errors: [], running: false });

  async function sendBatch(rows: TaigaRow[]) {
    const response = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ inserted: number; rejected: number }>;
  }

  function handleFile(file: File) {
    setState({ parsed: 0, inserted: 0, rejected: 0, errors: [], running: true });
    let batch: TaigaRow[] = [];

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      chunkSize: 1024 * 1024,
      async chunk(results, parser) {
        parser.pause();
        try {
          for (const raw of results.data) {
            const mapped = mapTaigaRow(raw);
            if (mapped.success) {
              batch.push(mapped.data);
            } else {
              setState((prev) => ({ ...prev, rejected: prev.rejected + 1 }));
            }

            if (batch.length >= 1000) {
              const payload = batch;
              batch = [];
              const result = await sendBatch(payload);
              setState((prev) => ({
                ...prev,
                parsed: prev.parsed + payload.length,
                inserted: prev.inserted + result.inserted,
                rejected: prev.rejected + result.rejected,
              }));
            }
          }
        } catch (error) {
          setState((prev) => ({ ...prev, errors: [...prev.errors, error instanceof Error ? error.message : "Upload failed"] }));
          parser.abort();
        } finally {
          parser.resume();
        }
      },
      async complete() {
        if (batch.length > 0) {
          try {
            const payload = batch;
            const result = await sendBatch(payload);
            setState((prev) => ({
              ...prev,
              parsed: prev.parsed + payload.length,
              inserted: prev.inserted + result.inserted,
              rejected: prev.rejected + result.rejected,
              running: false,
            }));
          } catch (error) {
            setState((prev) => ({
              ...prev,
              running: false,
              errors: [...prev.errors, error instanceof Error ? error.message : "Final batch failed"],
            }));
          }
        } else {
          setState((prev) => ({ ...prev, running: false }));
        }
      },
      error(error) {
        setState((prev) => ({ ...prev, running: false, errors: [...prev.errors, error.message] }));
      },
    });
  }

  return (
    <AppShell>
      <div className="space-y-5 p-4 lg:p-8">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">CSV ingestion</p>
          <h1 className="mt-2 text-3xl font-semibold">Upload Taiga exports</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Files are parsed in browser chunks, validated against the Taiga mapping, then inserted through batched database RPCs.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files.item(0);
                if (file) handleFile(file);
              }}
              className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/70 p-8 text-center transition hover:border-emerald-500"
            >
              <Upload className="mb-4 text-emerald-400" size={34} />
              <span className="text-lg font-medium">Drop a Taiga CSV export here</span>
              <span className="mt-2 text-sm text-slate-500">or click to choose a file. Multi-million row files are processed in chunks.</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </label>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <Status label="Parsed rows" value={state.parsed} />
          <Status label="Inserted rows" value={state.inserted} />
          <Status label="Rejected rows" value={state.rejected} />
          <Status label="Status" value={state.running ? "Running" : "Idle"} />
        </div>

        {state.errors.length ? (
          <Card className="border-red-900/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-300"><AlertTriangle size={16} /> Ingestion errors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-red-200">
              {state.errors.map((error, index) => <p key={index}>{error}</p>)}
            </CardContent>
          </Card>
        ) : state.inserted > 0 && !state.running ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 size={16} /> Upload finished.</div>
        ) : null}

        <Button variant="secondary" onClick={() => fetch("/api/ingest/refresh", { method: "POST" })}>Refresh daily aggregates</Button>
      </div>
    </AppShell>
  );
}

function Status({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
