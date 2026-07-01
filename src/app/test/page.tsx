"use client";

/**
 * Frontend test suite — accessible at /test
 * Runs every API endpoint in the browser and shows pass/fail for each case.
 * Designed to work without any provider pre-seeded beyond the seed script defaults.
 */

import { useState } from "react";

type TestResult = { name: string; passed: boolean; note: string };

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function apiPost(path: string, body: unknown, token?: string) {
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(path: string, token?: string) {
  return fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function apiPatch(path: string, body: unknown, token?: string) {
  return fetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── Test runner ────────────────────────────────────────────────────────────────
async function runAllTests(
  onResult: (r: TestResult) => void,
  onSection: (s: string) => void,
): Promise<void> {
  function pass(name: string, note = "") {
    onResult({ name, passed: true, note });
  }
  function fail(name: string, note: string) {
    onResult({ name, passed: false, note });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  onSection("Auth");

  let providerToken = "";
  let adminToken = "";

  const r1 = await apiPost("/api/auth/login", { email: "schen@clinic.test", password: "Password123!" });
  if (r1.ok) {
    const d = await r1.json();
    providerToken = d.token;
    pass("Provider login (schen@clinic.test)", `role=${d.user.role}`);
  } else {
    fail("Provider login (schen@clinic.test)", `status=${r1.status}`);
  }

  const r2 = await apiPost("/api/auth/login", { email: "admin@clinic.test", password: "Password123!" });
  if (r2.ok) {
    const d = await r2.json();
    adminToken = d.token;
    pass("Admin login (admin@clinic.test)", `role=${d.user.role}`);
  } else {
    fail("Admin login (admin@clinic.test)", `status=${r2.status}`);
  }

  const r3 = await apiPost("/api/auth/login", { email: "schen@clinic.test", password: "wrong" });
  if (r3.status === 401) pass("Wrong password → 401");
  else fail("Wrong password → 401", `got ${r3.status}`);

  const r4 = await apiGet("/api/encounters/draft"); // no token
  if (r4.status === 401) pass("Protected route with no token → 401");
  else fail("Protected route with no token → 401", `got ${r4.status}`);

  if (!providerToken || !adminToken) {
    onSection("Skipping remaining tests — login failed");
    return;
  }

  // ── Encounters ────────────────────────────────────────────────────────────
  onSection("Encounters");

  const patient = { firstName: "Ui", lastName: "Testpatient", dob: "1990-01-01" };
  const encRes = await apiPost("/api/encounters", { patient, transcript: "Initial transcript." }, providerToken);
  let encounterId = "";
  if (encRes.ok) {
    const d = await encRes.json();
    encounterId = d.encounterId;
    pass("Create encounter", `id=${encounterId}`);
  } else {
    fail("Create encounter", `status=${encRes.status}`);
  }

  const badEnc = await apiPost(
    "/api/encounters",
    { patient: { firstName: "", lastName: "X", dob: "2000-01-01" }, transcript: "hi" },
    providerToken,
  );
  if (badEnc.status === 400) pass("Missing first name → 400");
  else fail("Missing first name → 400", `got ${badEnc.status}`);

  if (encounterId) {
    const patchR = await apiPatch(
      `/api/encounters/${encounterId}/draft`,
      { draftTranscript: "Patched transcript.", draftWorkingNote: { subjective: "s", objective: "o", assessment: "a", plan: "p" } },
      providerToken,
    );
    if (patchR.ok) pass("PATCH draft saves transcript + working note");
    else fail("PATCH draft saves transcript + working note", `status=${patchR.status}`);

    const draftR = await apiGet("/api/encounters/draft", providerToken);
    if (draftR.ok) {
      const d = await draftR.json();
      const ok = d.draft?.encounterId === encounterId && d.draft?.draftTranscript === "Patched transcript.";
      if (ok) pass("GET draft restores saved state");
      else fail("GET draft restores saved state", `mismatch: ${JSON.stringify(d.draft).slice(0, 80)}`);
    } else {
      fail("GET draft returns 200", `status=${draftR.status}`);
    }
  }

  // ── Note versioning ───────────────────────────────────────────────────────
  onSection("Note Versioning");

  if (encounterId) {
    const note = {
      subjective: "Patient reports persistent cough.",
      objective: "Lungs clear to auscultation.",
      assessment: "J06.9 — Acute upper respiratory infection.",
      plan: "Rest, fluids, follow up in 1 week.",
    };

    const sv1 = await apiPost("/api/encounters/save", { encounterId, content: note, icdCodes: [{ code: "J06.9", description: "Acute URI" }] }, providerToken);
    let v1: number | null = null;
    if (sv1.ok) {
      const d = await sv1.json();
      v1 = d.versionNumber;
      pass("Save note — creates version 1", `v=${v1}`);
    } else {
      fail("Save note — creates version 1", `status=${sv1.status}`);
    }

    // Identical content → unchanged
    const sv2 = await apiPost("/api/encounters/save", { encounterId, content: note, icdCodes: [] }, providerToken);
    if (sv2.ok) {
      const d = await sv2.json();
      if (d.unchanged) pass("Re-saving identical content → unchanged=true");
      else fail("Re-saving identical content → unchanged=true", `unchanged=${d.unchanged}`);
    }

    // Edit → version 2
    const note2 = { ...note, plan: "Rest, fluids, amoxicillin 500 mg TID x 7 days." };
    const sv3 = await apiPost("/api/encounters/save", { encounterId, content: note2, icdCodes: [] }, providerToken);
    let v2: number | null = null;
    if (sv3.ok) {
      const d = await sv3.json();
      v2 = d.versionNumber;
      pass("Edit and re-save → version 2", `v=${v2}`);
    } else {
      fail("Edit and re-save → version 2", `status=${sv3.status}`);
    }

    // Version history
    const histR = await apiGet(`/api/encounters/${encounterId}`, providerToken);
    if (histR.ok) {
      const { versions } = await histR.json();
      const nums = (versions as { versionNumber: number }[]).map((v) => v.versionNumber);
      const hasV1 = v1 !== null && nums.includes(v1);
      const hasV2 = v2 !== null && nums.includes(v2);
      if (hasV1 && hasV2) pass("Version history contains both versions");
      else fail("Version history contains both versions", `found: [${nums.join(",")}]`);
    } else {
      fail("GET version history returns 200", `status=${histR.status}`);
    }
  } else {
    fail("Versioning tests skipped", "no encounter created");
  }

  // ── ICD-10 search ─────────────────────────────────────────────────────────
  onSection("ICD-10 Search");

  const icd1 = await apiGet("/api/icd10/search?q=a", providerToken);
  if (icd1.ok) {
    const d = await icd1.json();
    if (Array.isArray(d) && d.length === 0) pass("Single-char query returns empty array");
    else fail("Single-char query returns empty array", `got ${JSON.stringify(d).slice(0, 60)}`);
  }

  const icd2 = await apiGet("/api/icd10/search?q=hypertension", providerToken);
  if (icd2.ok) {
    const d = await icd2.json();
    if (Array.isArray(d) && d.length > 0 && d[0].code) {
      pass("'hypertension' search returns codes", `first: ${d[0].code} — ${d[0].description.slice(0, 40)}`);
    } else {
      fail("'hypertension' search returns codes", `got ${JSON.stringify(d).slice(0, 80)}`);
    }
  } else {
    fail("'hypertension' search returns 200", `status=${icd2.status}`);
  }

  const icd3 = await apiGet("/api/icd10/search?q=diabetes");
  if (icd3.status === 401) pass("ICD-10 search requires auth → 401 without token");
  else fail("ICD-10 search requires auth → 401", `got ${icd3.status}`);

  // ── Templates ─────────────────────────────────────────────────────────────
  onSection("Templates");

  const tpl1 = await apiGet("/api/admin/templates", providerToken);
  if (tpl1.ok) {
    const { templates } = await tpl1.json();
    pass("Provider can list templates", `count=${templates?.length}`);
  } else {
    fail("Provider can list templates", `status=${tpl1.status}`);
  }

  const tpl2 = await apiPost("/api/admin/templates", { name: "X", systemPrompt: "Y" }, providerToken);
  if (tpl2.status === 403) pass("Provider cannot create templates → 403");
  else fail("Provider cannot create templates → 403", `got ${tpl2.status}`);

  const tpl3 = await apiPost(
    "/api/admin/templates",
    { name: `FE-Test-${Date.now()}`, description: "auto", systemPrompt: "Test system prompt." },
    adminToken,
  );
  let newTplId = "";
  if (tpl3.ok) {
    const d = await tpl3.json();
    newTplId = d.id;
    pass("Admin creates template", `id=${newTplId}`);
  } else {
    fail("Admin creates template", `status=${tpl3.status}`);
  }

  if (newTplId) {
    const tpl4 = await apiPatch(
      `/api/admin/templates/${newTplId}`,
      { name: "FE-Test-edited", description: "auto", systemPrompt: "Edited." },
      adminToken,
    );
    if (tpl4.ok) pass("Admin edits template");
    else fail("Admin edits template", `status=${tpl4.status}`);
  }

  // ── Admin — encounters ────────────────────────────────────────────────────
  onSection("Admin — Encounters");

  const ae1 = await apiGet("/api/admin/encounters", adminToken);
  if (ae1.ok) {
    const { encounters } = await ae1.json();
    pass("Admin lists all encounters", `count=${encounters?.length}`);
  } else {
    fail("Admin lists all encounters", `status=${ae1.status}`);
  }

  const ae2 = await apiGet("/api/admin/encounters", providerToken);
  if (ae2.status === 403) pass("Provider cannot access admin encounters → 403");
  else fail("Provider cannot access admin encounters → 403", `got ${ae2.status}`);

  // ── Admin — providers ─────────────────────────────────────────────────────
  onSection("Admin — Providers");

  const ap1 = await apiGet("/api/admin/providers", adminToken);
  if (ap1.ok) {
    const { providers } = await ap1.json();
    pass("Admin lists providers", `count=${providers?.length}`);
  } else {
    fail("Admin lists providers", `status=${ap1.status}`);
  }

  const email = `test_${Date.now()}@clinic.test`;
  const ap2 = await apiPost(
    "/api/admin/providers",
    { firstName: "FE", lastName: "Test", email, password: "Password123!" },
    adminToken,
  );
  let newPid = "";
  if (ap2.ok) {
    const d = await ap2.json();
    newPid = d.id;
    pass("Admin adds provider", `id=${newPid}`);
  } else {
    fail("Admin adds provider", `status=${ap2.status}`);
  }

  // Duplicate email
  const ap3 = await apiPost(
    "/api/admin/providers",
    { firstName: "Dup", lastName: "Email", email: "schen@clinic.test", password: "Password123!" },
    adminToken,
  );
  if (ap3.status === 409) pass("Duplicate email → 409");
  else fail("Duplicate email → 409", `got ${ap3.status}`);

  if (newPid) {
    const ap4 = await apiPatch(`/api/admin/providers/${newPid}`, { isActive: false }, adminToken);
    if (ap4.ok) pass("Admin deactivates provider");
    else fail("Admin deactivates provider", `status=${ap4.status}`);

    // Deactivated provider cannot log in
    const ap5 = await apiPost("/api/auth/login", { email, password: "Password123!" });
    if (ap5.status === 401) pass("Deactivated provider cannot log in → 401");
    else fail("Deactivated provider cannot log in → 401", `got ${ap5.status}`);
  }

  // ── Non-happy-path scenarios ───────────────────────────────────────────────
  onSection("Non-happy-path Scenarios");

  // 1. Whitespace-only transcript rejected before AI call
  const nh1 = await apiPost(
    "/api/generate",
    { transcript: "    ", patient: { firstName: "A", lastName: "B", dob: "2000-01-01" } },
    providerToken,
  );
  if (nh1.status === 400) pass("Whitespace-only transcript → 400 (no AI call made)");
  else fail("Whitespace-only transcript → 400", `got ${nh1.status}`);

  // 2. Save with no session token (simulate expired session)
  const nh2 = await apiPost(
    "/api/encounters/save",
    { encounterId: "00000000-0000-0000-0000-000000000000", content: { subjective: "x" } },
  );
  if (nh2.status === 401) pass("Save without token → 401 (session expired scenario)");
  else fail("Save without token → 401", `got ${nh2.status}`);

  // 3. Cross-provider note save should be forbidden
  if (encounterId) {
    const otherLogin = await apiPost("/api/auth/login", { email: "jokafor@clinic.test", password: "Password123!" });
    if (otherLogin.ok) {
      const { token: otherTok } = await otherLogin.json();
      const nh3 = await apiPost(
        "/api/encounters/save",
        { encounterId, content: { subjective: "hijack" } },
        otherTok,
      );
      if (nh3.status === 403) pass("Another provider cannot save this encounter → 403");
      else fail("Another provider cannot save this encounter → 403", `got ${nh3.status}`);
    }
  }
}

// ── UI ─────────────────────────────────────────────────────────────────────────
export default function TestPage() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [sections, setSections] = useState<{ idx: number; name: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function run() {
    setResults([]);
    setSections([]);
    setRunning(true);
    setDone(false);

    let resultCount = 0;

    await runAllTests(
      (r) => {
        resultCount++;
        setResults((prev) => [...prev, r]);
      },
      (name) => {
        setResults((prev) => {
          setSections((s) => [...s, { idx: prev.length, name }]);
          return prev;
        });
      },
    );

    setRunning(false);
    setDone(true);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  // Build display list: interleave section headers and results
  type DisplayItem =
    | { type: "section"; name: string }
    | { type: "result"; result: TestResult };

  const items: DisplayItem[] = [];
  let sectionIdx = 0;
  for (let i = 0; i < results.length; i++) {
    while (sectionIdx < sections.length && sections[sectionIdx].idx === i) {
      items.push({ type: "section", name: sections[sectionIdx].name });
      sectionIdx++;
    }
    items.push({ type: "result", result: results[i] });
  }
  // Trailing sections (e.g. a section declared at the very end)
  while (sectionIdx < sections.length) {
    items.push({ type: "section", name: sections[sectionIdx].name });
    sectionIdx++;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-base font-semibold text-slate-800">Clinical Scribe — Test Suite</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Exercises every API endpoint end-to-end in the browser.
              Requires the dev server to have a seeded database.
            </p>
          </div>
          <div className="flex gap-3 items-center">
            <a href="/workspace" className="text-xs text-slate-400 hover:text-slate-600 underline">Workspace</a>
            <button
              onClick={run}
              disabled={running}
              className="bg-slate-800 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {running ? "Running…" : done ? "Run again" : "Run tests"}
            </button>
          </div>
        </div>

        {/* Summary bar */}
        {(running || done) && (
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-emerald-600 font-medium">{passed} passed</span>
            <span className={failed > 0 ? "text-red-600 font-medium" : "text-slate-400"}>{failed} failed</span>
            {running && <span className="text-slate-400">running…</span>}
            {done && !running && (
              <span className={failed === 0 ? "text-emerald-600" : "text-red-600"}>
                {failed === 0 ? "All tests passed ✓" : `${failed} test${failed > 1 ? "s" : ""} failed`}
              </span>
            )}
          </div>
        )}

        {/* Results list */}
        {items.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {items.map((item, i) =>
              item.type === "section" ? (
                <div
                  key={`s-${i}`}
                  className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide"
                >
                  {item.name}
                </div>
              ) : (
                <div
                  key={`r-${i}`}
                  className={`flex items-start gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 ${
                    item.result.passed ? "" : "bg-red-50"
                  }`}
                >
                  <span
                    className={`mt-0.5 text-xs font-bold shrink-0 ${
                      item.result.passed ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {item.result.passed ? "PASS" : "FAIL"}
                  </span>
                  <div className="min-w-0">
                    <span className="text-sm text-slate-800">{item.result.name}</span>
                    {item.result.note && (
                      <span className="text-xs text-slate-400 ml-2">{item.result.note}</span>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* Idle state */}
        {!running && !done && (
          <div className="text-center py-16 text-slate-400 text-sm">
            Click <strong className="text-slate-600">Run tests</strong> to start.
          </div>
        )}

        {/* CLI note */}
        <p className="mt-4 text-xs text-slate-400">
          You can also run these tests from the terminal:{" "}
          <code className="bg-slate-100 px-1 rounded">npm test</code> (requires the dev server running on{" "}
          <code className="bg-slate-100 px-1 rounded">localhost:3000</code>).
        </p>
      </div>
    </div>
  );
}
