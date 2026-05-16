import { logger } from "../../lib/logger";

/**
 * Whisper STT — transcribes audio to text via OpenAI's /audio/transcriptions
 * endpoint. Direct API call (NOT routed through OpenRouter, which doesn't
 * proxy Whisper). Uses OPENAI_API_KEY env var.
 *
 * Cost: ~$0.006/minute (whisper-1 pricing). A 10-second exchange → ~$0.001.
 */
const OPENAI_AUDIO_URL = "https://api.openai.com/v1/audio/transcriptions";

export interface TranscribeResult {
  text: string;
  durationMs: number;
}

export async function transcribe(audio: Buffer, opts: { filename?: string; language?: string } = {}): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const start = Date.now();

  const form = new FormData();
  // Coerce Node Buffer → Uint8Array<ArrayBuffer> for the Blob constructor.
  // TS lib types reject Buffer directly because Buffer's ArrayBufferLike
  // backing could be a SharedArrayBuffer.
  const blob = new Blob([new Uint8Array(audio)]);
  form.append("file", blob, opts.filename ?? "audio.webm");
  form.append("model", "whisper-1");
  if (opts.language) form.append("language", opts.language);

  const resp = await fetch(OPENAI_AUDIO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn({ status: resp.status, body: body.slice(0, 300) }, "[whisper] transcribe failed");
    throw new Error(`Whisper ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json() as { text?: string };
  return { text: data.text ?? "", durationMs: Date.now() - start };
}
