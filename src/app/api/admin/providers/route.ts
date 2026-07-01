export const runtime = "nodejs";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db.select({
    id: providers.id, firstName: providers.firstName, lastName: providers.lastName,
    email: providers.email, role: providers.role, isActive: providers.isActive,
  }).from(providers).orderBy(desc(providers.createdAt));

  return NextResponse.json({ providers: rows });
}

export async function POST(req: Request) {
  const session = requireAuth(req, "admin");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { firstName, lastName, email, password } = await req.json();
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [created] = await db.insert(providers).values({
      firstName: firstName.trim(), lastName: lastName.trim(),
      email: email.trim(), passwordHash, role: "provider",
    }).returning({ id: providers.id });
    return NextResponse.json({ id: created.id });
  } catch {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }
}