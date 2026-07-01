import jwt from "jsonwebtoken";

export type Session = { sub: string; role: "provider" | "admin" };

export function signToken(s: Session): string {
  return jwt.sign(s, process.env.JWT_SECRET!, { expiresIn: "8h" });
}

// Call in a route handler to verify JWT; pass role="admin" to additionally enforce admin-only access.
export function requireAuth(req: Request, role?: "admin"): Session | null {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const s = jwt.verify(token, process.env.JWT_SECRET!) as Session;
    if (role && s.role !== role) return null;
    return s;
  } catch {
    return null;
  }
}
