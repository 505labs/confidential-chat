import { auth } from "@/auth";
import { getDocument, deleteDocument } from "@/lib/db";

export const runtime = "nodejs";

// DELETE /api/files/[id] — delete a document the current user owns. The user_id
// predicate in deleteDocument makes it a no-op for anyone else's document.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  // 404 rather than silently succeeding if it isn't theirs / doesn't exist.
  if (!getDocument(id, session.user.id)) {
    return new Response("Not found", { status: 404 });
  }
  deleteDocument(id, session.user.id);
  return new Response(null, { status: 204 });
}
