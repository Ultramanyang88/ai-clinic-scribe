export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { encounters } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { draftTranscript, draftWorkingNote } = await req.json();

  // Ownership check — providers may only update their own encounters.
  const enc = await db.query.encounters.findFirst({ where: eq(encounters.id, id) });
  if (!enc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "admin" && enc.providerId !== session.sub)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.update(encounters)
    .set({ draftTranscript, draftWorkingNote, updatedAt: new Date() })
    .where(eq(encounters.id, id));

  return NextResponse.json({ ok: true });
}