"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("schen@clinic.test");
  const [password, setPassword] = useState("Password123!");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr(""); setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) { setErr("Invalid credentials"); return; }
    const { token, user } = await res.json();
    sessionStorage.setItem("token", token);
    sessionStorage.setItem("role", user.role);
    router.push(user.role === "admin" ? "/admin" : "/workspace");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm border border-slate-200 bg-white rounded-lg p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Clinical Scribe</h1>
        <p className="text-sm text-slate-500 mb-6">Sign in to continue</p>
        <input
          className="w-full mb-3 border border-slate-300 rounded px-3 py-2 text-sm"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
        />
        <input
          className="w-full mb-4 border border-slate-300 rounded px-3 py-2 text-sm"
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
        <button
          onClick={submit} disabled={loading}
          className="w-full bg-slate-800 text-white rounded py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
