"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApproveButton({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/admin/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        router.refresh();
      }}
      className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
    >
      {busy ? "Approving…" : "Approve"}
    </button>
  );
}
