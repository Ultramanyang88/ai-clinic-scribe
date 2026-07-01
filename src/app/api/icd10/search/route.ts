export const runtime = "nodejs";
import { ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { icd10Codes } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import OpenAI from "openai";

export async function GET(req: Request) {
  const session = requireAuth(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return Response.json([]);

  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const candidates = await db.select()
    .from(icd10Codes)
    .where(or(
      ilike(icd10Codes.description, `%${q}%`),
      ...terms.map((t) => ilike(icd10Codes.description, `%${t}%`)),
      ilike(icd10Codes.code, `%${q}%`),
    ))
    .limit(60);

  let pool = candidates;
  if (pool.length === 0) {
    pool = await db.select().from(icd10Codes)
      .where(or(...terms.map((t) => ilike(icd10Codes.description, `%${t.slice(0, 4)}%`))))
      .limit(60);
  }
  if (pool.length === 0) return Response.json([]);
  if (pool.length <= 8) return Response.json(pool);

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const list = pool.map((r) => `${r.code} | ${r.description}`).join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an ICD-10 coding assistant. Given a clinician's plain-English query and a list of " +
            "candidate ICD-10 codes, return the 8 most clinically/semantically relevant codes for the query. " +
            "You MUST only choose codes from the provided candidate list — never invent a code. " +
            'Respond ONLY with a JSON array of objects like [{"code":"...","description":"..."}], most relevant first, no prose.',
        },
        { role: "user", content: `Query: ${q}\n\nCandidates:\n${list}` },
      ],
    });

    let text = completion.choices[0].message.content ?? "[]";
    text = text.replace(/```json|```/g, "").trim();
    const ranked = JSON.parse(text) as { code: string; description: string }[];

    const valid = new Map(pool.map((r) => [r.code, r]));
    const out = ranked
      .filter((r) => valid.has(r.code))
      .map((r) => valid.get(r.code)!)
      .slice(0, 8);

    return Response.json(out.length ? out : pool.slice(0, 8));
  } catch {
    return Response.json(pool.slice(0, 8));
  }
}