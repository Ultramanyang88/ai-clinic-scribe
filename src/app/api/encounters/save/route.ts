export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { eq, sql, desc } from "drizzle-orm";
import { db } from "@/db";
import { encounters, noteVersions, providers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

type SoapContent = {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
};

function normalizeNote(content: SoapContent | null | undefined) {
  return {
    subjective: content?.subjective ?? "",
    objective: content?.objective ?? "",
    assessment: content?.assessment ?? "",
    plan: content?.plan ?? "",
  };
}

function sameNote(a: SoapContent | null | undefined, b: SoapContent | null | undefined) {
  const x = normalizeNote(a);
  const y = normalizeNote(b);

  return (
    x.subjective === y.subjective &&
    x.objective === y.objective &&
    x.assessment === y.assessment &&
    x.plan === y.plan
  );
}

export async function POST(req: Request) {
  const session = requireAuth(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  // Non-happy-path: provider account was deactivated while they had a draft open.
  // Return 403 so the frontend can surface a meaningful message without data loss
  // (the autosave will have already persisted the draft).
  const caller = await db.query.providers.findFirst({ where: eq(providers.id, session.sub) });
  if (!caller?.isActive) {
    return NextResponse.json({ error: "Account deactivated" }, { status: 403 });
  }

  const { encounterId, content, icdCodes } = await req.json();

  if (!encounterId || !content) {
    return NextResponse.json(
      { error: "Missing encounterId or content" },
      { status: 400 },
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [enc] = await tx
        .select()
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .for("update");

      if (!enc) throw new Error("not_found");
      if (session.role !== "admin" && enc.providerId !== session.sub) {
        throw new Error("forbidden");
      }

      const last = await tx.query.noteVersions.findFirst({
        where: eq(noteVersions.encounterId, encounterId),
        orderBy: [desc(noteVersions.versionNumber)],
      });

      if (last && sameNote(last.content as SoapContent, content as SoapContent)) {
        return { version: last, unchanged: true };
      }

      const [{ max }] = await tx
        .select({
          max: sql<number>`coalesce(max(${noteVersions.versionNumber}), 0)`,
        })
        .from(noteVersions)
        .where(eq(noteVersions.encounterId, encounterId));

      const [v] = await tx
        .insert(noteVersions)
        .values({
          encounterId,
          versionNumber: Number(max) + 1,
          content,
          icdCodes,
          savedBy: session.sub,
        })
        .returning();

      await tx
        .update(encounters)
        .set({ status: "finalized", updatedAt: new Date() })
        .where(eq(encounters.id, encounterId));

      return { version: v, unchanged: false };
    });

    return NextResponse.json({
      encounterId,
      versionNumber: result.version.versionNumber,
      unchanged: result.unchanged,
    });
  } catch (e) {
    const m = (e as Error).message;

    if (m === "not_found") {
      return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
    }

    if (m === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}