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
  const row: UserRow = {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    image: u.image ?? null,
    role: isFirst ? "admin" : "user",
    status: isFirst ? "active" : "pending",
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
