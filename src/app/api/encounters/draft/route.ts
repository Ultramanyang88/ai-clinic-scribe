export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { encounters, patients } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the most recent unfinalized (draft) encounter owned by this provider.
  const draft = await db.query.encounters.findFirst({
    where: and(eq(encounters.providerId, session.sub), eq(encounters.status, "draft")),
    orderBy: [desc(encounters.updatedAt)],
  });
  if (!draft) return NextResponse.json({ draft: null });

  const patient = await db.query.patients.findFirst({ where: eq(patients.id, draft.patientId) });

  return NextResponse.json({
    draft: {
      encounterId: draft.id,
      patient: patient
        ? { firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob }
        : null,
      draftTranscript: draft.draftTranscript ?? "",
      draftWorkingNote: draft.draftWorkingNote ?? null,
    },
  });
}