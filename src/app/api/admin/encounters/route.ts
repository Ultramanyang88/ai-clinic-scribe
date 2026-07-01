export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { encounters, patients, providers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const conds = [];
  if (provider) conds.push(eq(encounters.providerId, provider));
  if (from) conds.push(gte(encounters.createdAt, new Date(from)));
  if (to) conds.push(lte(encounters.createdAt, new Date(to + "T23:59:59")));

  const rows = await db.select({
    id: encounters.id,
    status: encounters.status,
    createdAt: encounters.createdAt,
    patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
    providerName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
  }).from(encounters)
    .innerJoin(patients, eq(encounters.patientId, patients.id))
    .innerJoin(providers, eq(encounters.providerId, providers.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(encounters.createdAt));

  return NextResponse.json({ encounters: rows });
}