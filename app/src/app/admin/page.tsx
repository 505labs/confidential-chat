import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getUser, listPendingUsers } from "@/lib/db";
import { ApproveButton } from "@/components/ApproveButton";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const me = getUser(session.user.id);
  if (me?.role !== "admin") redirect("/");

  const pending = listPendingUsers();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pending users</h1>
        <Link href="/" className="text-sm text-emerald-300 hover:underline">
          ← Back to chat
        </Link>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-neutral-400">No one is waiting for approval. 🎉</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {pending.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm">{u.name ?? u.email}</div>
                <div className="truncate font-mono text-xs text-neutral-500">{u.email}</div>
              </div>
              <ApproveButton userId={u.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
