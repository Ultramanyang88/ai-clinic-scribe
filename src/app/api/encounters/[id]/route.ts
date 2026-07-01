export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { noteVersions, providers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: encounterId } = await params;
  const versions = await db.select({
    versionNumber: noteVersions.versionNumber,
    content: noteVersions.content,
    icdCodes: noteVersions.icdCodes,
    savedAt: noteVersions.savedAt,
    savedByName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
  }).from(noteVersions)
    .innerJoin(providers, eq(noteVersions.savedBy, providers.id))
    .where(eq(noteVersions.encounterId, encounterId))
    .orderBy(desc(noteVersions.versionNumber));

  return NextResponse.json({ versions });
}