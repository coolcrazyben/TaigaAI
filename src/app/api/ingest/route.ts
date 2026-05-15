import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { taigaRowSchema } from "@/lib/taiga";

const bodySchema = z.object({
  rows: z.array(taigaRowSchema).min(1).max(2500),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ inserted: parsed.data.rows.length, rejected: 0, mode: "demo" });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("ingest_taiga_rows", { p_rows: parsed.data.rows });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? { inserted: parsed.data.rows.length, rejected: 0 });
}
