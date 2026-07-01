export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { signToken } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const user = await db.query.providers.findFirst({
    where: eq(providers.email, email),
  });

  // Unified 401 for all failure cases (not found / inactive / wrong password) — avoids leaking which step failed.
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signToken({ sub: user.id, role: user.role });
  return NextResponse.json({
    token,
    user: { id: user.id, firstName: user.firstName, role: user.role },
  });
}
