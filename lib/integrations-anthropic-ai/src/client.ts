if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required.");
}

const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5":  "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.5",
  "claude-opus-4-5":   "anthropic/claude-opus-4.5",
  "claude-opus-4-7":   "anthropic/claude-opus-4.5",
  "claude-haiku-3-5":  "anthropic/claude-3.5-haiku",
  "claude-sonnet-3-5": "anthropic/claude-3.7-sonnet",
  "claude-3-haiku":    "anthropic/claude-3-haiku",
  "glm-5.1":           "z-ai/glm-5.1",
};

export function resolveModel(shortName: string): string {
  if (OPENROUTER_MODEL_MAP[shortName]) return OPENROUTER_MODEL_MAP[shortName];
  if (shortName.includes("/")) return shortName;
  return `anthropic/${shortName}`;
}

type AnthropicTextPart = { type: "text"; text: string };
type AnthropicMessageParam = {
  role: "user" | "assistant" | "system";
  content: string | AnthropicTextPart[];
};
type MessagesCreateParams = {
  model: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  messages: AnthropicMessageParam[];
};
type MessagesCreateResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicTextPart[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

function partsToString(content: string | AnthropicTextPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is AnthropicTextPart => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

async function messagesCreate(params: MessagesCreateParams): Promise<MessagesCreateResponse> {
  const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (params.system) openaiMessages.push({ role: "system", content: params.system });
  for (const m of params.messages) {
    const role = m.role === "system" ? "system" : m.role;
    openaiMessages.push({ role, content: partsToString(m.content) });
  }

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://capabilityeconomics.com",
      "X-Title": "Capability Economics",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.max_tokens ?? 1024,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      messages: openaiMessages,
    }),
  });

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    const snippet = bodyText.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`OpenRouter ${resp.status}: ${snippet || resp.statusText}`);
  }

  const data = (await resp.json()) as {
    id?: string;
    model?: string;
    choices?: Array<{
      message?: { content?: string | null };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    id: data.id ?? "",
    type: "message",
    role: "assistant",
    model: data.model ?? params.model,
    content: [{ type: "text", text: typeof text === "string" ? text : "" }],
    stop_reason: data.choices?.[0]?.finish_reason ?? null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

export const anthropic = {
  messages: {
    create: messagesCreate,
  },
};

export type { MessagesCreateParams, MessagesCreateResponse, AnthropicMessageParam, AnthropicTextPart };
