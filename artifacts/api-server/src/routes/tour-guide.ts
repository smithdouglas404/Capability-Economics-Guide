/**
 * AI tour guide chat endpoint.
 *
 * Streaming chat (Vercel AI SDK protocol). The frontend tour-guide
 * component (components/ai-tour-guide.tsx) hits this with:
 *   - messages: standard chat history
 *   - persona: PE / VC / F500 / student / professor (from localStorage)
 *   - pageContext: { path, title, summary } from the current page so the
 *     guide can answer "what does this mean for me" without the user
 *     having to re-explain what they're looking at
 *
 * The system prompt is composed at request time from persona +
 * pageContext so each response is grounded in (a) who is asking and
 * (b) what they're currently looking at. Persona-aware framing comes
 * from the same source-of-truth list that lib/persona.ts uses on the
 * frontend.
 *
 * Cost: routes through @ai-sdk/openai-compatible → OpenRouter, so it
 * benefits from the same `usage: { include: true }` exact-cost tracking
 * (workflows fetch interceptor in services/workflows/models.ts).
 */

import { Router, type IRouter } from "express";
import { streamText, convertToCoreMessages, type CoreMessage, type UIMessage } from "ai";
import { sonnet } from "../services/workflows/models";

const router: IRouter = Router();

const PERSONA_FRAMING: Record<string, string> = {
  pe: `The user is a PRIVATE EQUITY professional. Frame everything for an investment-committee audience:
- Talk in terms of gap-to-leader, cost-to-close, EVaR (enterprise value at risk), IRR sensitivity, defensibility moats.
- When you describe a capability, give them the diligence implication: "if this score holds, the multiple should be X; if it slips, the multiple compresses."
- Lead with the number that goes in the IC memo. End with the risk that kills the deal.`,
  vc: `The user is a VENTURE CAPITAL professional. Frame everything for thesis-formation and pre-meeting prep:
- Talk in terms of where value is migrating, which nodes in the capability stack are getting capital, which startup categories haven't been claimed yet.
- When you describe a number, ground it in a thesis: "this rising velocity means category X is becoming investable in the next 6-12 months."
- Lead with the wedge. End with one question to ask a founder.`,
  f500: `The user is a FORTUNE 500 strategy / CTO leader. Frame everything for board-grade strategic decisions:
- Talk in terms of peer benchmark gaps, build/buy/partner posture, 18-month roadmaps, capex ROI.
- When you describe a capability, anchor it to "where are you relative to cohort median, and what's the closure cost?"
- Lead with the gap. End with the recommended action (build, buy, or partner).`,
  student: `The user is a STUDENT learning capability economics. Frame everything pedagogically:
- Don't assume jargon — define terms inline the first time they appear (CVI, moat, EVaR, posterior, confidence interval).
- Walk through reasoning step by step; show why a number is what it is, not just what it is.
- Lead with the concept. End with a worked example or a question to think about.`,
  professor: `The user is a COLLEGE PROFESSOR using this for research or teaching. Frame everything academically:
- Cite the methodology behind any number — point to /methodology for derivation, reference the open-source engine when relevant.
- Distinguish observation from inference; flag uncertainty.
- Lead with the method. End with how this could be used in a class assignment or paper.`,
};

const PERSONA_FRAMING_DEFAULT = `The user hasn't selected a persona. Be helpful and clear; ask 1-2 questions about their role if relevant.`;

interface ChatRequestBody {
  messages: UIMessage[] | CoreMessage[];
  persona?: string | null;
  pageContext?: {
    path?: string;
    title?: string;
    summary?: string;
  };
  learningContext?: {
    lastVisitedAt: string | null;
    totalAiGenerations: number;
    topIndustries: string[];
  };
}

router.post("/tour-guide/chat", async (req, res) => {
  try {
    const body = req.body as ChatRequestBody;
    const incomingMessages = Array.isArray(body.messages) ? body.messages : [];

    const personaKey = typeof body.persona === "string" ? body.persona : null;
    const personaFraming = (personaKey && PERSONA_FRAMING[personaKey]) || PERSONA_FRAMING_DEFAULT;

    const ctx = body.pageContext ?? {};
    const pageContextBlock = [
      ctx.path ? `Page path: ${ctx.path}` : null,
      ctx.title ? `Page title: ${ctx.title}` : null,
      ctx.summary ? `What the page shows: ${ctx.summary}` : null,
    ].filter(Boolean).join("\n");

    // Build proactive reachback from learning context
    const lc = body.learningContext;
    let reachbackBlock = "";
    if (lc) {
      const parts: string[] = [];
      if (lc.lastVisitedAt) {
        const lastVisit = new Date(lc.lastVisitedAt);
        const daysAgo = Math.floor((Date.now() - lastVisit.getTime()) / 86400000);
        if (daysAgo > 0) parts.push(`This user last visited ${daysAgo} day(s) ago. If shown in the UI today for the first time, greet them appropriately as a returning visitor.`);
      }
      if (lc.totalAiGenerations > 0) parts.push(`The user has generated ${lc.totalAiGenerations} AI brief(s) across their sessions.`);
      if (lc.topIndustries.length > 0) parts.push(`Industries this user has shown interest in: ${lc.topIndustries.join(", ")}. Reference these when relevant.`);
      if (parts.length > 0) {
        reachbackBlock = `\n\nUSER HISTORY (learned from past sessions):\n${parts.join("\n")}\n\nWhen greeting this user, aknowledge their return and reference what they were doing before when appropriate. For example: "Welcome back! It's been a while since your last visit. I see you were looking at ${lc.topIndustries[0] ?? "capability data"} before."`;
      }
    }

    const systemPrompt = `You are the Capability Economics tour guide. You help visitors understand what they're looking at and what they should do next.

${personaFraming}

${pageContextBlock ? `CURRENT PAGE CONTEXT:\n${pageContextBlock}\n` : ""}${reachbackBlock}
Rules:
- Be terse. 2-4 sentences for most answers. Bullet lists only when the user asks for a list.
- Never invent data — if the user asks for a specific number that isn't in their visible context, tell them which page to navigate to.
- When you mention a feature, link to it like /companies or /alpha — the frontend renders these as clickable.
- Refuse safety-critical requests (medical advice, legal advice, financial recommendations beyond "here's the methodology").
- This is a streaming response — don't say "I'll respond shortly" or stall. Just answer.`;

    // The AI SDK's chat UI sends messages in UIMessage shape; convertToCoreMessages
    // normalizes them so streamText can consume regardless of v1/v2 ai-sdk shape.
    const coreMessages: CoreMessage[] = convertToCoreMessages(
      incomingMessages as UIMessage[],
    );

    const result = streamText({
      model: sonnet,
      system: systemPrompt,
      messages: coreMessages,
      maxTokens: 600,
    });

    // pipeDataStreamToResponse writes the streamed protocol the @ai-sdk/react
    // useChat hook expects. Adds the right SSE headers + flushes on each chunk.
    result.pipeDataStreamToResponse(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
