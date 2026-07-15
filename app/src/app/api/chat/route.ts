import { auth } from "@/auth";
import { streamChat, type ChatMessage } from "@/lib/llama";
import {
  getUser,
  getChat,
  createChat,
  listMessages,
  addMessage,
  setChatTitle,
} from "@/lib/db";
import { buildInfo } from "@/lib/build-info";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are Confidential Chat, a helpful assistant running entirely inside a hardware-encrypted TEE. Be concise and friendly.";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const user = getUser(session.user.id);
  if (!user || user.status !== "active") {
    return new Response("Account pending approval", { status: 403 });
  }

  const { chatId, message } = (await req.json()) as { chatId?: string; message: string };
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
  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
      // Tell the client which chat this is (for a freshly-created one).
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ chatId: chatIdFinal })}\n\n`),
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
