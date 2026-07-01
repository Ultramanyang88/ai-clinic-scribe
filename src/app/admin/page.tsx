"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminDashboard() {
  const router = useRouter();
  const token = () => sessionStorage.getItem("token");
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  const [tab, setTab] = useState<"encounters" | "providers" | "templates">("encounters");

  // Auth guard — only admin tokens may access this page.
  useEffect(() => {
    if (!token() || sessionStorage.getItem("role") !== "admin") router.replace("/login");
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-slate-800">Admin Dashboard</h1>
          <button onClick={() => { sessionStorage.clear(); router.replace("/login"); }}
            className="text-xs text-slate-500 hover:text-slate-700">Sign out</button>
        </div>

        <div className="flex gap-2 mb-4 border-b border-slate-200">
          {(["encounters", "providers", "templates"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400"
              }`}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "encounters" && <EncountersTab auth={auth} />}
        {tab === "providers" && <ProvidersTab auth={auth} />}
        {tab === "templates" && <TemplatesTab auth={auth} />}
      </div>
    </div>
  );
}

/* ---------- Encounters ---------- */
function EncountersTab({ auth }: { auth: () => Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [provider, setProvider] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function load() {
    const p = new URLSearchParams();
    if (provider) p.set("provider", provider);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const res = await fetch(`/api/admin/encounters?${p}`, { headers: auth() });
    const { encounters } = await res.json();
    setRows(encounters ?? []);
  }
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/providers", { headers: auth() });
      const { providers } = await res.json();
      setProviders(providers ?? []);
    })();
    load();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div>
          <label className="text-xs text-slate-400 block">Provider</label>
          <select className="border border-slate-300 rounded px-2 py-1 text-sm"
            value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block">From</label>
          <input type="date" className="border border-slate-300 rounded px-2 py-1 text-sm"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block">To</label>
          <input type="date" className="border border-slate-300 rounded px-2 py-1 text-sm"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button onClick={load} className="bg-slate-800 text-white rounded px-3 py-1 text-sm">Filter</button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-200">
            <th className="py-2">Provider</th><th>Patient</th><th>Date</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="py-2">{r.providerName}</td>
              <td>{r.patientName}</td>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
              <td><span className={r.status === "finalized" ? "text-emerald-600" : "text-amber-600"}>{r.status}</span></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-400">No encounters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Providers ---------- */
function ProvidersTab({ auth }: { auth: () => Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/admin/providers", { headers: auth() });
    const { providers } = await res.json();
    setRows(providers ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setMsg("");
    const res = await fetch("/api/admin/providers", {
      method: "POST", headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setForm({ firstName: "", lastName: "", email: "", password: "" }); load(); }
    else { const { error } = await res.json(); setMsg(error ?? "Failed"); }
  }

  async function toggle(id: string, isActive: boolean) {
    await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end flex-wrap">
        <input className="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="First name"
          value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        <input className="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Last name"
          value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        <input className="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Email"
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Password" type="password"
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button onClick={add} className="bg-slate-800 text-white rounded px-3 py-1 text-sm">Add provider</button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-200">
            <th className="py-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="py-2">{p.firstName} {p.lastName}</td>
              <td>{p.email}</td>
              <td>{p.role}</td>
              <td><span className={p.isActive ? "text-emerald-600" : "text-slate-400"}>
                {p.isActive ? "active" : "inactive"}</span></td>
              <td>
                {p.role !== "admin" && (
                  <button onClick={() => toggle(p.id, p.isActive)}
                    className="text-xs border border-slate-300 rounded px-2 py-0.5">
                    {p.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Templates ---------- */
function TemplatesTab({ auth }: { auth: () => Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", description: "", systemPrompt: "" });
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/templates", { headers: auth() });
    const { templates } = await res.json();
    setRows(templates ?? []);
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    const url = editId ? `/api/admin/templates/${editId}` : "/api/admin/templates";
    const method = editId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setForm({ name: "", description: "", systemPrompt: "" }); setEditId(null); load(); }
  }

  async function del(id: string) {
    const res = await fetch(`/api/admin/templates/${id}`, { method: "DELETE", headers: auth() });
    if (res.ok) load();
    else { const { error } = await res.json(); alert(error ?? "Delete failed"); }
  }

  function edit(t: any) {
    setEditId(t.id);
    setForm({ name: t.name, description: t.description ?? "", systemPrompt: t.systemPrompt });
  }

  return (
    <div className="space-y-4">
      <div className="border border-slate-200 rounded p-3 space-y-2 bg-white">
        <h3 className="text-xs font-semibold text-slate-500">{editId ? "Edit template" : "New template"}</h3>
        <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Name"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Description"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <textarea className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono" rows={5}
          placeholder="System prompt — shapes how the AI writes the SOAP note"
          value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
        <div className="flex gap-2">
          <button onClick={submit} className="bg-slate-800 text-white rounded px-3 py-1 text-sm">
            {editId ? "Save changes" : "Create"}
          </button>
          {editId && <button onClick={() => { setEditId(null); setForm({ name: "", description: "", systemPrompt: "" }); }}
            className="border border-slate-300 rounded px-3 py-1 text-sm">Cancel</button>}
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((t) => (
          <div key={t.id} className="border border-slate-200 rounded p-3 bg-white">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-slate-800">{t.name}</span>
                {t.description && <span className="text-xs text-slate-400 ml-2">{t.description}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => edit(t)} className="text-xs border border-slate-300 rounded px-2 py-0.5">Edit</button>
                <button onClick={() => del(t.id)} className="text-xs border border-red-200 text-red-600 rounded px-2 py-0.5">Delete</button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2 font-mono line-clamp-2">{t.systemPrompt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}