import { auth } from "@/auth";
import { getUser, listDocuments, createDocumentWithChunks } from "@/lib/db";
import { extractDocument } from "@/lib/extract";
import { chunkText, embedPassages } from "@/lib/embed";

export const runtime = "nodejs";
// Parsing + OCR + embedding a PDF can take a while on the CPU-only VM.
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ACCEPTED = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

function accepted(mime: string, name: string): boolean {
  if (ACCEPTED.has(mime)) return true;
  const n = name.toLowerCase();
  return n.endsWith(".pdf") || n.endsWith(".txt") || n.endsWith(".md");
}

// GET /api/files — list the CURRENT user's documents only.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const docs = listDocuments(session.user.id).map((d) => ({
    id: d.id,
    filename: d.filename,
    mime: d.mime,
    byte_size: d.byte_size,
    page_count: d.page_count,
    status: d.status,
    note: d.note,
    created_at: d.created_at,
  }));
  return Response.json(docs);
}

// POST /api/files — upload + ingest one file, owned by the current user.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const user = getUser(session.user.id);
  if (!user || user.status !== "active") {
    return new Response("Account pending approval", { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return new Response("No file provided", { status: 400 });
  }
  if (file.size === 0) return new Response("Empty file", { status: 400 });
  if (file.size > MAX_BYTES) {
    return new Response(`File too large (max ${MAX_BYTES / 1024 / 1024} MB)`, {
      status: 413,
    });
  }
  const mime = file.type || "application/octet-stream";
  if (!accepted(mime, file.name)) {
    return new Response("Unsupported file type (PDF, TXT, MD only)", {
      status: 415,
    });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let extracted;
  try {
    extracted = await extractDocument(buf, mime, file.name);
  } catch (err) {
    return new Response(
      `Could not read this file: ${(err as Error).message}`,
      { status: 422 },
    );
  }

  if (extracted.status === "empty" || !extracted.text.trim()) {
    return new Response(
      "No readable text found. If this is a scanned PDF, OCR could not extract any text.",
      { status: 422 },
    );
  }

  // Chunk -> embed -> persist, all bound to this user_id.
  const chunks = chunkText(extracted.text);
  const embeddings = await embedPassages(chunks.map((c) => c.content));

  const doc = createDocumentWithChunks(
    {
      userId: user.id,
      filename: file.name.slice(0, 200),
      mime,
      byteSize: file.size,
      pageCount: extracted.pageCount,
      charCount: extracted.charCount,
      status: "ready",
      note: extracted.note,
    },
    chunks.map((c, i) => ({
      chunkIndex: c.index,
      page: c.page,
      content: c.content,
      embedding: embeddings[i],
    })),
  );

  return Response.json(
    {
      id: doc.id,
      filename: doc.filename,
      mime: doc.mime,
      byte_size: doc.byte_size,
      page_count: doc.page_count,
      status: doc.status,
      note: doc.note,
      chunk_count: chunks.length,
      created_at: doc.created_at,
    },
    { status: 201 },
  );
}
