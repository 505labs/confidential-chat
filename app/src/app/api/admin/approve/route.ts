import { auth } from "@/auth";
import { getUser, approveUser } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const me = getUser(session.user.id);
  if (me?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { userId } = (await req.json()) as { userId: string };
  if (!userId) return new Response("Missing userId", { status: 400 });
  approveUser(userId);
  return new Response(null, { status: 204 });
}
