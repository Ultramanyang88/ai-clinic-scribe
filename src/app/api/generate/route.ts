export const runtime = "nodejs";

import { db } from "@/db";
import { providers, templates } from "@/db/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { requireAuth } from "@/lib/auth";
import { SCRIBE_SYSTEM_PROMPT } from "@/lib/prompts";
import { fetchPatientHistory } from "@/lib/history";

const historyTool = {
  type: "function" as const,
  function: {
    name: "get_patient_history",
    description:
      "Retrieve this patient's prior encounter notes (assessments, plans, diagnoses) from the " +
      "clinical database. Call before writing the note to check whether the patient is returning.",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        dob: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["first_name", "last_name", "dob"],
    },
  },
};

export async function POST(req: Request) {
  const session = requireAuth(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  // Non-happy-path: admin deactivated this provider after they logged in.
  // JWT is still valid, but the account is suspended — block generation gracefully.
  const caller = await db.query.providers.findFirst({ where: eq(providers.id, session.sub) });
  if (!caller?.isActive) return new Response("Account deactivated", { status: 403 });

  const { transcript, patient, encounterId, templateId } = await req.json();
  if (!transcript?.trim()) return new Response("Empty transcript", { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = "gpt-4o";

  let historyContext = "No prior encounters on record (first-time visit).";
  if (patient?.firstName && patient?.lastName && patient?.dob) {
    const router = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You retrieve patient history. Call get_patient_history with the given identifiers." },
        { role: "user", content: `Patient: ${patient.firstName} ${patient.lastName}, DOB ${patient.dob}. Retrieve prior history.` },
      ],
      tools: [historyTool],
      tool_choice: { type: "function", function: { name: "get_patient_history" } },
    });

    const toolCall = router.choices[0].message.tool_calls?.[0];
    if (toolCall?.type === "function") {
      const args = JSON.parse(toolCall.function.arguments) as
        { first_name: string; last_name: string; dob: string };
      historyContext = await fetchPatientHistory(args, encounterId ?? "");
    }
  }

  let systemPrompt = SCRIBE_SYSTEM_PROMPT; 
  if (templateId) {
    const tpl = await db.query.templates.findFirst({ where: eq(templates.id, templateId) });
    if (tpl) systemPrompt = tpl.systemPrompt;
  }

  const userContent =
    `PATIENT HISTORY (retrieved via database tool):\n${historyContext}\n\n` +
    `CURRENT ENCOUNTER TRANSCRIPT:\n${transcript}`;

  const completion = await openai.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}