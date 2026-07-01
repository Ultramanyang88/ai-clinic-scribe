export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

// GET is open to any authenticated user because providers need to fetch templates to populate their dropdown.
export async function GET(req: Request) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(templates).orderBy(desc(templates.createdAt));
  return NextResponse.json({ templates: rows });
}

export async function POST(req: Request) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, description, systemPrompt } = await req.json();
  if (!name?.trim() || !systemPrompt?.trim()) {
    return NextResponse.json({ error: "Missing name or systemPrompt" }, { status: 400 });
  }
  const [created] = await db.insert(templates).values({
    name: name.trim(), description: description ?? null,
    systemPrompt, createdBy: session.sub,
  }).returning({ id: templates.id });
  return NextResponse.json({ id: created.id });
}