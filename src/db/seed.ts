import "dotenv/config";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { providers, icd10Codes, templates } from "./schema";
import { eq } from "drizzle-orm";

const ICD10_SEED: { code: string; description: string }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "icd10-data.json"), "utf-8"),
);

async function main() {
  const pw = await bcrypt.hash("Password123!", 10);

  await db.insert(providers).values([
    { firstName: "Sarah", lastName: "Chen",   email: "schen@clinic.test",  passwordHash: pw, role: "provider" },
    { firstName: "James", lastName: "Okafor", email: "jokafor@clinic.test", passwordHash: pw, role: "provider" },
    { firstName: "Maria", lastName: "Lopez",  email: "mlopez@clinic.test",  passwordHash: pw, role: "provider" },
    { firstName: "Admin", lastName: "User",   email: "admin@clinic.test",   passwordHash: pw, role: "admin"   },
  ]).onConflictDoNothing();

  const CHUNK = 500;
  for (let i = 0; i < ICD10_SEED.length; i += CHUNK) {
    await db.insert(icd10Codes).values(ICD10_SEED.slice(i, i + CHUNK)).onConflictDoNothing();
  }

  const admin = await db.query.providers.findFirst({ where: eq(providers.role, "admin") });
  if (admin) {
    await db.delete(templates);
    await db.insert(templates).values([
      {
        name: "General SOAP",
        description: "Default structured SOAP note",
        systemPrompt: `You are a clinical documentation assistant. Convert the transcript into a structured SOAP note with ## Subjective, ## Objective, ## Assessment (include at least one ICD-10 code as \`CODE — description\`), and ## Plan. Use only stated information. If no clinical content, respond ONLY with INSUFFICIENT_CLINICAL_CONTENT.`,
        createdBy: admin.id,
      },
      {
        name: "Orthopedic Follow-up",
        description: "Ortho visit, emphasis on ROM / pain / imaging",
        systemPrompt: `You are an orthopedic documentation assistant. Produce a SOAP note (## Subjective, ## Objective, ## Assessment with ICD-10 as \`CODE — description\`, ## Plan). In Objective emphasize range of motion, joint exam, and imaging findings. In Plan address PT, weight-bearing status, and follow-up imaging. Use only stated information. If no clinical content, respond ONLY with INSUFFICIENT_CLINICAL_CONTENT.`,
        createdBy: admin.id,
      },
      {
        name: "Urgent Care Visit",
        description: "Acute complaint, concise, disposition-focused",
        systemPrompt: `You are an urgent care documentation assistant. Produce a concise SOAP note (## Subjective, ## Objective, ## Assessment with ICD-10 as \`CODE — description\`, ## Plan). Emphasize the acute complaint, red-flag screening, and clear disposition (discharge vs escalate) in Plan. Use only stated information. If no clinical content, respond ONLY with INSUFFICIENT_CLINICAL_CONTENT.`,
        createdBy: admin.id,
      },
    ]);
  }

  console.log(`Seeded: 4 accounts + ${ICD10_SEED.length} ICD codes + 3 templates`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });