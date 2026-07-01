export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { isActive } = await req.json();
  await db.update(providers).set({ isActive: !!isActive }).where(eq(providers.id, id));
  return NextResponse.json({ ok: true });
}