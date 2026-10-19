import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/client";
import { getChain } from "@/server/chain/context";
import { syncPending } from "@/server/chain/sync";

// Scheduled chain sync (Vercel Cron or `npm run chain:sync`). It is the only unauthenticated-looking
// entry point, so it is protected by a shared secret (FARJI_SYNC_TOKEN) compared in constant time. It
// reads the chain and updates transaction status/mirrors; it cannot send a transaction.

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.FARJI_SYNC_TOKEN;
  if (!secret || secret.length < 16) return false; // not configured: refuse everything
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    const results = await syncPending(getDb(), getChain());
    return NextResponse.json({
      checked: results.length,
      changed: results.filter((r) => r.changed).length,
      errors: results.filter((r) => r.error).length,
    });
  } catch {
    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}

// Vercel Cron issues GET requests.
export const GET = POST;
