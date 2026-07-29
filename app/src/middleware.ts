import { NextResponse, type NextRequest } from "next/server";

// Simple in-memory, per-IP rate limiting. The app runs as a single container
// inside the TEE, so a process-local sliding-window counter is sufficient (no
// external store). Limits are per client IP, read from the X-Forwarded-For
// header that Caddy sets in front of us.
//
// Buckets (path prefix -> allowed requests per window):
//   /api/auth   — login/callback abuse: tight
//   /api/chat   — model inference (the expensive path): moderate
//   /api/       — everything else under the API: generous
type Rule = { prefix: string; limit: number; windowMs: number };
const RULES: Rule[] = [
  { prefix: "/api/auth", limit: 20, windowMs: 60_000 }, // 20 / min
  { prefix: "/api/chat", limit: 30, windowMs: 60_000 }, // 30 / min
  { prefix: "/api/", limit: 120, windowMs: 60_000 }, // 120 / min
];

// key -> timestamps (ms) of requests within the current window.
const hits = new Map<string, number[]>();

// Opportunistic cleanup so the Map can't grow unbounded.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, arr] of hits) {
    const fresh = arr.filter((t) => now - t < 120_000);
    if (fresh.length) hits.set(k, fresh);
    else hits.delete(k);
  }
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const rule = RULES.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return NextResponse.next();

  const now = Date.now();
  sweep(now);

  const key = `${rule.prefix}|${clientIp(req)}`;
  const arr = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (arr.length >= rule.limit) {
    const retryAfter = Math.ceil((rule.windowMs - (now - arr[0])) / 1000);
    return new NextResponse("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(rule.limit),
        "X-RateLimit-Remaining": "0",
      },
    });
  }
  arr.push(now);
  hits.set(key, arr);

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(rule.limit));
  res.headers.set("X-RateLimit-Remaining", String(rule.limit - arr.length));
  return res;
}

// Only run the middleware on API routes.
export const config = {
  matcher: ["/api/:path*"],
};
