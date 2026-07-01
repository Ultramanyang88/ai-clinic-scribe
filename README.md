# AI Clinical Scribe Platform

A provider-facing AI clinical documentation platform. A physician pastes a raw encounter transcript (or types freeform clinical observations), and the system generates a structured, editable **SOAP note** (Subjective, Objective, Assessment, Plan) with semantically matched **ICD-10 diagnosis codes** — streamed in real time, persisted with a full audit trail, and served from a production-grade AWS deployment.

Built for the Kyron Medical technical challenge.

---

## Live Demo

**URL:** https://18-225-135-108.nip.io

All demo accounts use the password `Password123!`

| Email | Role |
|---|---|
| `schen@clinic.test` | Provider (primary demo account) |
| `jokafor@clinic.test` | Provider |
| `mlopez@clinic.test` | Provider |
| `admin@clinic.test` | Admin |

> **Suggested path:** log in as `schen`, generate a note for **John Smith / 1980-01-01**, save it, then start a *second* encounter for the same patient to watch prior-history injection change the output. Log in as `admin` to see all encounters across providers and edit note templates live.

---

## What It Does

1. **Generate** — provider enters a patient, pastes a transcript, picks a template, and the SOAP note streams back token by token.
2. **Contextualize** — if the patient has prior notes, the AI pulls that history through a backend tool call and references it.
3. **Edit & save** — the note is editable inline; every save writes a new immutable version.
4. **Code** — a semantic ICD-10 search suggests diagnosis codes that append into the Assessment.
5. **Administer** — admins manage providers and templates, and review every encounter.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) — unified UI + API routes, native streaming |
| ORM / DB | Drizzle ORM · PostgreSQL on AWS RDS |
| AI | OpenAI API (function calling for retrieval + token streaming) |
| Compute | AWS EC2 (Amazon Linux 2023, us-east-2), PM2 process manager |
| Edge | nginx reverse proxy + Let's Encrypt SSL |
| Secrets | AWS Secrets Manager, accessed via EC2 IAM instance role |

---

## Infrastructure

The infrastructure was treated as a first-class deliverable. The goal was a deployment that behaves like a real production system: TLS everywhere, the database fully isolated from the public internet, no credentials on disk, and a process that survives restarts.

### Topology

```
                          Internet
                             │
                             │  HTTPS (443)
                             ▼
                   ┌──────────────────────┐
                   │   Elastic IP          │   18.225.135.108
                   │   18-225-135-108.nip.io│   (stable public address)
                   └──────────┬───────────┘
                              │
         ┌────────────────────▼─────────────────────┐
         │              EC2 instance (VPC)            │
         │                                            │
         │   nginx :443  ── Let's Encrypt TLS         │
         │      │         proxy_buffering off         │
         │      │  (reverse proxy, HTTP→HTTPS redirect)│
         │      ▼                                      │
         │   Next.js app :3000  (PM2-managed)          │
         │      │  - single pooled pg client           │
         │      │  - secrets injected at startup        │
         │      ▼                                      │
         └──────┼──────────────────────────────────────┘
                │  TLS, VPC-internal only
                ▼
       ┌──────────────────────┐        ┌─────────────────────┐
       │  RDS PostgreSQL       │        │  AWS Secrets Manager │
       │  private subnet       │        │  scribe/prob         │
       │  no public access     │        │  (DB URL, API key,   │
       │  SG: EC2 SG only       │◄───────│   JWT secret)        │
       └──────────────────────┘  read   └─────────────────────┘
                                  via EC2 IAM role
```

### Components

**Elastic IP + DNS.** A static Elastic IP (`18.225.135.108`) is attached to the EC2 instance so the public address survives reboots. The domain `18-225-135-108.nip.io` resolves to it via nip.io wildcard DNS, which is what the TLS certificate is issued against.

**EC2 (compute).** A single Amazon Linux 2023 instance in the VPC runs nginx and the Node application. The application process is managed by **PM2**, registered as a systemd service so it restarts on crash and on reboot. A 2 GB swap file backs the small instance during builds.

**nginx (reverse proxy + TLS termination).** nginx listens on 443, terminates TLS with the Let's Encrypt certificate, and reverse-proxies to the app on `127.0.0.1:3000`. The application is **never directly exposed** on 80 or 443. nginx is configured with `proxy_buffering off` (paired with an `X-Accel-Buffering: no` response header) so the SOAP-note token stream passes through unbuffered rather than being collected and dumped at once. HTTP on 80 is redirected to HTTPS.

**TLS / SSL.** A real Let's Encrypt certificate (issued via certbot, auto-deployed into the nginx config) — not a self-signed cert. The address bar shows a valid padlock.

**RDS PostgreSQL (data).** All persistent data — providers, patients, encounters, note versions, templates, ICD-10 codes — lives in PostgreSQL on RDS. There are no SQLite files, flat files, or in-memory stores for anything of record. The instance is **not publicly accessible**: it sits in a private subnet, and its security group accepts connections **only from the EC2 instance's security group**, not from the public internet. The application reaches it over a TLS-encrypted connection inside the VPC.

**Connection pooling.** The app holds a **single `pg` connection pool** (`max: 10`), cached on `globalThis`. It never opens a new connection per request, and the `globalThis` cache prevents pool leakage across Next.js module reloads. The pool is created lazily on first use.

