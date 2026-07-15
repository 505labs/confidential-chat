import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function PendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.status === "active") redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/60 p-8 text-center shadow-2xl backdrop-blur">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-2xl">
          ⏳
        </div>
        <h1 className="text-lg font-semibold">Awaiting approval</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Hi {session.user.name ?? session.user.email}, your account
          (<span className="font-mono">{session.user.email}</span>) is pending an
          admin&apos;s approval. You&apos;ll get access as soon as it&apos;s granted.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
