export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { encounters } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { upsertPatient } from "@/lib/patients";

export async function POST(req: Request) {
  const session = requireAuth(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { patient, transcript } = await req.json();
  if (!patient?.firstName?.trim() || !patient?.lastName?.trim() || !patient?.dob) {
    return NextResponse.json({ error: "Missing patient fields" }, { status: 400 });
  }

  const pt = await upsertPatient({
    firstName: patient.firstName.trim(),
    lastName: patient.lastName.trim(),
    dob: patient.dob,
  });

  const [enc] = await db.insert(encounters).values({
    patientId: pt.id,
    providerId: session.sub,
    status: "draft",
    draftTranscript: transcript ?? null,
  }).returning();

  return NextResponse.json({ encounterId: enc.id, patientId: pt.id });
}