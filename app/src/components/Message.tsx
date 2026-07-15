import { HashBadge } from "./HashBadge";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  code_sha?: string | null;
};

export function Message({ m, streaming }: { m: ChatMsg; streaming?: boolean }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-600/90 text-white"
            : "border border-white/10 bg-neutral-900/70 text-neutral-100"
        }`}
      >
        <div className="whitespace-pre-wrap break-words">
          {m.content}
          {streaming && <span className="ml-0.5 inline-block animate-pulse">▋</span>}
        </div>
        {!isUser && !streaming && (
          <div className="mt-1 text-right">
            <HashBadge codeSha={m.code_sha} />
          </div>
        )}
      </div>
    </div>
  );
}