```ts
const g = globalThis as { _pool?: Pool };
function getPool() {
  if (!g._pool) g._pool = new Pool({ connectionString: ..., max: 10 });
  return g._pool;
}
export const db = drizzle(getPool(), { schema });
```

**AWS Secrets Manager (secrets).** The database URL, OpenAI API key, and JWT secret are stored in a Secrets Manager secret (`scribe/prob`). At process startup, the app's instrumentation hook reads the secret and injects the values into the environment. The EC2 instance carries an **IAM instance role** granting it `GetSecretValue`, so it authenticates with short-lived role credentials — **no long-term AWS keys live on the machine, and no credentials are committed to the repo** (no `.env` with secrets; see `.env.example`).

### Security boundaries summary

| Boundary | Control |
|---|---|
| Public → app | Only 443 (TLS) is reachable; app port 3000 is bound to localhost |
| App → database | VPC-internal only; RDS SG allows the EC2 SG exclusively; TLS in transit |
| Database → internet | None — RDS has public access disabled |
| Secrets at rest | Secrets Manager (KMS-encrypted); none on disk or in repo |
| Secrets in use | Fetched at startup via EC2 IAM role's temporary credentials |
| Process lifecycle | PM2 + systemd; auto-restart on crash/reboot |

---

## Application Architecture

### Streaming generation
The generate route opens a streaming response and pipes OpenAI's token stream straight to the browser via the Web Streams API, so the note renders progressively. The nginx `proxy_buffering off` setting (above) is what keeps that stream intact through the reverse proxy.

### Patient history via tool use
History injection is a two-phase, server-side tool-use flow: the model is given a `get_patient_history` function with a forced `tool_choice`; the backend runs the DB query and feeds the result into a second generation pass. The frontend only sends identifiers, so PHI never leaves the server. A returning patient's note references prior conditions; a new patient's does not.

### ICD-10 semantic search
Retrieve-then-rerank: a SQL filter pulls a candidate shortlist, the model reranks it semantically, and every returned code is validated against the candidate set so the model cannot invent a code. Falls back to keyword matches if the model call fails.

### Note versioning
Append-only audit trail. Each save inserts a new row; a row lock plus `UNIQUE(encounter_id, version_number)` prevents concurrent saves from corrupting the sequence; a dirty-check skips no-op saves. `saved_by` / `saved_at` capture who and when.

### Session persistence
Drafts are autosaved to the database (not browser storage), so refresh, browser-close, and cross-device login all restore in-progress work — and the session-expiry edge case is lossless because autosave has already persisted the draft.

---

## Database Schema

Six tables, normalized to 3NF. Full ERD and per-table rationale are in `DESIGN.md` / `ERD.png`.

| Table | Purpose |
|---|---|
| `providers` | User roster (Provider + Admin); bcrypt hashes; `is_active` soft-deactivation |
| `patients` | `UNIQUE(first_name, last_name, dob)` — the key that makes history retrieval deterministic |
| `encounters` | One row per visit; links patient/provider/template; holds autosaved draft state |
| `note_versions` | Append-only audit trail; `UNIQUE(encounter_id, version_number)` |
| `templates` | Admin-managed system prompts; read fresh from DB each generation |
| `icd10_codes` | Local ICD-10 reference table (no FK — codes are snapshotted into `note_versions`) |

**Indexes:** `encounters.patient_id`, `encounters.provider_id`, `note_versions.encounter_id`.

---

## Requirement Coverage

**Core:** JWT auth with Provider/Admin roles and server-side encounter isolation · streamed SOAP generation · backend tool-call history injection · append-only versioning with audit fields · semantic ICD-10 search with anti-hallucination validation · admin dashboard with live template updates · cross-device draft persistence · graceful handling of empty input and expired sessions.

**Infrastructure:** EC2 + Let's Encrypt HTTPS · all data in RDS · single pooled DB client · Secrets Manager via IAM role · nginx reverse proxy (app not directly exposed) · RDS private to the VPC.

---

## Known Simplifications

Deliberate, scoped trade-offs (production direction noted):

- **Patient match by name + DOB** → production would use an MRN.
- **RDS TLS uses `sslmode=no-verify`** (encrypted, CA not verified) → production would use `verify-full` with the RDS CA bundle.
- **Single EC2 instance**, no load balancer → production would add an ALB + auto-scaling group, multi-AZ.
- **IAM uses a managed Secrets Manager read policy** → production would scope to `GetSecretValue` on the single secret ARN.
- **Build skips type-checking** for speed on a small instance → enforced in development; a CI gate would run it.

---

## Running Locally

```bash
npm install

# create .env.local (see .env.example)
#   DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db>?sslmode=no-verify
#   OPENAI_API_KEY=sk-...
#   JWT_SECRET=<random secret>
#   USE_SECRETS_MANAGER=false

npm run db:push      # apply schema
npm run db:seed      # seed providers, templates, ICD-10 codes
npm run dev          # http://localhost:3000
```

> The ICD-10 dataset is fully loaded in the live deployment. To populate it locally, run the parser (`scripts/parse-icd.ts`) against the CMS ICD-10 order file before seeding.

In production (`USE_SECRETS_MANAGER=true`), secrets are loaded from AWS Secrets Manager at startup instead of from `.env.local`.

---

## Documentation

- **`DESIGN.md`** — full architecture, ERD, table-by-table rationale, and design trade-offs.
- **`ERD.png`** — entity relationship diagram.
- **Walkthrough video** — live demo plus a code and infrastructure tour.
