import { auth } from "@/auth";
import { getChat, listMessages, deleteChat } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const chat = getChat(id, session.user.id);
  if (!chat) return new Response("Not found", { status: 404 });
  return Response.json({ chat, messages: listMessages(id) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  deleteChat(id, session.user.id);
  return new Response(null, { status: 204 });
}
