import { and, eq, ne, desc } from "drizzle-orm";
import { db } from "@/db";
import { patients, encounters, noteVersions } from "@/db/schema";

export async function fetchPatientHistory(
  input: { first_name: string; last_name: string; dob: string },
  currentEncounterId: string,
): Promise<string> {
  const patient = await db.query.patients.findFirst({
    where: and(
      eq(patients.firstName, input.first_name.trim()),
      eq(patients.lastName, input.last_name.trim()),
      eq(patients.dob, input.dob),
    ),
  });
  if (!patient) return "No prior encounters on record (first-time visit).";

  // Load up to 5 prior finalized encounters for this patient, excluding the current draft.
  const prior = await db.query.encounters.findMany({
    where: and(eq(encounters.patientId, patient.id), ne(encounters.id, currentEncounterId)),
    orderBy: [desc(encounters.createdAt)],
    limit: 5,
  });
  if (prior.length === 0) return "No prior encounters on record (first-time visit).";

  const summaries: string[] = [];
  for (const enc of prior) {
    const latest = await db.query.noteVersions.findFirst({
      where: eq(noteVersions.encounterId, enc.id),
      orderBy: [desc(noteVersions.versionNumber)],   // append-only: highest version number is the authoritative state
    });
    if (!latest) continue;   // Draft-only encounters (never finalized) are excluded from history.
    const c = latest.content as { assessment?: string; plan?: string };
    summaries.push(
      `Encounter ${enc.createdAt.toISOString().slice(0, 10)}:\n` +
      `  Assessment: ${c.assessment ?? "(n/a)"}\n` +
      `  Plan: ${c.plan ?? "(n/a)"}`,
    );
  }
  if (summaries.length === 0) return "No prior finalized notes for this patient.";
  return `Prior encounter history (most recent first):\n\n${summaries.join("\n\n---\n\n")}`;
}