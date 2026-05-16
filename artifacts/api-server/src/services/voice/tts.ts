import { logger } from "../../lib/logger";

/**
 * OpenAI TTS — synthesize text to audio (mp3). Direct API call (not via
 * OpenRouter). Uses OPENAI_API_KEY.
 *
 * Voice options: alloy | echo | fable | onyx | nova | shimmer (Default: nova
 * — warm, conversational, suits an advisor tone).
 *
 * Cost: ~$15 per 1M chars (tts-1) or ~$30 per 1M chars (tts-1-hd).
 * A 200-char response → ~$0.003 with tts-1. Default to tts-1 for cost.
 */
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

export interface SynthResult {
  audio: Buffer;
  mimeType: string;
  durationMs: number;
}

export async function synthesize(text: string, opts: { voice?: TtsVoice; model?: "tts-1" | "tts-1-hd"; format?: "mp3" | "opus" | "aac" } = {}): Promise<SynthResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const start = Date.now();
  const voice = opts.voice ?? "nova";
  const model = opts.model ?? "tts-1";
  const format = opts.format ?? "mp3";

  const resp = await fetch(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text.slice(0, 4096),
      response_format: format,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn({ status: resp.status, body: body.slice(0, 300) }, "[tts] synth failed");
    throw new Error(`TTS ${resp.status}: ${body.slice(0, 200)}`);
  }
  const audio = Buffer.from(await resp.arrayBuffer());
  const mimeType = format === "mp3" ? "audio/mpeg" : format === "opus" ? "audio/opus" : "audio/aac";
  return { audio, mimeType, durationMs: Date.now() - start };
}
