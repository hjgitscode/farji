import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/client";
import { RULES } from "@/lib/security/rate-limit";
import { getChain } from "@/server/chain/context";
import { ChainMisconfiguredError, ensureChainReady } from "@/server/chain/ready";
import { syncPending } from "@/server/chain/sync";
import { checkLimit, requestKeyFrom } from "@/server/security/limit";

// Scheduled chain sync (Vercel Cron or `npm run chain:sync`). It is the only unauthenticated-looking
// entry point, so it is protected by a shared secret (FARJI_SYNC_TOKEN) compared in constant time. It
// reads the chain and updates transaction status/mirrors; it cannot send a transaction.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.FARJI_SYNC_TOKEN;
  if (!secret || secret.length < 16) return false; // not configured: refuse everything
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const key = requestKeyFrom(request);
  if (!checkLimit(RULES.syncCall, key).allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "retry-after": "60" } });
  if (!authorised(request)) {
    // Repeated wrong tokens from one place are slowed down; the response never says which part was wrong.
    const blocked = !checkLimit(RULES.syncAuthFailure, key).allowed;
    return NextResponse.json({ error: blocked ? "too many requests" : "unauthorised" }, { status: blocked ? 429 : 401, headers: blocked ? { "retry-after": "600" } : undefined });
  }
  try {
    const chain = getChain();
    await ensureChainReady(chain);
    // Idempotent: only PENDING/CONFIRMED rows are visited, every transition is a conditional update, and the mirror
    // runs only when a row becomes FINALIZED. Running it twice in a row changes nothing the second time.
    const results = await syncPending(getDb(), chain);
    return NextResponse.json({
      checked: results.length,
      changed: results.filter((r) => r.changed).length,
      errors: results.filter((r) => r.error).length,
    });
  } catch (e) {
    // 503 = "try the next scheduled run"; no detail of the failure is returned.
    return NextResponse.json({ error: e instanceof ChainMisconfiguredError ? "chain misconfigured" : "sync unavailable" }, { status: 503 });
  }
}

// Vercel Cron issues GET requests.
export const GET = POST;
