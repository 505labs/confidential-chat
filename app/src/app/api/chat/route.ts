import { auth } from "@/auth";
import { streamChat, type ChatMessage } from "@/lib/llama";
import {
  getUser,
  getChat,
  createChat,
  listMessages,
  addMessage,
  setChatTitle,
  searchChunks,
  getDocument,
  type RetrievedChunk,
} from "@/lib/db";
import { embedQuery } from "@/lib/embed";
import { buildInfo } from "@/lib/build-info";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are Confidential Chat, a helpful assistant running entirely inside a hardware-encrypted TEE. Be concise and friendly.";

// Minimum retrieval similarity to bother injecting a chunk. bge cosine scores for
// a genuinely relevant passage are typically > 0.4; below this it's mostly noise.
const MIN_SCORE = 0.35;
const TOP_K = 6;

// Build a grounded system prompt from retrieved chunks. Only chunks belonging to
// THIS user are ever passed in (searchChunks filters on user_id).
function ragSystemPrompt(chunks: RetrievedChunk[]): string {
  const context = chunks
    .map((c, i) => {
      const loc = c.page ? `${c.filename}, p.${c.page}` : c.filename;
      return `[${i + 1}] (${loc})\n${c.content}`;
    })
    .join("\n\n");
  return (
    SYSTEM_PROMPT +
    "\n\nThe user has uploaded documents. Use the CONTEXT below to answer when it " +
    "is relevant, and cite the source in brackets like [1]. If the answer is not " +
    "in the context, say so plainly instead of guessing.\n\n" +
    "=== CONTEXT ===\n" +
    context +
    "\n=== END CONTEXT ==="
  );
}

// Collapse retrieved chunks to a unique, ordered list of source filenames+pages.
function dedupeSources(chunks: RetrievedChunk[]): { filename: string; page: number | null }[] {
  const seen = new Set<string>();
  const out: { filename: string; page: number | null }[] = [];
  for (const c of chunks) {
    const key = `${c.filename}#${c.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ filename: c.filename, page: c.page });
  }
  return out;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const user = getUser(session.user.id);
  if (!user || user.status !== "active") {
    return new Response("Account pending approval", { status: 403 });
  }

  const { chatId, message, documentIds } = (await req.json()) as {
    chatId?: string;
    message: string;
    documentIds?: string[];
  };
  if (!message?.trim()) return new Response("Empty message", { status: 400 });

  // Resolve or create the chat, scoped to this user.
  let chat = chatId ? getChat(chatId, user.id) : undefined;
  if (!chat) {
    chat = createChat(user.id, message.trim().slice(0, 48));
  } else if (listMessages(chat.id).length === 0) {
    setChatTitle(chat.id, message.trim().slice(0, 48));
  }

  // Persist the user's message, then build the model context from history.
  addMessage({ chatId: chat.id, role: "user", content: message });

  // --- RAG retrieval over THIS user's documents --------------------------------
  // If the client scoped the request to specific documents, verify each one is
  // actually owned by this user before using it (defense in depth).
  const userScopedRequest =
    Array.isArray(documentIds) && documentIds.length > 0;
  const scopedDocIds = userScopedRequest
    ? documentIds!.filter((id) => !!getDocument(id, user.id))
    : undefined;

  let retrieved: RetrievedChunk[] = [];
  // If the user explicitly scoped to files but none are valid/owned, retrieve
  // nothing rather than silently falling back to all their documents.
  const skipRetrieval = userScopedRequest && scopedDocIds!.length === 0;
  if (!skipRetrieval) {
    try {
      const qvec = await embedQuery(message);
      retrieved = searchChunks(user.id, qvec, {
        topK: TOP_K,
        documentIds: scopedDocIds,
      }).filter((c) => c.score >= MIN_SCORE);
    } catch {
      // Embedding/retrieval failure -> plain chat rather than erroring out.
      retrieved = [];
    }
  }

  const systemContent =
    retrieved.length > 0 ? ragSystemPrompt(retrieved) : SYSTEM_PROMPT;

  const history: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...listMessages(chat.id).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const upstream = await streamChat(history);
  if (!upstream.ok || !upstream.body) {
    return new Response(`Model error: ${upstream.status}`, { status: 502 });
  }

  const chatIdFinal = chat.id;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let assistant = "";

  // Re-emit our own simple SSE: {token} deltas, then a final {done} frame carrying
  // the chatId + provenance (the code SHA this answer was generated with).
  const stream = new ReadableStream({
    async start(controller) {
      // Tell the client which chat this is (for a freshly-created one) and which
      // of the user's own documents grounded this answer.
      const sources = dedupeSources(retrieved);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ chatId: chatIdFinal, sources })}\n\n`,
        ),
      );
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
              if (delta) {
                assistant += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`),
                );
              }
            } catch {
              /* ignore keep-alive / partial frames */
            }
          }
        }
      } finally {
        // Persist the assistant reply with the provenance of the running code.
        if (assistant) {
          addMessage({
            chatId: chatIdFinal,
            role: "assistant",
            content: assistant,
            codeSha: buildInfo.gitSha,
            imageDigest: buildInfo.imageDigest,
          });
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              done: true,
              codeSha: buildInfo.gitSha,
              imageDigest: buildInfo.imageDigest,
            })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
