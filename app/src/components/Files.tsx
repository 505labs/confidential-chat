"use client";

import { useEffect, useRef, useState } from "react";

export type DocMeta = {
  id: string;
  filename: string;
  mime: string;
  byte_size: number;
  page_count: number | null;
  status: string;
  note: string | null;
  created_at: number;
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Sidebar panel: upload PDFs/txt/md, list the user's own files, toggle which
// ones ground the chat, and delete. Selection is lifted to the parent via
// onSelectionChange so the chat request can scope retrieval to chosen docs.
export function Files({
  selected,
  onSelectionChange,
}: {
  selected: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => (r.ok ? r.json() : []))
      .then(setDocs)
      .catch(() => {});
  }, []);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const doc = (await res.json()) as DocMeta;
      setDocs((d) => [doc, ...d]);
      // Auto-select a freshly uploaded doc so the next question uses it.
      const next = new Set(selected);
      next.add(doc.id);
      onSelectionChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    await fetch(`/api/files/${id}`, { method: "DELETE" });
    setDocs((d) => d.filter((x) => x.id !== id));
    if (selected.has(id)) {
      const next = new Set(selected);
      next.delete(id);
      onSelectionChange(next);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div className="border-t border-white/10 px-2 py-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Your files
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-40"
          title="Upload PDF, TXT, or Markdown"
        >
          {uploading ? "Uploading…" : "+ Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>

      {error && (
        <div className="mx-1 mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {docs.length === 0 && !uploading && (
          <p className="px-1 py-1 text-[11px] text-neutral-600">
            Upload a document to ask questions about it. Only you can see your files.
          </p>
        )}
        {docs.map((d) => (
          <div
            key={d.id}
            className={`group flex items-center gap-2 rounded-md px-2 py-1 text-[12px] ${
              selected.has(d.id) ? "bg-emerald-500/10" : "hover:bg-white/5"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(d.id)}
              onChange={() => toggle(d.id)}
              className="accent-emerald-500"
              title="Use this file to answer"
            />
            <div className="min-w-0 flex-1" onClick={() => toggle(d.id)}>
              <div className="truncate" title={d.filename}>
                📄 {d.filename}
              </div>
              <div className="text-[10px] text-neutral-500">
                {fmtSize(d.byte_size)}
                {d.page_count ? ` · ${d.page_count}p` : ""}
                {d.note ? ` · ${d.note}` : ""}
              </div>
            </div>
            <button
              onClick={() => remove(d.id)}
              className="hidden text-neutral-500 hover:text-red-400 group-hover:block"
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
