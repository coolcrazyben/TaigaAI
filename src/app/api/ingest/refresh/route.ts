import { NextResponse } from "next/server";
import { hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ refreshed: true, mode: "demo" });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("refresh_daily_aggregates");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ refreshed: true });
}
