import {
  pgTable, uuid, text, boolean, timestamp, integer,
  jsonb, date, serial, pgEnum, unique,index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["provider", "admin"]);
export const statusEnum = pgEnum("encounter_status", ["draft", "finalized"]);

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("provider"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: date("dob").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqPatient: unique("uniq_patient").on(t.firstName, t.lastName, t.dob),
}));

export const encounters = pgTable("encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  status: statusEnum("status").notNull().default("draft"),
  draftTranscript: text("draft_transcript"),
  draftWorkingNote: jsonb("draft_working_note"),
  templateId: uuid("template_id").references(() => templates.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientIdx: index("enc_patient_idx").on(t.patientId),
  providerIdx: index("enc_provider_idx").on(t.providerId),
}));

export const noteVersions = pgTable("note_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  encounterId: uuid("encounter_id").notNull().references(() => encounters.id),
  versionNumber: integer("version_number").notNull(),
  content: jsonb("content").notNull(),
  icdCodes: jsonb("icd_codes"),
  savedBy: uuid("saved_by").notNull().references(() => providers.id),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqEncounterVersion: unique("uniq_encounter_version").on(t.encounterId, t.versionNumber),
  encounterIdx: index("nv_encounter_idx").on(t.encounterId),
}));

export const icd10Codes = pgTable("icd10_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  createdBy: uuid("created_by").notNull().references(() => providers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});