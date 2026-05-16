import { Router, type IRouter } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { capabilitiesTable, cviComponentsTable, dvxComponentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { transcribe } from "../services/voice/whisper";
import { synthesize } from "../services/voice/tts";
import { chatWithFallback } from "../services/llm-fallback";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// 25 MB audio cap (Whisper's hard limit). In-memory storage — we don't
// persist raw audio.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * STT only — returns { transcript }. Used by frontends that want to do
 * their own LLM call (e.g. a separate chat surface) after transcribing.
 */
router.post("/voice/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "audio file required (multipart field 'audio')" }); return; }
    const result = await transcribe(req.file.buffer, { filename: req.file.originalname });
    res.json({ transcript: result.text, durationMs: result.durationMs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Transcribe failed" });
  }
});

/**
 * TTS only — { text, voice?, format? } → audio binary. Used by frontends
 * that want to read pre-existing text aloud.
 */
router.post("/voice/synthesize", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (text.length < 1) { res.status(400).json({ error: "text required" }); return; }
    const voice = typeof req.body?.voice === "string" ? req.body.voice : "nova";
    const format = (typeof req.body?.format === "string" && ["mp3", "opus", "aac"].includes(req.body.format)) ? req.body.format : "mp3";
    const result = await synthesize(text, { voice: voice as never, format: format as never });
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Length", result.audio.length.toString());
    res.send(result.audio);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Synthesize failed" });
  }
});

/**
 * Single-roundtrip voice converse: audio in → Whisper → Sonnet (with
 * page context if capabilityId provided) → TTS → mp3 out + transcript +
 * response text in headers.
 *
 * Headers on response:
 *   X-Voice-Transcript: <user's spoken question>
 *   X-Voice-Response:   <Sonnet's text answer>
 *   X-Voice-Duration-Ms: <total roundtrip ms>
 *   Content-Type: audio/mpeg
 *
 * Optional multipart field 'capabilityId' adds CVI/DVX context to the
 * Sonnet system prompt so the answer is grounded in that capability's
 * current numbers.
 */
router.post("/voice/converse", upload.single("audio"), async (req, res) => {
  const start = Date.now();
  try {
    if (!req.file) { res.status(400).json({ error: "audio file required" }); return; }

    // Step 1 — STT
    const stt = await transcribe(req.file.buffer, { filename: req.file.originalname });
    if (!stt.text.trim()) {
      res.status(422).json({ error: "Transcription produced empty text — try speaking again." });
      return;
    }

    // Step 2 — gather optional context
    const capId = req.body?.capabilityId ? Number(req.body.capabilityId) : null;
    let contextLine = "";
    if (capId != null && Number.isFinite(capId)) {
      const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capId)).limit(1);
      if (cap) {
        const [cvi] = await db.select().from(cviComponentsTable).where(eq(cviComponentsTable.capabilityId, capId)).limit(1);
        const [dvx] = await db.select().from(dvxComponentsTable).where(eq(dvxComponentsTable.capabilityId, capId)).limit(1);
        contextLine = `The user is currently viewing the capability "${cap.name}". Current Inflexcvi data: CVI=${cvi?.consensusScore?.toFixed?.(0) ?? "n/a"}/1000, DVX=${dvx?.disruptionScore?.toFixed?.(0) ?? "n/a"}/100, months_to_displacement=${dvx?.monthsToDisplacement ?? "n/a"}.`;
      }
    }

    const systemPrompt = [
      `You are the Inflexcvi voice advisor. The user has just asked you a question via voice. Answer it conversationally in 2-4 sentences — this is going to be read aloud, so keep it spoken-language friendly. Avoid bullet points, headers, or anything that doesn't translate to speech.`,
      contextLine,
      `Inflexcvi terminology: CVI (Capability Value Index, 0-1000) = current value of a capability. DVX (Disruption Velocity Index, 0-100) = probability the capability gets displaced, with months-to-displacement attached.`,
    ].filter(Boolean).join("\n");

    // Step 3 — Sonnet response
    const chat = await chatWithFallback({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: stt.text },
      ],
      models: ["anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5"],
      maxTokens: 512,
      endpoint: "voice:converse",
    });
    const responseText = chat.text.trim();

    // Step 4 — TTS
    const tts = await synthesize(responseText, { voice: "nova", format: "mp3" });

    const totalMs = Date.now() - start;
    res.setHeader("Content-Type", tts.mimeType);
    res.setHeader("Content-Length", tts.audio.length.toString());
    res.setHeader("X-Voice-Transcript", encodeURIComponent(stt.text.slice(0, 400)));
    res.setHeader("X-Voice-Response", encodeURIComponent(responseText.slice(0, 1000)));
    res.setHeader("X-Voice-Duration-Ms", totalMs.toString());
    res.setHeader("X-Voice-Stt-Ms", stt.durationMs.toString());
    res.setHeader("X-Voice-Tts-Ms", tts.durationMs.toString());
    res.send(tts.audio);
    logger.info({ totalMs, sttMs: stt.durationMs, ttsMs: tts.durationMs, capId, transcriptChars: stt.text.length, responseChars: responseText.length }, "[voice] converse complete");
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Voice converse failed" });
  }
});

export default router;
