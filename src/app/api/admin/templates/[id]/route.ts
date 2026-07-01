export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, description, systemPrompt } = await req.json();
  await db.update(templates)
    .set({ name, description, systemPrompt, updatedAt: new Date() })
    .where(eq(templates.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    await db.delete(templates).where(eq(templates.id, id));
    return NextResponse.json({ ok: true });
  } catch {
    // FK constraint fires when at least one encounter references this template.
    return NextResponse.json({ error: "Template in use, cannot delete" }, { status: 409 });
  }
}