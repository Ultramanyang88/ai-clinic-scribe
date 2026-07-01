"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Soap = { subjective: string; objective: string; assessment: string; plan: string };
const EMPTY: Soap = { subjective: "", objective: "", assessment: "", plan: "" };

function parseSoap(md: string): Soap {
  const sec = (name: string) => {
    const re = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    return md.match(re)?.[1]?.trim() ?? "";
  };
  return {
    subjective: sec("Subjective"), objective: sec("Objective"),
    assessment: sec("Assessment"), plan: sec("Plan"),
  };
}

function extractIcd(assessment: string) {
  const re = /\b([A-Z]\d{2}(?:\.\d{1,4})?)\s*[—\-:]\s*([^\n]+)/g;
  const out: { code: string; description: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(assessment))) out.push({ code: m[1], description: m[2].trim() });
  return out;
}

export default function Workspace() {
  const router = useRouter();

  const [patient, setPatient] = useState({ firstName: "", lastName: "", dob: "" });
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [raw, setRaw] = useState("");
  const [soap, setSoap] = useState<Soap>(EMPTY);
  const [insufficient, setInsufficient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [history, setHistory] = useState<any[] | null>(null);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState<string>("");

  const [icdQuery, setIcdQuery] = useState("");
  const [icdResults, setIcdResults] = useState<any[]>([]);

  const token = () => sessionStorage.getItem("token");
  const patientReady = !!(patient.firstName.trim() && patient.lastName.trim() && patient.dob);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restored, setRestored] = useState(false);

  // Auth guard — redirect to login if no token is present.
  useEffect(() => {
    if (!token()) router.replace("/login");
  }, []);

  // On mount: restore any in-progress draft from the database.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/encounters/draft", {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const { draft } = await res.json();
        if (draft) {
          setEncounterId(draft.encounterId);
          if (draft.patient) setPatient(draft.patient);
          setTranscript(draft.draftTranscript ?? "");
          if (draft.draftWorkingNote) setSoap(draft.draftWorkingNote);
        }
      } finally {
        setRestored(true);
      }
    })();
  }, []);

  // Fetch available note templates for the dropdown.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/templates", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const { templates } = await res.json();
      setTemplates(templates ?? []);
      if (templates?.length) setTemplateId(templates[0].id);
    })();
  }, []);

  // Debounced autosave: persist draft to DB 1.2 s after the last change.
  useEffect(() => {
    if (!restored || !encounterId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/encounters/${encounterId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ draftTranscript: transcript, draftWorkingNote: soap }),
      });
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [transcript, soap, encounterId, restored]);

  function updatePatient(field: keyof typeof patient, v: string) {
    setPatient((p) => ({ ...p, [field]: v }));
    setEncounterId(null); setSoap(EMPTY); setRaw("");
    setInsufficient(false); setHistory(null); setSavedMsg("");
  }

  async function ensureEncounter(): Promise<string> {
    if (encounterId) return encounterId;
    const res = await fetch("/api/encounters", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ patient, transcript }),
    });
    const { encounterId: id } = await res.json();
    setEncounterId(id);
    return id;
  }

  async function generate() {
    setRaw(""); setSoap(EMPTY); setInsufficient(false);
    setSavedMsg(""); setHistory(null); setLoading(true);
    const id = await ensureEncounter();

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ transcript, patient, encounterId: id, templateId }),
    });
    if (!res.ok || !res.body) { setRaw(`Error: ${res.status}`); setLoading(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setRaw(acc);
    }
    setLoading(false);

    if (acc.includes("INSUFFICIENT_CLINICAL_CONTENT")) { setInsufficient(true); return; }
    setSoap(parseSoap(acc));
  }

  async function save() {
    if (!encounterId) return;
    setSavedMsg("Saving…");
    const res = await fetch("/api/encounters/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ encounterId, content: soap, icdCodes: extractIcd(soap.assessment) }),
    });

    // Non-happy-path: session expired. Draft is auto-saved; redirect to sign in.
    if (res.status === 401) {
      setSavedMsg("Session expired — your work is auto-saved. Redirecting to sign in…");
      setTimeout(() => { sessionStorage.clear(); router.replace("/login"); }, 2500);
      return;
    }
    // Non-happy-path: account deactivated by admin while draft was open. Draft is preserved.
    if (res.status === 403) {
      setSavedMsg("Your account has been deactivated. Contact your administrator. Your draft is preserved.");
      return;
    }

    if (res.ok) {
      const { versionNumber, unchanged } = await res.json();
      setSavedMsg(unchanged ? "No changes to save" : `Saved as v${versionNumber}`);
      if (history) loadHistory();
    } else {
      setSavedMsg(`Save failed (${res.status})`);
    }
  }

  async function loadHistory() {
    if (!encounterId) return;
    const res = await fetch(`/api/encounters/${encounterId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const { versions } = await res.json();
    setHistory(versions);
  }

  async function searchIcd(q: string) {
    setIcdQuery(q);
    if (q.trim().length < 2) { setIcdResults([]); return; }
    const res = await fetch(`/api/icd10/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    setIcdResults(await res.json());
  }

  function appendIcd(code: string, description: string) {
    setSoap((s) => ({
      ...s,
      assessment: s.assessment ? `${s.assessment}\n${code} — ${description}` : `${code} — ${description}`,
    }));
    setIcdQuery(""); setIcdResults([]);
  }

  const hasNote = !!(soap.subjective || soap.objective || soap.assessment || soap.plan);

  function signOut() {
    sessionStorage.clear();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-slate-800">Encounter Workspace</h1>
          <div className="flex gap-3 items-center">
            <a href="/test" className="text-xs text-slate-400 hover:text-slate-600 underline">Test suite</a>
            <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-700">Sign out</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {/* left: input */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                placeholder="First name" value={patient.firstName}
                onChange={(e) => updatePatient("firstName", e.target.value)} />
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                placeholder="Last name" value={patient.lastName}
                onChange={(e) => updatePatient("lastName", e.target.value)} />
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" type="date"
                value={patient.dob} onChange={(e) => updatePatient("dob", e.target.value)} />
            </div>
            <textarea className="w-full h-72 border border-slate-300 rounded p-3 text-sm font-mono"
              placeholder="Paste encounter transcript or type clinical observations…"
              value={transcript} onChange={(e) => setTranscript(e.target.value)} />

            {/* ICD-10 search widget */}
            <div className="border border-slate-200 rounded p-2 bg-white">
              <label className="text-xs uppercase tracking-wide text-slate-400">ICD-10 search</label>
              <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mt-1"
                placeholder="Search symptom or condition (e.g. chest pain)"
                value={icdQuery} onChange={(e) => searchIcd(e.target.value)} />
              {icdResults.length > 0 && (
                <div className="mt-1 border border-slate-100 rounded divide-y divide-slate-100 max-h-48 overflow-auto">
                  {icdResults.map((r) => (
                    <button key={r.id ?? r.code} onClick={() => appendIcd(r.code, r.description)}
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{r.code}</span>
                      <span className="text-slate-500"> — {r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* note template */}
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Note template</label>
              <select className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mt-1"
                value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <button onClick={generate} disabled={loading || !transcript.trim() || !patientReady}
              className="bg-slate-800 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50">
              {loading ? "Generating…" : "Generate Note"}
            </button>
            {!patientReady && (
              <p className="text-xs text-slate-400">Enter patient first name, last name, and DOB to start.</p>
            )}
          </div>

          {/* right: SOAP */}
          <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-500 tracking-wide">SOAP NOTE</h2>
              {savedMsg && <span className="text-xs text-emerald-600">{savedMsg}</span>}
            </div>

            {insufficient && (
              <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded p-3">
                No clinically meaningful content detected. Add encounter details before generating a note.
              </p>
            )}

            {loading && (
              <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">
                {raw || <span className="text-slate-400">Generating…</span>}
              </pre>
            )}

            {!loading && hasNote && !insufficient && (
              <>
                {(["subjective", "objective", "assessment", "plan"] as const).map((k) => (
                  <div key={k}>
                    <label className="text-xs uppercase tracking-wide text-slate-400">{k}</label>
                    <textarea className="w-full border border-slate-200 rounded p-2 text-sm mt-1"
                      rows={k === "assessment" || k === "plan" ? 4 : 3}
                      value={soap[k]} onChange={(e) => setSoap((s) => ({ ...s, [k]: e.target.value }))} />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={save}
                    className="bg-slate-800 text-white rounded px-4 py-2 text-sm font-medium">Save note</button>
                  <button onClick={loadHistory}
                    className="border border-slate-300 rounded px-4 py-2 text-sm">Version history</button>
                </div>
              </>
            )}

            {!loading && !hasNote && !insufficient && (
              <p className="text-sm text-slate-400">Generated note will stream here…</p>
            )}

            {history && (
              <div className="border-t border-slate-200 pt-3 mt-3 space-y-2">
                <h3 className="text-xs font-semibold text-slate-500">VERSION HISTORY</h3>
                {history.length === 0 && <p className="text-sm text-slate-400">No saved versions yet.</p>}
                {history.map((v) => (
                  <div key={v.versionNumber}
                    className="text-xs text-slate-600 border border-slate-100 rounded p-2">
                    <span className="font-medium">v{v.versionNumber}</span> · {v.savedByName} ·{" "}
                    {new Date(v.savedAt).toLocaleString()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}