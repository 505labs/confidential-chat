import { auth } from "@/auth";
import { listChats } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return Response.json(listChats(session.user.id));
}
