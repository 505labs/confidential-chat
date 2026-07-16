import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Lightweight local SQLite store. Single file at DB_PATH (a mounted volume on the
// VM so chat history survives redeploys). Opened lazily on first query so that
// `next build` never touches the filesystem.
const DB_PATH = process.env.DB_PATH || "./data/app.db";

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

function getDb(): Database.Database {
  if (global.__db) return global.__db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT,
      image      TEXT,
      role       TEXT NOT NULL DEFAULT 'user',
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role         TEXT NOT NULL,
      content      TEXT NOT NULL,
      code_sha     TEXT,
      image_digest TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at ASC);

    -- Uploaded documents. ALWAYS scoped to the owning user; a document is never
    -- readable by anyone but its uploader (every query below filters on user_id).
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      mime        TEXT NOT NULL,
      byte_size   INTEGER NOT NULL,
      page_count  INTEGER,
      char_count  INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'ready',   -- ready | empty | error
      note        TEXT,                            -- e.g. "scanned, OCR applied"
      created_at  INTEGER NOT NULL
    );
    -- One row per text chunk, with its embedding stored as raw Float32 bytes (BLOB).
    -- user_id is denormalized onto the chunk so retrieval can filter by owner
    -- WITHOUT a join — defense in depth for the isolation guarantee.
    CREATE TABLE IF NOT EXISTS document_chunks (
      id          TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      page        INTEGER,
      content     TEXT NOT NULL,
      embedding   BLOB NOT NULL,
      dim         INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chunks_user ON document_chunks(user_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id, chunk_index ASC);
  `);
  global.__db = db;
  return db;
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: "admin" | "user";
  status: "active" | "pending";
  created_at: number;
};

export type ChatRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  code_sha: string | null;
  image_digest: string | null;
  created_at: number;
};

// --- Users -------------------------------------------------------------------

// Upsert on sign-in. The very first user to ever sign in becomes an active admin;
// everyone after starts 'pending' until an admin approves them.
export function upsertUser(u: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}): UserRow {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM users WHERE id = ? OR email = ?")
    .get(u.id, u.email) as UserRow | undefined;
  if (existing) {
    db.prepare("UPDATE users SET name = ?, image = ? WHERE id = ?").run(
      u.name ?? existing.name,
      u.image ?? existing.image,
      existing.id,
    );
    return { ...existing, name: u.name ?? existing.name, image: u.image ?? existing.image };
  }
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const isFirst = count === 0;
  // AUTO_APPROVE=true lets any signed-in Google user use the app immediately;
  // otherwise new (non-first) users start 'pending' until an admin approves them.
  const autoApprove = process.env.AUTO_APPROVE === "true";
  const row: UserRow = {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    image: u.image ?? null,
    role: isFirst ? "admin" : "user",
    status: isFirst || autoApprove ? "active" : "pending",
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO users (id, email, name, image, role, status, created_at)
     VALUES (@id, @email, @name, @image, @role, @status, @created_at)`,
  ).run(row);
  return row;
}

