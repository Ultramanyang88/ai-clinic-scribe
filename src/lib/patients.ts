import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { patients } from "@/db/schema";

// Look up a patient by (first name, last name, DOB); create one if not found.
export async function upsertPatient(p: { firstName: string; lastName: string; dob: string }) {
  const existing = await db.query.patients.findFirst({
    where: and(
      eq(patients.firstName, p.firstName),
      eq(patients.lastName, p.lastName),
      eq(patients.dob, p.dob),
    ),
  });
  if (existing) return existing;

  const [created] = await db.insert(patients).values(p).returning();
  return created;
}