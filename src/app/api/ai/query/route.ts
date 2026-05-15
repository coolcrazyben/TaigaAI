import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { env, hasSupabaseAdminEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { sqlSystemPrompt } from "@/lib/ai/schema";

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1).max(20),
});

function isReadOnlySelect(sql: string) {
  const normalized = sql.trim().replace(/;+\s*$/, "").toLowerCase();
  return normalized.startsWith("select") && !/(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call)\b/.test(normalized);
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat payload" }, { status: 400 });
  }

  if (!env.openaiApiKey || !hasSupabaseAdminEnv()) {
    return NextResponse.json({
      answer: "Demo mode: configure OPENAI_API_KEY and Supabase to run SQL-backed AI analysis. The production path generates read-only SQL, executes it through execute_readonly_sql, then summarizes only returned rows.",
      sql: "select category_id, sum(sales) as sales, sum(margin) as margin from daily_aggregates group by category_id limit 100",
      rows: [],
    });
  }

  const openai = new OpenAI({ apiKey: env.openaiApiKey });
  const completion = await openai.chat.completions.create({
    model: env.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sqlSystemPrompt() },
      ...parsed.data.messages.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    ],
  });

  const content = completion.choices[0]?.message.content ?? "{}";
  const generated = JSON.parse(content) as { sql?: string; explanation?: string };
  const sql = generated.sql ?? "";

  if (!isReadOnlySelect(sql)) {
    return NextResponse.json({ error: "AI generated a non-read-only query and it was blocked." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase.rpc("execute_readonly_sql", { p_sql: sql });

  if (error) {
    return NextResponse.json({ error: error.message, sql }, { status: 500 });
  }

  const answerCompletion = await openai.chat.completions.create({
    model: env.openaiModel,
    messages: [
      {
        role: "system",
        content: "You are a precise retail analyst. Explain only what is supported by the SQL result rows. If the result is empty, say so and suggest a narrower or corrected question.",
      },
      {
        role: "user",
        content: `Question: ${parsed.data.messages.at(-1)?.content}\nSQL: ${sql}\nRows: ${JSON.stringify(rows).slice(0, 12000)}`,
      },
    ],
  });

  return NextResponse.json({
    answer: answerCompletion.choices[0]?.message.content ?? generated.explanation ?? "No answer generated.",
    sql,
    rows,
  });
}
