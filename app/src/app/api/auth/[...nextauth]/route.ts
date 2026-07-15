import { handlers } from "@/auth";

// better-sqlite3 (used in Auth callbacks) needs the Node.js runtime.
export const runtime = "nodejs";
export const { GET, POST } = handlers;