export function getUser(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function listPendingUsers(): UserRow[] {
  return getDb()
    .prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as UserRow[];
}

export function approveUser(id: string): void {
  getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
}

// --- Chats & messages --------------------------------------------------------

export function listChats(userId: string): ChatRow[] {
  return getDb()
    .prepare("SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as ChatRow[];
}

export function createChat(userId: string, title = "New chat"): ChatRow {
  const now = Date.now();
  const row: ChatRow = { id: randomUUID(), user_id: userId, title, created_at: now, updated_at: now };
  getDb()
    .prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES (@id, @user_id, @title, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function getChat(id: string, userId: string): ChatRow | undefined {
  return getDb()
    .prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?")
    .get(id, userId) as ChatRow | undefined;
}

export function deleteChat(id: string, userId: string): void {
  getDb().prepare("DELETE FROM chats WHERE id = ? AND user_id = ?").run(id, userId);
}

export function listMessages(chatId: string): MessageRow[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId) as MessageRow[];
}

export function addMessage(m: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  codeSha?: string | null;
  imageDigest?: string | null;
}): MessageRow {
  const db = getDb();
  const row: MessageRow = {
    id: randomUUID(),
    chat_id: m.chatId,
    role: m.role,
    content: m.content,
    code_sha: m.codeSha ?? null,
    image_digest: m.imageDigest ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, code_sha, image_digest, created_at)
     VALUES (@id, @chat_id, @role, @content, @code_sha, @image_digest, @created_at)`,
  ).run(row);
  db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(row.created_at, m.chatId);
  return row;
}

export function setChatTitle(id: string, title: string): void {
  getDb().prepare("UPDATE chats SET title = ? WHERE id = ?").run(title.slice(0, 80), id);
}

// --- Documents & chunks (RAG) ------------------------------------------------
//
// SECURITY INVARIANT: a document and its chunks belong to exactly one user. Every
// read/delete below takes a userId and filters on it, so one user can never see,
// search, or delete another user's files. Never add a helper here that queries
// documents/chunks without a user_id predicate.

export type DocumentRow = {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  byte_size: number;
  page_count: number | null;
  char_count: number;
  status: "ready" | "empty" | "error";
  note: string | null;
  created_at: number;
};

export type ChunkInput = {
  chunkIndex: number;
  page: number | null;
  content: string;
  embedding: Float32Array;
};

// A chunk plus its parent document's filename, as returned by retrieval.
export type RetrievedChunk = {
  document_id: string;
  filename: string;
  page: number | null;
  content: string;
  score: number;
};

function embeddingToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function blobToEmbedding(b: Buffer, dim: number): Float32Array {
  // Copy into a fresh, aligned buffer — the SQLite blob may not be 4-byte aligned.
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

// Insert a document plus all its chunks atomically. Returns the document id.
export function createDocumentWithChunks(
  doc: {
    userId: string;
    filename: string;
    mime: string;
    byteSize: number;
    pageCount: number | null;
    charCount: number;
    status?: DocumentRow["status"];
    note?: string | null;
  },
  chunks: ChunkInput[],
): DocumentRow {
  const db = getDb();
  const now = Date.now();
  const row: DocumentRow = {
    id: randomUUID(),
    user_id: doc.userId,
    filename: doc.filename,
    mime: doc.mime,
    byte_size: doc.byteSize,
    page_count: doc.pageCount,
    char_count: doc.charCount,
    status: doc.status ?? "ready",
    note: doc.note ?? null,
    created_at: now,
  };
  const insertDoc = db.prepare(
    `INSERT INTO documents
       (id, user_id, filename, mime, byte_size, page_count, char_count, status, note, created_at)
     VALUES (@id, @user_id, @filename, @mime, @byte_size, @page_count, @char_count, @status, @note, @created_at)`,
  );
  const insertChunk = db.prepare(
    `INSERT INTO document_chunks
       (id, document_id, user_id, chunk_index, page, content, embedding, dim, created_at)
     VALUES (@id, @document_id, @user_id, @chunk_index, @page, @content, @embedding, @dim, @created_at)`,
  );
  const tx = db.transaction(() => {
    insertDoc.run(row);
    for (const c of chunks) {
      insertChunk.run({
        id: randomUUID(),
        document_id: row.id,
        user_id: doc.userId,
        chunk_index: c.chunkIndex,
        page: c.page,
        content: c.content,
        embedding: embeddingToBlob(c.embedding),
        dim: c.embedding.length,
        created_at: now,
      });
    }
  });
  tx();
  return row;
}

export function listDocuments(userId: string): DocumentRow[] {
  return getDb()
    .prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as DocumentRow[];
}

export function getDocument(id: string, userId: string): DocumentRow | undefined {
  return getDb()
    .prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?")
    .get(id, userId) as DocumentRow | undefined;
}

export function deleteDocument(id: string, userId: string): void {
  // ON DELETE CASCADE removes the chunks; the extra user_id predicate makes it
  // impossible to delete someone else's document even with a guessed id.
  getDb().prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
}

// Cosine-similarity retrieval over ONE user's chunks. Optionally restrict to a
// set of document ids (e.g. files the user attached to this chat). Embeddings are
// unit-normalized at store time, so a dot product IS the cosine similarity.
export function searchChunks(
  userId: string,
  queryEmbedding: Float32Array,
  opts: { topK?: number; documentIds?: string[] } = {},
): RetrievedChunk[] {
  const db = getDb();
  const topK = opts.topK ?? 6;
  const dim = queryEmbedding.length;

  let sql =
    `SELECT c.document_id, c.page, c.content, c.embedding, c.dim, d.filename
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.user_id = ? AND c.dim = ?`;
  const args: unknown[] = [userId, dim];
  if (opts.documentIds && opts.documentIds.length > 0) {
    sql += ` AND c.document_id IN (${opts.documentIds.map(() => "?").join(",")})`;
    args.push(...opts.documentIds);
  }

  const rows = db.prepare(sql).all(...args) as Array<{
    document_id: string;
    page: number | null;
    content: string;
    embedding: Buffer;
    dim: number;
    filename: string;
  }>;

  const scored = rows.map((r) => {
    const vec = blobToEmbedding(r.embedding, r.dim);
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += vec[i] * queryEmbedding[i];
    return {
      document_id: r.document_id,
      filename: r.filename,
      page: r.page,
      content: r.content,
      score: dot,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
