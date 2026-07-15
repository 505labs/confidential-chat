// Thin client for the llama.cpp OpenAI-compatible server running inside the TEE.
const BASE_URL = process.env.LLAMA_BASE_URL || "http://llama:8000/v1";
const API_KEY = process.env.LLAMA_API_KEY || "";

let cachedModel: string | null = null;

// llama.cpp advertises the loaded GGUF's id at /v1/models. Cache it; fall back to
// MODEL_NAME env, then to a harmless default (llama.cpp ignores it for a single model).
export async function resolveModel(): Promise<string> {
  if (process.env.MODEL_NAME) return process.env.MODEL_NAME;
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      cachedModel = data.data?.[0]?.id ?? "local-model";
      return cachedModel;
    }
  } catch {
    /* fall through */
  }
  return "local-model";
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Streams a chat completion. Returns the raw SSE Response from llama.cpp so the
// caller can tee it to the client and accumulate the text for persistence.
export async function streamChat(messages: ChatMessage[]): Promise<Response> {
  const model = await resolveModel();
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }),
  });
}
