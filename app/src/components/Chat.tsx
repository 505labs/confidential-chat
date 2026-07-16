"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Message, type ChatMsg, type Source } from "./Message";
import { AttestButton } from "./AttestButton";
import { Files } from "./Files";
import { buildInfo, shortSha } from "@/lib/build-info";

type ChatSummary = { id: string; title: string };
type User = { name: string; email: string; image: string | null; role: "admin" | "user" };

export function Chat({
  user,
  initialChats,
}: {
  user: User;
  initialChats: ChatSummary[];
}) {
  const [chats, setChats] = useState<ChatSummary[]>(initialChats);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function openChat(id: string) {
    setActiveId(id);
    const res = await fetch(`/api/chats/${id}`);
    if (res.ok) {
      const data = (await res.json()) as { messages: ChatMsg[] };
      setMessages(data.messages);
    }
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) newChat();
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantMsg: ChatMsg = { id: crypto.randomUUID(), role: "assistant", content: "" };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeId,
          message: text,
          documentIds: selectedDocs.size ? [...selectedDocs] : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        patchLast(assistantMsg.id, `⚠️ ${await res.text()}`, null, null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newChatId: string | null = null;
      let acc = "";
      let codeSha: string | null = null;
      let sources: Source[] | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const evt = JSON.parse(t.slice(5).trim());
          if (evt.chatId && !activeId) newChatId = evt.chatId;
          if (evt.sources && evt.sources.length) sources = evt.sources as Source[];
          if (evt.token) {
            acc += evt.token;
            patchLast(assistantMsg.id, acc, null, sources);
          }
          if (evt.done) codeSha = evt.codeSha ?? null;
        }
      }
      patchLast(assistantMsg.id, acc, codeSha, sources);

      // Register the freshly-created chat in the sidebar.
      if (newChatId) {
        setActiveId(newChatId);
        setChats((cs) =>
          cs.some((c) => c.id === newChatId)
            ? cs
            : [{ id: newChatId!, title: text.slice(0, 48) }, ...cs],
        );
      }
    } catch (err) {
      patchLast(assistantMsg.id, `⚠️ ${(err as Error).message}`, null, null);
    } finally {
      setStreaming(false);
    }
  }

  function patchLast(
    id: string,
    content: string,
    codeSha: string | null,
    sources: Source[] | null,
  ) {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id ? { ...msg, content, code_sha: codeSha, sources } : msg,
      ),
    );
  }

  return (
    <div className="flex h-[calc(100vh-2.25rem)]">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-black/30 sm:flex">
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2">
          {chats.map((c) => (
            <div
              key={c.id}
              onClick={() => openChat(c.id)}
              className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ${
                activeId === c.id ? "bg-emerald-500/15 text-emerald-200" : "hover:bg-white/5"
              }`}
            >
              <span className="truncate">{c.title}</span>
              <button
                onClick={(e) => deleteChat(c.id, e)}
                className="ml-2 hidden text-neutral-500 hover:text-red-400 group-hover:block"
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <Files selected={selectedDocs} onSelectionChange={setSelectedDocs} />
        <div className="border-t border-white/10 p-3 text-xs text-neutral-400">
          <div className="mb-2 flex items-center gap-2">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
                {user.name[0]?.toUpperCase()}
              </div>
            )}
            <span className="truncate">{user.name}</span>
          </div>
          {user.role === "admin" && (
            <a href="/admin" className="block py-1 text-emerald-300 hover:underline">
              Admin · pending users
            </a>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="py-1 text-neutral-400 hover:text-neutral-200"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <section className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <span className="text-lg">🔒</span>
          <h1 className="text-sm font-semibold">Confidential Chat</h1>
          <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
            code {shortSha(buildInfo.gitSha)}
          </span>
          <div className="ml-auto">
            <AttestButton />
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.length === 0 && (
              <div className="mt-16 text-center text-neutral-500">
                <div className="text-4xl">🔒</div>
                <p className="mt-3 text-sm">
                  Ask anything. Your prompts are processed inside a hardware-encrypted TEE.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <Message
                key={m.id}
                m={m}
                streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 p-3">
          {selectedDocs.size > 0 && (
            <div className="mx-auto mb-2 max-w-2xl text-[11px] text-emerald-300/80">
              🔎 Answering using {selectedDocs.size} selected file
              {selectedDocs.size > 1 ? "s" : ""}.
            </div>
          )}
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Message Confidential Chat…"
              className="max-h-40 flex-1 resize-none rounded-xl border border-white/10 bg-neutral-900/70 px-4 py-2.5 text-sm outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
