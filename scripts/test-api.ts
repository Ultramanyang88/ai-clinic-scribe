/**
 * API integration test suite.
 * Requires the dev server to be running: npm run dev
 * Run with: npm test
 *
 * Tests every major API surface:
 *   auth, encounters (CRUD + draft + versioning), ICD-10 search,
 *   templates, admin endpoints, and non-happy-path scenarios.
 */

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// ── ANSI colours ──────────────────────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── Result tracking ────────────────────────────────────────────────────────────
type Result = { name: string; passed: boolean; note?: string };
const results: Result[] = [];

function pass(name: string, note?: string) {
  results.push({ name, passed: true, note });
  console.log(`  ${GREEN}✓${RESET} ${name}${note ? ` — ${note}` : ""}`);
}

function fail(name: string, note: string) {
  results.push({ name, passed: false, note });
  console.log(`  ${RED}✗${RESET} ${name} — ${note}`);
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function post(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token?: string) {
  return fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function patch(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── Individual test groups ─────────────────────────────────────────────────────

async function testAuth(): Promise<{ providerToken: string; adminToken: string }> {
  console.log(`\n${BOLD}Auth${RESET}`);

  // Valid provider login
  const r1 = await post("/api/auth/login", { email: "schen@clinic.test", password: "Password123!" });
  let providerToken = "";
  if (r1.ok) {
    const d = await r1.json();
    providerToken = d.token;
    pass("Provider login returns 200 + token", `role=${d.user.role}`);
  } else {
    fail("Provider login returns 200 + token", `status=${r1.status}`);
  }

  // Valid admin login
  const r2 = await post("/api/auth/login", { email: "admin@clinic.test", password: "Password123!" });
  let adminToken = "";
  if (r2.ok) {
    const d = await r2.json();
    adminToken = d.token;
    pass("Admin login returns 200 + token", `role=${d.user.role}`);
  } else {
    fail("Admin login returns 200 + token", `status=${r2.status}`);
  }

  // Wrong password
  const r3 = await post("/api/auth/login", { email: "schen@clinic.test", password: "wrong" });
  if (r3.status === 401) pass("Wrong password returns 401");
  else fail("Wrong password returns 401", `status=${r3.status}`);

  // Unknown user
  const r4 = await post("/api/auth/login", { email: "nobody@clinic.test", password: "Password123!" });
  if (r4.status === 401) pass("Unknown user returns 401");
  else fail("Unknown user returns 401", `status=${r4.status}`);

  // No token on protected route
  const r5 = await get("/api/encounters/draft");
  if (r5.status === 401) pass("Missing token returns 401 on protected route");
  else fail("Missing token returns 401 on protected route", `status=${r5.status}`);

  return { providerToken, adminToken };
}

async function testEncounters(token: string): Promise<string> {
  console.log(`\n${BOLD}Encounters${RESET}`);

  const patient = { firstName: "Test", lastName: "Patient", dob: "1985-03-15" };

  // Create encounter
  const r1 = await post("/api/encounters", { patient, transcript: "Initial draft." }, token);
  let encounterId = "";
  if (r1.ok) {
    const d = await r1.json();
    encounterId = d.encounterId;
    pass("POST /api/encounters creates a new encounter", `id=${encounterId}`);
  } else {
    fail("POST /api/encounters creates a new encounter", `status=${r1.status}`);
    return "";
  }

  // Missing patient fields
  const r2 = await post("/api/encounters", { patient: { firstName: "", lastName: "X", dob: "2000-01-01" }, transcript: "hi" }, token);
  if (r2.status === 400) pass("Missing patient fields returns 400");
  else fail("Missing patient fields returns 400", `status=${r2.status}`);

  // Autosave draft
  const r3 = await patch(
    `/api/encounters/${encounterId}/draft`,
    { draftTranscript: "Updated transcript.", draftWorkingNote: { subjective: "s", objective: "o", assessment: "a", plan: "p" } },
    token,
  );
  if (r3.ok) pass("PATCH draft autosaves transcript + working note");
  else fail("PATCH draft autosaves transcript + working note", `status=${r3.status}`);

  // Restore draft
  const r4 = await get("/api/encounters/draft", token);
  if (r4.ok) {
    const d = await r4.json();
    const ok = d.draft?.encounterId === encounterId && d.draft?.draftTranscript === "Updated transcript.";
    if (ok) pass("GET /api/encounters/draft restores the saved draft");
    else fail("GET /api/encounters/draft restores the saved draft", `mismatch: ${JSON.stringify(d.draft)}`);
  } else {
    fail("GET /api/encounters/draft restores the saved draft", `status=${r4.status}`);
  }

  return encounterId;
}

async function testVersioning(token: string, encounterId: string) {
  console.log(`\n${BOLD}Note versioning${RESET}`);

  if (!encounterId) { console.log(`  ${YELLOW}skip — no encounter id${RESET}`); return; }

  const note = { subjective: "Patient reports headache.", objective: "BP 120/80.", assessment: "G43.909 — Migraine.", plan: "Ibuprofen 400 mg prn." };

  // Save v1
  const r1 = await post("/api/encounters/save", { encounterId, content: note, icdCodes: [{ code: "G43.909", description: "Migraine" }] }, token);
  let v1: number | null = null;
  if (r1.ok) {
    const d = await r1.json();
    v1 = d.versionNumber;
    pass("Save creates version 1", `versionNumber=${v1}`);
  } else {
    fail("Save creates version 1", `status=${r1.status}`);
  }

  // Save same content — should be unchanged
  const r2 = await post("/api/encounters/save", { encounterId, content: note, icdCodes: [] }, token);
  if (r2.ok) {
    const d = await r2.json();
    if (d.unchanged) pass("Re-saving identical content returns unchanged=true");
    else fail("Re-saving identical content returns unchanged=true", `unchanged=${d.unchanged}`);
  }

  // Save v2 with edits
  const note2 = { ...note, plan: "Ibuprofen 400 mg prn + follow-up in 2 weeks." };
  const r3 = await post("/api/encounters/save", { encounterId, content: note2, icdCodes: [] }, token);
  let v2: number | null = null;
  if (r3.ok) {
    const d = await r3.json();
    v2 = d.versionNumber;
    pass("Editing and re-saving creates version 2", `versionNumber=${v2}`);
  } else {
    fail("Editing and re-saving creates version 2", `status=${r3.status}`);
  }

  // Version history contains both
  const r4 = await get(`/api/encounters/${encounterId}`, token);
  if (r4.ok) {
    const { versions } = await r4.json();
    const nums = (versions as { versionNumber: number }[]).map((v) => v.versionNumber).sort((a, b) => a - b);
    const hasV1 = v1 !== null && nums.includes(v1);
    const hasV2 = v2 !== null && nums.includes(v2);
    if (hasV1 && hasV2) pass("Version history contains both versions");
    else fail("Version history contains both versions", `found versions: ${nums.join(",")}`);
  } else {
    fail("Version history GET returns 200", `status=${r4.status}`);
  }
}

async function testIcd10Search(token: string) {
  console.log(`\n${BOLD}ICD-10 search${RESET}`);

  // Short query returns empty
  const r1 = await get("/api/icd10/search?q=a", token);
  if (r1.ok) {
    const d = await r1.json();
    if (Array.isArray(d) && d.length === 0) pass("Query shorter than 2 chars returns empty array");
    else fail("Query shorter than 2 chars returns empty array", `got ${JSON.stringify(d)}`);
  }

  // Meaningful query returns results
  const r2 = await get("/api/icd10/search?q=chest+pain", token);
  if (r2.ok) {
    const d = await r2.json();
    if (Array.isArray(d) && d.length > 0 && d[0].code && d[0].description) {
      pass("Searching 'chest pain' returns matching ICD-10 codes", `first result: ${d[0].code}`);
    } else {
      fail("Searching 'chest pain' returns matching ICD-10 codes", `got ${JSON.stringify(d).slice(0, 80)}`);
    }
  } else {
    fail("Searching 'chest pain' returns 200", `status=${r2.status}`);
  }

  // No auth
  const r3 = await get("/api/icd10/search?q=diabetes");
  if (r3.status === 401) pass("ICD-10 search requires auth");
  else fail("ICD-10 search requires auth", `status=${r3.status}`);
}

async function testTemplates(providerToken: string, adminToken: string): Promise<string> {
  console.log(`\n${BOLD}Templates${RESET}`);

  // Provider can list templates
  const r1 = await get("/api/admin/templates", providerToken);
  let firstTemplateId = "";
  if (r1.ok) {
    const { templates } = await r1.json();
    firstTemplateId = templates?.[0]?.id ?? "";
    pass("Provider can list templates", `count=${templates?.length}`);
  } else {
    fail("Provider can list templates", `status=${r1.status}`);
  }

  // Provider cannot create templates
  const r2 = await post("/api/admin/templates", { name: "X", systemPrompt: "Y" }, providerToken);
  if (r2.status === 403) pass("Provider cannot create templates (403)");
  else fail("Provider cannot create templates (403)", `status=${r2.status}`);

  // Admin can create a template
  const r3 = await post(
    "/api/admin/templates",
    { name: "Test Template", description: "auto-test", systemPrompt: "Write a concise SOAP note. Use INSUFFICIENT_CLINICAL_CONTENT if no clinical data." },
    adminToken,
  );
  let newId = "";
  if (r3.ok) {
    const d = await r3.json();
    newId = d.id;
    pass("Admin creates a template", `id=${newId}`);
  } else {
    fail("Admin creates a template", `status=${r3.status}`);
  }

  // Admin can edit the template
  if (newId) {
    const r4 = await patch(`/api/admin/templates/${newId}`, { name: "Test Template (edited)", description: "auto-test", systemPrompt: "Edited prompt." }, adminToken);
    if (r4.ok) pass("Admin edits template");
    else fail("Admin edits template", `status=${r4.status}`);
  }

  return firstTemplateId;
}

async function testAdminEncounters(adminToken: string) {
  console.log(`\n${BOLD}Admin — encounters${RESET}`);

  const r1 = await get("/api/admin/encounters", adminToken);
  if (r1.ok) {
    const { encounters } = await r1.json();
    pass("Admin lists all encounters", `count=${encounters?.length}`);
  } else {
    fail("Admin lists all encounters", `status=${r1.status}`);
  }

  // Provider cannot access admin encounters
  const r2 = await post("/api/auth/login", { email: "schen@clinic.test", password: "Password123!" });
  const { token: provTok } = await r2.json();
  const r3 = await get("/api/admin/encounters", provTok);
  if (r3.status === 403) pass("Provider cannot access admin encounters (403)");
  else fail("Provider cannot access admin encounters (403)", `status=${r3.status}`);
}

async function testAdminProviders(adminToken: string) {
  console.log(`\n${BOLD}Admin — providers${RESET}`);

  const r1 = await get("/api/admin/providers", adminToken);
  if (r1.ok) {
    const { providers } = await r1.json();
    pass("Admin lists providers", `count=${providers?.length}`);
  } else {
    fail("Admin lists providers", `status=${r1.status}`);
  }

  // Add a provider
  const email = `testprov_${Date.now()}@clinic.test`;
  const r2 = await post("/api/admin/providers", { firstName: "Auto", lastName: "Test", email, password: "Password123!" }, adminToken);
  let newProviderId = "";
  if (r2.ok) {
    const d = await r2.json();
    newProviderId = d.id;
    pass("Admin adds a new provider", `id=${newProviderId}`);
  } else {
    fail("Admin adds a new provider", `status=${r2.status}`);
  }

  // Deactivate the new provider
  if (newProviderId) {
    const r3 = await patch(`/api/admin/providers/${newProviderId}`, { isActive: false }, adminToken);
    if (r3.ok) pass("Admin deactivates provider");
    else fail("Admin deactivates provider", `status=${r3.status}`);

    // Deactivated provider cannot log in
    const r4 = await post("/api/auth/login", { email, password: "Password123!" });
    if (r4.status === 401) pass("Deactivated provider cannot log in (401)");
    else fail("Deactivated provider cannot log in (401)", `status=${r4.status}`);
  }

  // Duplicate email rejected
  const r5 = await post("/api/admin/providers", { firstName: "Dup", lastName: "Email", email: "schen@clinic.test", password: "Password123!" }, adminToken);
  if (r5.status === 409) pass("Duplicate email returns 409");
  else fail("Duplicate email returns 409", `status=${r5.status}`);
}

async function testNonHappyPaths(providerToken: string) {
  console.log(`\n${BOLD}Non-happy-path scenarios${RESET}`);

  // Scenario 1: empty / non-clinical transcript → generate should return 400 before hitting AI
  const emptyCheck = await post(
    "/api/generate",
    { transcript: "   ", patient: { firstName: "A", lastName: "B", dob: "2000-01-01" } },
    providerToken,
  );
  if (emptyCheck.status === 400) pass("Empty transcript short-circuits with 400 before AI call");
  else fail("Empty transcript short-circuits with 400", `status=${emptyCheck.status}`);

  // Scenario 2: expired / missing token on save
  const r2 = await post(
    "/api/encounters/save",
    { encounterId: "00000000-0000-0000-0000-000000000000", content: { subjective: "x" } },
  ); // no token
  if (r2.status === 401) pass("Save with no token returns 401 (session expired path)");
  else fail("Save with no token returns 401", `status=${r2.status}`);

  // Scenario 3: provider cannot save another provider's encounter
  const otherLogin = await post("/api/auth/login", { email: "jokafor@clinic.test", password: "Password123!" });
  const { token: otherToken } = await otherLogin.json();
  // Create an encounter with the other provider to get a real encounter id
  const encRes = await post(
    "/api/encounters",
    { patient: { firstName: "Cross", lastName: "Test", dob: "1990-06-01" }, transcript: "cross-provider test" },
    otherToken,
  );
  const { encounterId: otherId } = encRes.ok ? await encRes.json() : { encounterId: null };
  if (otherId) {
    const r3 = await post(
      "/api/encounters/save",
      { encounterId: otherId, content: { subjective: "hijack" } },
      providerToken, // different provider's token
    );
    if (r3.status === 403) pass("Provider cannot save another provider's encounter (403)");
    else fail("Provider cannot save another provider's encounter (403)", `status=${r3.status}`);
  } else {
    console.log(`  ${YELLOW}skip cross-provider check — could not create encounter${RESET}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${BOLD}Clinical Scribe — API Test Suite${RESET}`);
  console.log(`Target: ${BASE}\n`);

  // Confirm server is reachable
  try {
    await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch {
    console.error(`${RED}Cannot reach server at ${BASE}. Start it with: npm run dev${RESET}`);
    process.exit(1);
  }

  const { providerToken, adminToken } = await testAuth();
  const encounterId = await testEncounters(providerToken);
  await testVersioning(providerToken, encounterId);
  await testIcd10Search(providerToken);
  await testTemplates(providerToken, adminToken);
  await testAdminEncounters(adminToken);
  await testAdminProviders(adminToken);
  await testNonHappyPaths(providerToken);

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const failed = results.filter((r) => !r.passed);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${BOLD}Results: ${passed}/${total} passed${RESET}`);
  if (failed.length > 0) {
    console.log(`\n${RED}Failures:${RESET}`);
    failed.forEach((r) => console.log(`  ${RED}✗${RESET} ${r.name}${r.note ? ` — ${r.note}` : ""}`));
    process.exit(1);
  } else {
    console.log(`\n${GREEN}All tests passed.${RESET}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
